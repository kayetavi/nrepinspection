'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
  addDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, safeFirestoreWrite, isWriteQuotaExceeded } from './firebase';
import {
  EquipmentItem,
  SAMPLE_EQUIPMENT_DATA,
  AuditLogItem,
  normalizeEquipmentRecord,
} from './types';
import { useAuth } from './auth-context';

interface EquipmentContextType {
  equipment: EquipmentItem[];
  loading: boolean;
  error: string | null;
  updateEquipmentField: (id: string, field: keyof EquipmentItem, value: any) => Promise<void>;
  saveEquipment: (item: Partial<EquipmentItem> & { EquipmentTagNo: string }) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
  bulkDeleteEquipment: (ids: string[]) => Promise<void>;
  clearAllEquipment: () => Promise<void>;
  importFromExcel: (rows: any[]) => Promise<{ added: number; updated: number }>;
  resetToSampleData: () => Promise<void>;
  auditLogs: AuditLogItem[];
}

const EquipmentContext = createContext<EquipmentContextType>({
  equipment: [],
  loading: true,
  error: null,
  updateEquipmentField: async () => {},
  saveEquipment: async () => {},
  deleteEquipment: async () => {},
  bulkDeleteEquipment: async () => {},
  clearAllEquipment: async () => {},
  importFromExcel: async () => ({ added: 0, updated: 0 }),
  resetToSampleData: async () => {},
  auditLogs: [],
});

export const useEquipment = () => useContext(EquipmentContext);

const DB_CLEARED_STORAGE_KEY = 'nrep_db_intentionally_cleared_v2';
const LOCAL_EQUIPMENT_CACHE_KEY = 'nrep_equipment_local_cache_v5';
const LOCAL_AUDIT_LOGS_CACHE_KEY = 'nrep_audit_logs_local_v5';

function getDefaultEquipmentDataset(): EquipmentItem[] {
  return SAMPLE_EQUIPMENT_DATA.map((sample) =>
    normalizeEquipmentRecord({
      ...sample,
      id: sample.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_'),
    })
  );
}

function loadLocalEquipmentCache(): EquipmentItem[] | null {
  if (typeof window === 'undefined') return null;
  try {
    if (window.localStorage.getItem(DB_CLEARED_STORAGE_KEY) === 'true') {
      return [];
    }
    const raw = window.localStorage.getItem(LOCAL_EQUIPMENT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normalizeEquipmentRecord(item));
    }
  } catch {}
  return null;
}

function saveLocalEquipmentCache(items: EquipmentItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_EQUIPMENT_CACHE_KEY, JSON.stringify(items));
  } catch {}
}

function loadLocalAuditLogs(): AuditLogItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_AUDIT_LOGS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function EquipmentProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, isEditor, isAdmin } = useAuth();
  const [equipment, setEquipment] = useState<EquipmentItem[]>(() => {
    const cached = loadLocalEquipmentCache();
    return cached !== null ? cached : getDefaultEquipmentDataset();
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(() => loadLocalAuditLogs());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateEquipmentStateAndCache = (updater: EquipmentItem[] | ((prev: EquipmentItem[]) => EquipmentItem[])) => {
    setEquipment((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveLocalEquipmentCache(next);
      return next;
    });
  };

  // Helper to log audit events (updates local audit log immediately + best-effort Firestore write)
  const logAudit = async (action: string, target: string, details?: string) => {
    const newEntry: AuditLogItem = {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      action,
      target,
      userEmail: user?.email || profile?.email || profile?.displayName || 'Anonymous',
      timestamp: new Date().toISOString(),
      details: details || '',
    };

    setAuditLogs((prev) => {
      const next = [newEntry, ...prev].slice(0, 50);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(LOCAL_AUDIT_LOGS_CACHE_KEY, JSON.stringify(next));
        } catch {}
      }
      return next;
    });

    if (isWriteQuotaExceeded()) return;

    try {
      const logsRef = collection(db, 'audit_logs');
      await safeFirestoreWrite(() =>
        addDoc(logsRef, {
          action: newEntry.action,
          target: newEntry.target,
          userEmail: newEntry.userEmail,
          timestamp: newEntry.timestamp,
          details: newEntry.details,
        })
      );
    } catch {}
  };

  // Listen to Firestore equipment collection in real time (Read-only on mount: NO automatic batch writes on load!)
  useEffect(() => {
    const eqCollection = collection(db, 'equipment');

    const unsubscribe = onSnapshot(
      eqCollection,
      (snapshot) => {
        const wasIntentionallyCleared =
          typeof window !== 'undefined' && window.localStorage.getItem(DB_CLEARED_STORAGE_KEY) === 'true';

        if (wasIntentionallyCleared) {
          updateEquipmentStateAndCache([]);
          setLoading(false);
          setError(null);
          return;
        }

        // If user already has a local cache (e.g., edits made while quota was exceeded), prefer local cache
        const localCache = loadLocalEquipmentCache();
        if (localCache !== null && localCache.length > 0 && isWriteQuotaExceeded()) {
          setEquipment(localCache);
          setLoading(false);
          setError(null);
          return;
        }

        const rawDocs: EquipmentItem[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Omit<EquipmentItem, 'id'>;
          rawDocs.push({
            id: docSnap.id,
            ...data,
          });
        });

        // Merge Firestore documents with the revised 7 Units + 8 UTILITY Sub-Units baseline in memory
        // without triggering any automatic Firestore batch writes on load.
        const existingByTag = new Map<string, EquipmentItem>();
        rawDocs.forEach((r) => {
          existingByTag.set((r.EquipmentTagNo || r.id).trim(), r);
        });

        // Also overlay any locally cached edits by tag so local changes are never lost
        if (localCache !== null) {
          localCache.forEach((localItem) => {
            existingByTag.set((localItem.EquipmentTagNo || localItem.id).trim(), localItem);
          });
        }

        if (localCache !== null && localCache.length > 0) {
          // If localCache exists, use it as the authoritative list so deletions/additions made locally are preserved
          updateEquipmentStateAndCache(localCache);
          setLoading(false);
          setError(null);
          return;
        }

        const mergedItems: EquipmentItem[] = SAMPLE_EQUIPMENT_DATA.map((sample) => {
          const docId = sample.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_');
          const prev = existingByTag.get(sample.EquipmentTagNo);
          return normalizeEquipmentRecord({
            ...sample,
            ...(prev
              ? {
                  FormatIStatus: prev.FormatIStatus || sample.FormatIStatus,
                  FormatIDate: prev.FormatIDate || sample.FormatIDate,
                  FormatIIStatus: prev.FormatIIStatus || sample.FormatIIStatus,
                  FormatIIDate: prev.FormatIIDate || sample.FormatIIDate,
                  FormatIIIStatus: prev.FormatIIIStatus || sample.FormatIIIStatus,
                  FormatIIIDate: prev.FormatIIIDate || sample.FormatIIIDate,
                  InternalInspectionStatus: prev.InternalInspectionStatus || sample.InternalInspectionStatus,
                  BaseLineUTG: prev.BaseLineUTG || sample.BaseLineUTG,
                  PunchPointsCategoryClosed: prev.PunchPointsCategoryClosed || sample.PunchPointsCategoryClosed,
                  FinalSystemAcceptance: prev.FinalSystemAcceptance || sample.FinalSystemAcceptance,
                  DocumentDrawing: prev.DocumentDrawing || prev.Link || sample.DocumentDrawing,
                  Remarks: prev.Remarks || sample.Remarks,
                }
              : {}),
            Unit: sample.Unit,
            SubUnit: sample.SubUnit,
            SystemNo: sample.SystemNo,
            id: docId,
          });
        });

        const sampleTagSet = new Set(SAMPLE_EQUIPMENT_DATA.map((s) => s.EquipmentTagNo));
        const oldObsoleteTags = new Set([
          '1U59-TT-5133B',
          '1U59-TT-5133C',
          '1U59-TT-5133D',
          '1U59-TT-8631',
          '1U59-TT-8731',
          '1U59-TT-4634',
          '1U58-CL-401',
        ]);

        rawDocs.forEach((r) => {
          const tag = (r.EquipmentTagNo || r.id).trim();
          if (!sampleTagSet.has(tag) && !oldObsoleteTags.has(tag)) {
            mergedItems.push(normalizeEquipmentRecord(r));
          }
        });

        updateEquipmentStateAndCache(mergedItems);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.warn('Firestore equipment listener fallback to local cache:', err.message);
        const cached = loadLocalEquipmentCache();
        setEquipment(cached !== null ? cached : getDefaultEquipmentDataset());
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen to audit logs when user or profile is signed in
  useEffect(() => {
    if (!user && !profile) return;
    const logsQuery = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const logs: AuditLogItem[] = [];
        snapshot.forEach((docSnap) => {
          logs.push({ id: docSnap.id, ...(docSnap.data() as Omit<AuditLogItem, 'id'>) });
        });
        if (logs.length > 0) {
          setAuditLogs(logs);
        }
      },
      () => {
        // Keep local audit logs on error
      }
    );
    return () => {
      unsubscribe();
    };
  }, [user, profile]);

  const updateEquipmentField = async (id: string, field: keyof EquipmentItem, value: any) => {
    if (!isEditor) {
      throw new Error('Access denied: You do not have editor or admin permissions.');
    }

    const existingItem =
      equipment.find((e) => e.id === id || e.EquipmentTagNo === id) ||
      getDefaultEquipmentDataset().find((s) => s.id === id || s.EquipmentTagNo === id);

    const docId = existingItem?.id || id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = doc(db, 'equipment', docId);
    const actorEmail = user?.email || profile?.email || profile?.displayName || 'Unknown';
    const nowIso = new Date().toISOString();

    const updatePayload = normalizeEquipmentRecord({
      ...(existingItem || { id: docId, EquipmentTagNo: id }),
      [field]: value,
      updatedAt: nowIso,
      updatedBy: actorEmail,
    });

    // Immediate local state & localStorage update
    updateEquipmentStateAndCache((prev) =>
      prev.map((item) => (item.id === docId || item.id === id ? updatePayload : item))
    );

    try {
      await safeFirestoreWrite(() => setDoc(docRef, updatePayload, { merge: true }));
      await logAudit('UPDATE_FIELD', docId, `Updated ${String(field)} to "${value}"`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `equipment/${docId}`);
    }
  };

  const saveEquipment = async (item: Partial<EquipmentItem> & { EquipmentTagNo: string }) => {
    if (!isEditor) {
      throw new Error('Access denied: You do not have editor or admin permissions.');
    }

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DB_CLEARED_STORAGE_KEY);
    }

    const docId = item.id || item.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = doc(db, 'equipment', docId);
    const actorEmail = user?.email || profile?.email || profile?.displayName || 'Unknown';

    const payload = normalizeEquipmentRecord({
      ...item,
      id: docId,
      updatedAt: new Date().toISOString(),
      updatedBy: actorEmail,
    });

    // Immediate local state & localStorage update
    updateEquipmentStateAndCache((prev) => {
      const exists = prev.some((e) => e.id === docId);
      if (exists) {
        return prev.map((e) => (e.id === docId ? payload : e));
      }
      return [...prev, payload];
    });

    try {
      await safeFirestoreWrite(() => setDoc(docRef, payload, { merge: true }));
      await logAudit(
        'SAVE_EQUIPMENT',
        docId,
        `Saved equipment ${item.EquipmentTagNo} (${payload.Unit}${payload.SubUnit ? ' › ' + payload.SubUnit : ''})`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipment/${docId}`);
    }
  };

  const deleteEquipment = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Access denied: Only administrators can delete equipment records.');
    }

    const targetItem = equipment.find((e) => e.id === id || e.EquipmentTagNo === id);
    const docId = targetItem?.id || id.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (equipment.length <= 1 && typeof window !== 'undefined') {
      window.localStorage.setItem(DB_CLEARED_STORAGE_KEY, 'true');
    }

    // Immediate local state & localStorage removal
    updateEquipmentStateAndCache((prev) =>
      prev.filter((e) => e.id !== id && e.id !== docId && e.EquipmentTagNo !== id)
    );

    try {
      await safeFirestoreWrite(async () => {
        await deleteDoc(doc(db, 'equipment', docId));
        if (id !== docId) {
          await deleteDoc(doc(db, 'equipment', id)).catch(() => {});
        }
      });
      await logAudit('DELETE_EQUIPMENT', docId, `Deleted equipment record ${targetItem?.EquipmentTagNo || id}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `equipment/${docId}`);
    }
  };

  const bulkDeleteEquipment = async (ids: string[]) => {
    if (!isAdmin) {
      throw new Error('Access denied: Only administrators can delete equipment records.');
    }
    if (!ids.length) return;

    const idSet = new Set(ids);
    if (ids.length >= equipment.length && typeof window !== 'undefined') {
      window.localStorage.setItem(DB_CLEARED_STORAGE_KEY, 'true');
    }

    updateEquipmentStateAndCache((prev) =>
      prev.filter((e) => !idSet.has(e.id) && !idSet.has(e.EquipmentTagNo))
    );

    try {
      await safeFirestoreWrite(async () => {
        const BATCH_SIZE = 400;
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const slice = ids.slice(i, i + BATCH_SIZE);
          const batch = writeBatch(db);
          slice.forEach((rawId) => {
            const docId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
            batch.delete(doc(db, 'equipment', docId));
            if (rawId !== docId) {
              batch.delete(doc(db, 'equipment', rawId));
            }
          });
          await batch.commit();
        }
      });
      await logAudit('BULK_DELETE_EQUIPMENT', 'Equipment Master', `Deleted ${ids.length} equipment records`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'equipment/bulk');
    }
  };

  const clearAllEquipment = async () => {
    if (!isAdmin) {
      throw new Error('Access denied: Only administrators can clear the database.');
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DB_CLEARED_STORAGE_KEY, 'true');
    }

    const allIds = equipment.map((e) => e.id);
    updateEquipmentStateAndCache([]);

    try {
      await safeFirestoreWrite(async () => {
        const BATCH_SIZE = 400;
        for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
          const slice = allIds.slice(i, i + BATCH_SIZE);
          const batch = writeBatch(db);
          slice.forEach((docId) => {
            batch.delete(doc(db, 'equipment', docId));
          });
          await batch.commit();
        }
      });
      await logAudit('DATABASE_CLEAR', 'Equipment Master', `Cleared all (${allIds.length}) equipment records from database`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'equipment/clear-all');
    }
  };

  const importFromExcel = async (rows: any[]): Promise<{ added: number; updated: number }> => {
    if (!isEditor) {
      throw new Error('Access denied: Only approved editors and admins can import Excel sheets.');
    }

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DB_CLEARED_STORAGE_KEY);
    }

    let added = 0;
    let updated = 0;
    const importedRecords: EquipmentItem[] = [];

    rows.forEach((row) => {
      const tag = String(row['Equipment Tag No.'] || row.EquipmentTagNo || '').trim();
      if (!tag) return;

      const docId = tag.replace(/[^a-zA-Z0-9_-]/g, '_');
      const existingItem = equipment.find((e) => e.id === docId || e.EquipmentTagNo === tag);
      if (existingItem) updated++;
      else added++;

      const record = normalizeEquipmentRecord({
        id: docId,
        Unit: String(row.Unit || existingItem?.Unit || 'RPTU').trim(),
        SubUnit: String(row['Sub-Unit'] || row.SubUnit || existingItem?.SubUnit || '').trim(),
        SystemNo: String(row['System No.'] || row.SystemNo || existingItem?.SystemNo || '').trim(),
        EquipmentTagNo: tag,
        EquipmentDescription: String(
          row['Equipment Description'] || row.EquipmentDescription || existingItem?.EquipmentDescription || ''
        ).trim(),
        EquipmentType: String(row['Equipment Type'] || row.EquipmentType || existingItem?.EquipmentType || '').trim(),
        FormatIStatus: String(row['Format-I Status'] || row.FormatIStatus || existingItem?.FormatIStatus || '').trim(),
        FormatIDate: String(row['Format-I Date'] || row.FormatIDate || existingItem?.FormatIDate || '').trim(),
        FormatIIStatus: String(row['Format-II Status'] || row.FormatIIStatus || existingItem?.FormatIIStatus || '').trim(),
        FormatIIDate: String(row['Format-II Date'] || row.FormatIIDate || existingItem?.FormatIIDate || '').trim(),
        FormatIIIStatus: String(row['Format-III Status'] || row.FormatIIIStatus || existingItem?.FormatIIIStatus || '').trim(),
        FormatIIIDate: String(row['Format-III Date'] || row.FormatIIIDate || existingItem?.FormatIIIDate || '').trim(),
        InternalInspectionStatus: String(
          row['Internal Inspection Status'] || row.InternalInspectionStatus || existingItem?.InternalInspectionStatus || ''
        ).trim(),
        BaseLineUTG: String(
          row['Base Line UTG'] ||
            row['Baseline UTG'] ||
            row.BaseLineUTG ||
            existingItem?.BaseLineUTG ||
            ''
        ).trim(),
        PunchPointsCategoryClosed: String(
          row['Punch Points Category Closed'] || row.PunchPointsCategoryClosed || existingItem?.PunchPointsCategoryClosed || ''
        ).trim(),
        FinalSystemAcceptance: String(
          row['Final System Acceptance'] || row.FinalSystemAcceptance || existingItem?.FinalSystemAcceptance || ''
        ).trim(),
        DocumentDrawing: String(
          row['Document/Drawing'] ||
            row['Document / Drawing'] ||
            row['Document & Drawing'] ||
            row.DocumentDrawing ||
            row.Link ||
            existingItem?.DocumentDrawing ||
            ''
        ).trim(),
        Remarks: String(row.Remarks || existingItem?.Remarks || '').trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || profile?.email || 'Excel Import',
      });

      importedRecords.push(record);
    });

    // Update local state & localStorage immediately
    updateEquipmentStateAndCache((prev) => {
      const map = new Map<string, EquipmentItem>();
      prev.forEach((item) => map.set(item.id, item));
      importedRecords.forEach((rec) => map.set(rec.id, rec));
      return Array.from(map.values());
    });

    // Sync to Firestore if quota permits
    await safeFirestoreWrite(async () => {
      const BATCH_SIZE = 400;
      for (let i = 0; i < importedRecords.length; i += BATCH_SIZE) {
        const slice = importedRecords.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);
        slice.forEach((record) => {
          batch.set(doc(db, 'equipment', record.id), record);
        });
        await batch.commit();
      }
    });

    await logAudit('EXCEL_IMPORT', 'Equipment Master', `Imported ${importedRecords.length} rows (${added} new, ${updated} updated)`);
    return { added, updated };
  };

  const resetToSampleData = async () => {
    if (!isAdmin) {
      throw new Error('Access denied: Only administrators can reset the database.');
    }

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DB_CLEARED_STORAGE_KEY);
    }

    const seededItems: EquipmentItem[] = SAMPLE_EQUIPMENT_DATA.map((sample) => {
      const docId = sample.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_');
      return normalizeEquipmentRecord({
        ...sample,
        id: docId,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || profile?.email || 'Admin Reset',
      });
    });

    const previousItems = [...equipment];
    updateEquipmentStateAndCache(seededItems);

    await safeFirestoreWrite(async () => {
      const batch = writeBatch(db);
      previousItems.forEach((item) => {
        batch.delete(doc(db, 'equipment', item.id));
      });
      seededItems.forEach((itemObj) => {
        batch.set(doc(db, 'equipment', itemObj.id), itemObj);
      });
      await batch.commit();
    });

    await logAudit('DATABASE_RESET', 'Equipment Master', 'Re-initialized equipment collection to revised 7 Units + 8 UTILITY Sub-Units dataset');
  };

  return (
    <EquipmentContext.Provider
      value={{
        equipment,
        loading,
        error,
        updateEquipmentField,
        saveEquipment,
        deleteEquipment,
        bulkDeleteEquipment,
        clearAllEquipment,
        importFromExcel,
        resetToSampleData,
        auditLogs,
      }}
    >
      {children}
    </EquipmentContext.Provider>
  );
}

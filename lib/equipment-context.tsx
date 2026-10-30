'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  addDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { EquipmentItem, SAMPLE_EQUIPMENT_DATA, AuditLogItem } from './types';
import { useAuth } from './auth-context';

interface EquipmentContextType {
  equipment: EquipmentItem[];
  loading: boolean;
  error: string | null;
  updateEquipmentField: (id: string, field: keyof EquipmentItem, value: any) => Promise<void>;
  saveEquipment: (item: Partial<EquipmentItem> & { EquipmentTagNo: string }) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
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
  importFromExcel: async () => ({ added: 0, updated: 0 }),
  resetToSampleData: async () => {},
  auditLogs: [],
});

export const useEquipment = () => useContext(EquipmentContext);

export function EquipmentProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, isEditor, isAdmin, loading: authLoading } = useAuth();
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to log audit events
  const logAudit = async (action: string, target: string, details?: string) => {
    try {
      const logsRef = collection(db, 'audit_logs');
      await addDoc(logsRef, {
        action,
        target,
        userEmail: user?.email || profile?.email || profile?.displayName || 'Anonymous',
        timestamp: new Date().toISOString(),
        details: details || '',
      });
    } catch (err) {
      console.warn('Could not write audit log:', err);
    }
  };

  // Listen to Firestore equipment collection in real time
  useEffect(() => {
    const eqCollection = collection(db, 'equipment');

    const unsubscribe = onSnapshot(
      eqCollection,
      async (snapshot) => {
        if (snapshot.empty && isEditor) {
          // If Firestore is completely empty and user/profile is logged in editor/admin, seed with domain sample data
          try {
            console.log('Seeding initial equipment master data into Firestore...');
            const batch = writeBatch(db);
            SAMPLE_EQUIPMENT_DATA.forEach((sample) => {
              const docId = sample.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_');
              const docRef = doc(db, 'equipment', docId);
              batch.set(docRef, {
                ...sample,
                id: docId,
                updatedAt: new Date().toISOString(),
                updatedBy: user?.email || profile?.email || 'System Seed',
              }, { merge: true });
            });
            await batch.commit();
            await logAudit('SYSTEM_SEED', 'Equipment Master', 'Initial baseline equipment seeded');
          } catch (seedErr) {
            console.error('Initial seed error:', seedErr);
            setEquipment(
              SAMPLE_EQUIPMENT_DATA.map((s) => ({
                ...s,
                id: s.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_'),
              }))
            );
            setLoading(false);
          }
          return;
        }

        if (snapshot.empty) {
          // If db has not been seeded yet, present local sample data
          setEquipment(
            SAMPLE_EQUIPMENT_DATA.map((s) => ({
              ...s,
              id: s.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_'),
            }))
          );
          setLoading(false);
          return;
        }

        const items: EquipmentItem[] = [];
        snapshot.forEach((docSnap) => {
          items.push({
            id: docSnap.id,
            ...(docSnap.data() as Omit<EquipmentItem, 'id'>),
          });
        });

        setEquipment(items);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.warn('Firestore onSnapshot error on equipment:', err.message);
        // Fallback to sample data gracefully if permission denied while unauthenticated
        setEquipment(
          SAMPLE_EQUIPMENT_DATA.map((s) => ({
            ...s,
            id: s.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_'),
          }))
        );
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile?.uid, isEditor]);

  // Listen to audit logs when user or profile is signed in
  useEffect(() => {
    if (!user && !profile) return;
    const logsQuery = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const logs: AuditLogItem[] = [];
        snapshot.forEach((doc) => {
          logs.push({ id: doc.id, ...(doc.data() as Omit<AuditLogItem, 'id'>) });
        });
        setAuditLogs(logs);
      },
      (err) => {
        console.warn('Audit logs listener note:', err.message);
      }
    );
    return () => {
      unsubscribe();
      setAuditLogs([]);
    };
  }, [user, profile]);

  const updateEquipmentField = async (id: string, field: keyof EquipmentItem, value: any) => {
    if (!isEditor) {
      throw new Error('Access denied: You do not have editor or admin permissions.');
    }

    const existingItem =
      equipment.find((e) => e.id === id || e.EquipmentTagNo === id) ||
      SAMPLE_EQUIPMENT_DATA.map((s) => ({
        ...s,
        id: s.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_'),
      })).find((s) => s.id === id || s.EquipmentTagNo === id);

    const docId = existingItem?.id || id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = doc(db, 'equipment', docId);
    const actorEmail = user?.email || profile?.email || profile?.displayName || 'Unknown';
    const nowIso = new Date().toISOString();

    const updatePayload: Record<string, any> = {
      ...(existingItem || { id: docId, EquipmentTagNo: id }),
      [field]: value,
      updatedAt: nowIso,
      updatedBy: actorEmail,
    };

    // Optimistic local state update so UI reflects immediately
    setEquipment((prev) =>
      prev.map((item) =>
        item.id === docId || item.id === id
          ? ({ ...item, [field]: value, updatedAt: nowIso, updatedBy: actorEmail } as EquipmentItem)
          : item
      )
    );

    try {
      await setDoc(docRef, updatePayload, { merge: true });
      await logAudit('UPDATE_FIELD', docId, `Updated ${String(field)} to "${value}"`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `equipment/${docId}`);
    }
  };

  const saveEquipment = async (item: Partial<EquipmentItem> & { EquipmentTagNo: string }) => {
    if (!isEditor) {
      throw new Error('Access denied: You do not have editor or admin permissions.');
    }

    const docId = item.id || item.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = doc(db, 'equipment', docId);
    const actorEmail = user?.email || profile?.email || profile?.displayName || 'Unknown';

    const payload: EquipmentItem = {
      id: docId,
      Unit: item.Unit || 'Unassigned',
      AreaPackage: item.AreaPackage ?? '',
      SystemNo: item.SystemNo || 'General',
      EquipmentTagNo: item.EquipmentTagNo,
      EquipmentDescription: item.EquipmentDescription ?? '',
      EquipmentType: item.EquipmentType ?? '',
      RFINo: item.RFINo ?? '',
      FormatIStatus: item.FormatIStatus ?? '',
      FormatIDate: item.FormatIDate ?? '',
      FormatIIStatus: item.FormatIIStatus ?? '',
      FormatIIDate: item.FormatIIDate ?? '',
      FormatIIIStatus: item.FormatIIIStatus ?? '',
      FormatIIIDate: item.FormatIIIDate ?? '',
      CategoryAStatus: item.CategoryAStatus ?? '',
      InternalInspectionStatus: item.InternalInspectionStatus ?? '',
      MediaFillingClearance: item.MediaFillingClearance ?? '',
      PunchPointsCategoryClosed: item.PunchPointsCategoryClosed ?? '',
      FinalSystemAcceptance: item.FinalSystemAcceptance ?? '',
      LastInspectionDate: item.LastInspectionDate ?? '',
      ResponsibleAgency: item.ResponsibleAgency ?? '',
      Remarks: item.Remarks ?? '',
      Link: item.Link ?? '',
      updatedAt: new Date().toISOString(),
      updatedBy: actorEmail,
    };

    // Optimistic local state update
    setEquipment((prev) => {
      const exists = prev.some((e) => e.id === docId);
      if (exists) {
        return prev.map((e) => (e.id === docId ? payload : e));
      }
      return [...prev, payload];
    });

    try {
      await setDoc(docRef, payload, { merge: true });
      await logAudit('SAVE_EQUIPMENT', docId, `Saved equipment ${item.EquipmentTagNo}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `equipment/${docId}`);
    }
  };

  const deleteEquipment = async (id: string) => {
    if (!isAdmin) {
      throw new Error('Access denied: Only administrators can delete equipment records.');
    }

    try {
      await deleteDoc(doc(db, 'equipment', id));
      await logAudit('DELETE_EQUIPMENT', id, `Deleted equipment record ${id}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `equipment/${id}`);
    }
  };

  const importFromExcel = async (rows: any[]): Promise<{ added: number; updated: number }> => {
    if (!isEditor) {
      throw new Error('Access denied: Only approved editors and admins can import Excel sheets.');
    }

    let added = 0;
    let updated = 0;

    // Chunk batch writes (Firestore limit: 500 operations per batch)
    const BATCH_SIZE = 400;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);

      slice.forEach((row) => {
        const tag = String(row['Equipment Tag No.'] || row.EquipmentTagNo || '').trim();
        if (!tag) return;

        const docId = tag.replace(/[^a-zA-Z0-9_-]/g, '_');
        const docRef = doc(db, 'equipment', docId);

        const existingItem = equipment.find((e) => e.id === docId || e.EquipmentTagNo === tag);
        if (existingItem) updated++;
        else added++;

        const record: EquipmentItem = {
          id: docId,
          Unit: String(row.Unit || existingItem?.Unit || 'Unassigned').trim(),
          AreaPackage: String(row['Area / Package'] || row.AreaPackage || existingItem?.AreaPackage || '').trim(),
          SystemNo: String(row['System No.'] || row.SystemNo || existingItem?.SystemNo || 'General System').trim(),
          EquipmentTagNo: tag,
          EquipmentDescription: String(
            row['Equipment Description'] || row.EquipmentDescription || existingItem?.EquipmentDescription || ''
          ).trim(),
          EquipmentType: String(row['Equipment Type'] || row.EquipmentType || existingItem?.EquipmentType || '').trim(),
          RFINo: String(row['RFI No.'] || row.RFINo || existingItem?.RFINo || '').trim(),
          FormatIStatus: String(row['Format-I Status'] || row.FormatIStatus || existingItem?.FormatIStatus || '').trim(),
          FormatIDate: String(row['Format-I Date'] || row.FormatIDate || existingItem?.FormatIDate || '').trim(),
          FormatIIStatus: String(row['Format-II Status'] || row.FormatIIStatus || existingItem?.FormatIIStatus || '').trim(),
          FormatIIDate: String(row['Format-II Date'] || row.FormatIIDate || existingItem?.FormatIIDate || '').trim(),
          FormatIIIStatus: String(row['Format-III Status'] || row.FormatIIIStatus || existingItem?.FormatIIIStatus || '').trim(),
          FormatIIIDate: String(row['Format-III Date'] || row.FormatIIIDate || existingItem?.FormatIIIDate || '').trim(),
          CategoryAStatus: String(row['Category-A Status'] || row.CategoryAStatus || existingItem?.CategoryAStatus || '').trim(),
          InternalInspectionStatus: String(
            row['Internal Inspection Status'] || row.InternalInspectionStatus || existingItem?.InternalInspectionStatus || ''
          ).trim(),
          MediaFillingClearance: String(
            row['Media Filling Clearance'] || row.MediaFillingClearance || existingItem?.MediaFillingClearance || ''
          ).trim(),
          PunchPointsCategoryClosed: String(
            row['Punch Points Category Closed'] || row.PunchPointsCategoryClosed || existingItem?.PunchPointsCategoryClosed || ''
          ).trim(),
          FinalSystemAcceptance: String(
            row['Final System Acceptance'] || row.FinalSystemAcceptance || existingItem?.FinalSystemAcceptance || ''
          ).trim(),
          LastInspectionDate: String(
            row['Last Inspection Date'] || row.LastInspectionDate || existingItem?.LastInspectionDate || ''
          ).trim(),
          ResponsibleAgency: String(
            row['Responsible Agency / Person'] || row.ResponsibleAgency || existingItem?.ResponsibleAgency || ''
          ).trim(),
          Remarks: String(row.Remarks || existingItem?.Remarks || '').trim(),
          Link: String(row.Link || existingItem?.Link || '').trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: user?.email || 'Excel Import',
        };

        batch.set(docRef, record, { merge: true });
      });

      await batch.commit();
    }

    await logAudit('EXCEL_IMPORT', 'Equipment Master', `Imported ${rows.length} rows (${added} new, ${updated} updated)`);
    return { added, updated };
  };

  const resetToSampleData = async () => {
    if (!isAdmin) {
      throw new Error('Access denied: Only administrators can reset the database.');
    }

    // Delete existing equipment
    const batch = writeBatch(db);
    equipment.forEach((item) => {
      batch.delete(doc(db, 'equipment', item.id));
    });

    SAMPLE_EQUIPMENT_DATA.forEach((sample) => {
      const docId = sample.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_');
      batch.set(doc(db, 'equipment', docId), {
        ...sample,
        id: docId,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || 'Admin Reset',
      });
    });

    await batch.commit();
    await logAudit('DATABASE_RESET', 'Equipment Master', 'Re-initialized equipment collection to baseline sample dataset');
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
        importFromExcel,
        resetToSampleData,
        auditLogs,
      }}
    >
      {children}
    </EquipmentContext.Provider>
  );
}

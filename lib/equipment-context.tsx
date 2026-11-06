'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from './supabase';
import {
  EquipmentItem,
  AuditLogItem,
  ProjectUnitsConfig,
  UNITS,
  UTILITY_SUB_UNITS,
  MSP_SUB_UNITS,
  applyDynamicUnitsConfig,
  normalizeEquipmentRecord,
  isAllUnitsScope,
  getUserAllowedUnits,
  canUserAccessUnit,
} from './types';
import { useAuth, buildAuthHeaders } from './auth-context';

interface EquipmentContextType {
  equipment: EquipmentItem[];
  unitsConfig: ProjectUnitsConfig;
  updateUnitsConfig: (nextConfig: Partial<ProjectUnitsConfig>) => Promise<ProjectUnitsConfig>;
  loading: boolean;
  error: string | null;
  updateEquipmentField: (id: string, field: keyof EquipmentItem, value: any) => Promise<void>;
  saveEquipment: (item: Partial<EquipmentItem> & { EquipmentTagNo: string }) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
  bulkDeleteEquipment: (ids: string[]) => Promise<void>;
  clearAllEquipment: () => Promise<void>;
  importFromExcel: (rows: any[]) => Promise<{ added: number; updated: number }>;
  resetToSampleData: () => Promise<void>;
  refreshEquipment: () => Promise<void>;
  auditLogs: AuditLogItem[];
}

const EquipmentContext = createContext<EquipmentContextType>({
  equipment: [],
  unitsConfig: {
    units: [...UNITS],
    utilitySubUnits: [...UTILITY_SUB_UNITS],
    mspSubUnits: [...MSP_SUB_UNITS],
  },
  updateUnitsConfig: async () => ({
    units: [...UNITS],
    utilitySubUnits: [...UTILITY_SUB_UNITS],
    mspSubUnits: [...MSP_SUB_UNITS],
  }),
  loading: true,
  error: null,
  updateEquipmentField: async () => {},
  saveEquipment: async () => {},
  deleteEquipment: async () => {},
  bulkDeleteEquipment: async () => {},
  clearAllEquipment: async () => {},
  importFromExcel: async () => ({ added: 0, updated: 0 }),
  resetToSampleData: async () => {},
  refreshEquipment: async () => {},
  auditLogs: [],
});

export const useEquipment = () => useContext(EquipmentContext);

/**
 * No hardcoded equipment dataset — all records come strictly from live Supabase.
 */
export function getDefaultEquipmentDataset(): EquipmentItem[] {
  return [];
}

export function EquipmentProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, isEditor, isAdmin, accessToken } = useAuth();
  const canManageLiveDatabase =
    isAdmin || profile?.role === 'lead_engineer';
  // Strictly synchronized with live Supabase server state — no hardcoded initial data
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [unitsConfig, setUnitsConfig] = useState<ProjectUnitsConfig>({
    units: [...UNITS],
    utilitySubUnits: [...UTILITY_SUB_UNITS],
    mspSubUnits: [...MSP_SUB_UNITS],
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Clean up any legacy localStorage caches so deleted Supabase records never come back from browser storage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem('nrep_equipment_local_cache_v5');
      window.localStorage.removeItem('nrep_audit_logs_local_v5');
      window.localStorage.removeItem('nrep_db_intentionally_cleared_v2');
    } catch {}
  }, []);

  const fetchSupabaseEquipment = useCallback(async () => {
    try {
      const res = await fetch('/api/equipment', {
        method: 'GET',
        headers: buildAuthHeaders(),
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.unitsConfig) {
          applyDynamicUnitsConfig(json.unitsConfig);
          setUnitsConfig(json.unitsConfig);
        }
        if (json?.ok && Array.isArray(json.equipment)) {
          const normalized = json.equipment.map((row: any) => normalizeEquipmentRecord(row));
          setEquipment(normalized);
          setError(null);
        }
      }
    } catch (err: any) {
      console.warn('Equipment API fetch note:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [user, profile]);

  const updateUnitsConfig = async (
    nextConfig: Partial<ProjectUnitsConfig>
  ): Promise<ProjectUnitsConfig> => {
    if (!canManageLiveDatabase) {
      throw new Error('Access denied: Only Administrators and Lead Engineers can modify server units.');
    }
    const res = await fetch('/api/units-config', {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(nextConfig),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok || !json?.unitsConfig) {
      throw new Error(json?.error || 'Failed to update units configuration on server.');
    }
    applyDynamicUnitsConfig(json.unitsConfig);
    setUnitsConfig(json.unitsConfig);
    await logAudit(
      'UPDATE_UNITS_CONFIG',
      'Project Structure',
      `Updated server units configuration (${json.unitsConfig.units.join(', ')})`
    );
    return json.unitsConfig;
  };

  // Helper to log audit events via server-enforced /api/audit-logs
  const logAudit = async (action: string, target: string, details?: string) => {
    const newEntry: AuditLogItem = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      action,
      target,
      userEmail: user?.email || profile?.email || profile?.displayName || 'Authenticated User',
      timestamp: new Date().toISOString(),
      details: details || '',
    };

    setAuditLogs((prev) => [newEntry, ...prev].slice(0, 50));

    try {
      await fetch('/api/audit-logs', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: newEntry.id,
          action,
          target,
          details: details || '',
        }),
      });
    } catch {}
  };

  // Live synchronization with Supabase equipment table + Realtime channel
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSupabaseEquipment();
    }, 0);

    const supabase = getSupabaseClient();
    if (!supabase || (!user && !profile)) {
      return () => clearTimeout(timer);
    }

    const channel = supabase
      .channel('nrep-equipment-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'equipment' },
        () => {
          fetchSupabaseEquipment();
        }
      )
      .subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [user?.uid, profile?.uid, accessToken, fetchSupabaseEquipment]);

  // Automatic Two-Way Deletion Sync: detect reports deleted/trashed in Google Drive and remove from app
  useEffect(() => {
    if (!user && !profile) return;
    let active = true;
    let running = false;

    const reconcileDeletedDriveReports = async () => {
      if (running || !active) return;
      running = true;
      try {
        const res = await fetch('/api/reports/reconcile', {
          method: 'POST',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const json = await res.json();
          if (active && json?.ok && json.removedCount > 0) {
            await fetchSupabaseEquipment();
          }
        }
      } catch {
        // Ignore transient network errors
      } finally {
        running = false;
      }
    };

    const initialTimer = setTimeout(reconcileDeletedDriveReports, 1200);
    const interval = setInterval(reconcileDeletedDriveReports, 30000);

    const handleFocus = () => {
      reconcileDeletedDriveReports();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        reconcileDeletedDriveReports();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      active = false;
      clearTimeout(initialTimer);
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [user?.uid, profile?.uid, accessToken, fetchSupabaseEquipment]);

  // Live synchronization with Supabase audit_logs for authorized roles (admin / lead_engineer)
  useEffect(() => {
    if (!user && !profile) {
      const timer = setTimeout(() => {
        setAuditLogs([]);
      }, 0);
      return () => clearTimeout(timer);
    }
    const role = profile?.role;
    if (!isAdmin && role !== 'lead_engineer') return;

    const fetchLogs = async () => {
      try {
        const res = await fetch('/api/audit-logs', {
          method: 'GET',
          headers: buildAuthHeaders(),
          cache: 'no-store',
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.ok && Array.isArray(json.auditLogs)) {
            setAuditLogs(json.auditLogs as AuditLogItem[]);
          }
        }
      } catch {}
    };
    fetchLogs();

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel('nrep-audit-logs-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'audit_logs' },
        () => {
          fetchLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.uid, profile?.uid, profile?.role, isAdmin, accessToken]);

  const updateEquipmentField = async (id: string, field: keyof EquipmentItem, value: any) => {
    if (!isEditor) {
      throw new Error('Access denied: You do not have engineering or admin permissions to edit equipment.');
    }

    const existingItem = equipment.find((e) => e.id === id || e.EquipmentTagNo === id);
    const docId = existingItem?.id || id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const actorEmail = user?.email || profile?.email || profile?.displayName || 'Unknown';
    const nowIso = new Date().toISOString();

    const updatePayload = normalizeEquipmentRecord({
      ...(existingItem || { id: docId, EquipmentTagNo: id }),
      [field]: value,
      updatedAt: nowIso,
      updatedBy: actorEmail,
    });

    if (profile && !isAllUnitsScope(profile.assignedUnits) && !canUserAccessUnit(profile, updatePayload.Unit)) {
      const allowedList = getUserAllowedUnits(profile).join(', ');
      throw new Error(
        `Permission Denied: Your Assigned Scope is restricted to "${allowedList}". You do not have permission to modify equipment in "${updatePayload.Unit}".`
      );
    }

    setEquipment((prev) =>
      prev.map((item) => (item.id === docId || item.id === id ? updatePayload : item))
    );

    const res = await fetch('/api/equipment', {
      method: 'PATCH',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: docId,
        field,
        value,
        record: updatePayload,
      }),
    });

    if (!res.ok) {
      await fetchSupabaseEquipment();
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || 'Failed to update equipment field on server.');
    }

    await logAudit('UPDATE_FIELD', docId, `Updated ${String(field)} to "${value}"`);
  };

  const saveEquipment = async (item: Partial<EquipmentItem> & { EquipmentTagNo: string }) => {
    if (!isEditor) {
      throw new Error('Access denied: You do not have engineering or admin permissions to save equipment.');
    }

    const docId = item.id || item.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const actorEmail = user?.email || profile?.email || profile?.displayName || 'Unknown';

    const payload = normalizeEquipmentRecord({
      ...item,
      id: docId,
      updatedAt: new Date().toISOString(),
      updatedBy: actorEmail,
    });

    if (profile && !isAllUnitsScope(profile.assignedUnits) && !canUserAccessUnit(profile, payload.Unit)) {
      const allowedList = getUserAllowedUnits(profile).join(', ');
      throw new Error(
        `Permission Denied: Your Assigned Scope is restricted to "${allowedList}". You do not have permission to add or save equipment in "${payload.Unit}".`
      );
    }

    setEquipment((prev) => {
      const exists = prev.some((e) => e.id === docId);
      if (exists) {
        return prev.map((e) => (e.id === docId ? payload : e));
      }
      return [...prev, payload];
    });

    const res = await fetch('/api/equipment', {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ item: payload }),
    });

    if (!res.ok) {
      await fetchSupabaseEquipment();
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || 'Failed to save equipment record on server.');
    }

    await logAudit(
      'SAVE_EQUIPMENT',
      docId,
      `Saved equipment ${item.EquipmentTagNo} (${payload.Unit}${payload.SubUnit ? ' › ' + payload.SubUnit : ''})`
    );
  };

  const deleteEquipment = async (id: string) => {
    if (!canManageLiveDatabase) {
      throw new Error('Access denied: Only Administrators and Lead Engineers can delete equipment records.');
    }

    const targetItem = equipment.find((e) => e.id === id || e.EquipmentTagNo === id);
    const docId = targetItem?.id || id.replace(/[^a-zA-Z0-9_-]/g, '_');

    setEquipment((prev) =>
      prev.filter((e) => e.id !== id && e.id !== docId && e.EquipmentTagNo !== id)
    );

    const res = await fetch('/api/equipment', {
      method: 'DELETE',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ids: [docId, id] }),
    });

    if (!res.ok) {
      await fetchSupabaseEquipment();
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || 'Failed to delete equipment record on server.');
    }

    await logAudit(
      'DELETE_EQUIPMENT',
      docId,
      `Deleted equipment record ${targetItem?.EquipmentTagNo || id}`
    );
  };

  const bulkDeleteEquipment = async (ids: string[]) => {
    if (!canManageLiveDatabase) {
      throw new Error('Access denied: Only Administrators and Lead Engineers can delete equipment records.');
    }
    if (!ids.length) return;

    const idSet = new Set(ids);
    setEquipment((prev) =>
      prev.filter((e) => !idSet.has(e.id) && !idSet.has(e.EquipmentTagNo))
    );

    const normalizedIds = Array.from(
      new Set(ids.flatMap((raw) => [raw, raw.replace(/[^a-zA-Z0-9_-]/g, '_')]))
    );

    const res = await fetch('/api/equipment', {
      method: 'DELETE',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ids: normalizedIds }),
    });

    if (!res.ok) {
      await fetchSupabaseEquipment();
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || 'Failed to bulk delete equipment records on server.');
    }

    await logAudit(
      'BULK_DELETE_EQUIPMENT',
      'Equipment Master',
      `Deleted ${ids.length} equipment records`
    );
  };

  const clearAllEquipment = async () => {
    if (!canManageLiveDatabase) {
      throw new Error('Access denied: Only Administrators and Lead Engineers can clear the database.');
    }

    const prevCount = equipment.length;
    setEquipment([]);

    const res = await fetch('/api/equipment', {
      method: 'DELETE',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'clear-all', clearAll: true }),
    });

    if (!res.ok) {
      await fetchSupabaseEquipment();
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || 'Failed to clear equipment database on server.');
    }

    await logAudit(
      'DATABASE_CLEAR',
      'Equipment Master',
      `Cleared all (${prevCount}) equipment records from database`
    );
  };

  const importFromExcel = async (rows: any[]): Promise<{ added: number; updated: number }> => {
    if (!isEditor) {
      throw new Error('Access denied: Only approved engineers and admins can import Excel sheets.');
    }

    const isUnitScoped = Boolean(profile && !isAllUnitsScope(profile.assignedUnits));
    const allowedUnits = getUserAllowedUnits(profile);
    const allowedUnitsSet = new Set(allowedUnits.map((u) => u.toUpperCase()));
    const unauthorizedUnitsSet = new Set<string>();

    let added = 0;
    let updated = 0;
    const importedMap = new Map<string, EquipmentItem>();
    const existingIds = new Set(equipment.map((e) => e.id));
    const existingTags = new Set(equipment.map((e) => e.EquipmentTagNo));

    rows.forEach((row) => {
      const tag = String(row['Equipment Tag No.'] || row.EquipmentTagNo || '').trim();
      if (!tag) return;

      const docId = tag.replace(/[^a-zA-Z0-9_-]/g, '_');
      const existingItem =
        importedMap.get(docId) ||
        equipment.find((e) => e.id === docId || e.EquipmentTagNo === tag);

      const rawSubUnitFromExcel =
        row['Sub-Unit'] ?? row['Sub Unit'] ?? row.SubUnit ?? '';
      const rawSystemFromExcel =
        row['System No.'] ?? row['System'] ?? row.SystemNo ?? '';
      const rawSubSystemFromExcel =
        row['Sub-System'] ?? row['Sub System'] ?? row['SubSystem'] ?? row.SubSystem ?? '';

      const record = normalizeEquipmentRecord({
        id: docId,
        Unit: String(row.Unit || row['Unit'] || existingItem?.Unit || allowedUnits[0] || 'RPTU').trim(),
        SubUnit: String(rawSubUnitFromExcel).trim(),
        SystemNo: String(rawSystemFromExcel).trim(),
        SubSystem: String(rawSubSystemFromExcel).trim(),
        EquipmentTagNo: tag,
        EquipmentDescription: String(
          row['Equipment Description'] ||
            row.EquipmentDescription ||
            existingItem?.EquipmentDescription ||
            ''
        ).trim(),
        EquipmentType: String(
          row['Equipment Type'] || row.EquipmentType || existingItem?.EquipmentType || ''
        ).trim(),
        FormatIStatus: String(
          row['Format-I Status'] || row.FormatIStatus || existingItem?.FormatIStatus || ''
        ).trim(),
        FormatIDate: String(
          row['Format-I Date'] || row.FormatIDate || existingItem?.FormatIDate || ''
        ).trim(),
        FormatIIStatus: String(
          row['Format-II Status'] || row.FormatIIStatus || existingItem?.FormatIIStatus || ''
        ).trim(),
        FormatIIDate: String(
          row['Format-II Date'] || row.FormatIIDate || existingItem?.FormatIIDate || ''
        ).trim(),
        FormatIIIStatus: String(
          row['Format-III Status'] || row.FormatIIIStatus || existingItem?.FormatIIIStatus || ''
        ).trim(),
        FormatIIIDate: String(
          row['Format-III Date'] || row.FormatIIIDate || existingItem?.FormatIIIDate || ''
        ).trim(),
        FormatIVStatus: String(
          row['Format-IV Status'] || row.FormatIVStatus || existingItem?.FormatIVStatus || ''
        ).trim(),
        FormatIVDate: String(
          row['Format-IV Date'] || row.FormatIVDate || existingItem?.FormatIVDate || ''
        ).trim(),
        FormatVStatus: String(
          row['Format-V Status'] || row.FormatVStatus || existingItem?.FormatVStatus || ''
        ).trim(),
        FormatVDate: String(
          row['Format-V Date'] || row.FormatVDate || existingItem?.FormatVDate || ''
        ).trim(),
        InternalInspectionStatus: String(
          row['Internal Inspection Status'] ||
            row.InternalInspectionStatus ||
            existingItem?.InternalInspectionStatus ||
            ''
        ).trim(),
        BaseLineUTG: String(
          row['Base Line UTG'] ||
            row['Baseline UTG'] ||
            row.BaseLineUTG ||
            existingItem?.BaseLineUTG ||
            ''
        ).trim(),
        PMI: String(
          row['PMI'] ||
            row['PMI Status'] ||
            row.PMI ||
            existingItem?.PMI ||
            ''
        ).trim(),
        FinalSystemAcceptance: String(
          row['Final System Acceptance'] ||
            row.FinalSystemAcceptance ||
            existingItem?.FinalSystemAcceptance ||
            ''
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

      if (isUnitScoped && !allowedUnitsSet.has(record.Unit.trim().toUpperCase())) {
        unauthorizedUnitsSet.add(record.Unit.trim().toUpperCase());
        return;
      }

      if (!importedMap.has(docId)) {
        if (existingIds.has(docId) || existingTags.has(tag)) updated++;
        else added++;
      }

      importedMap.set(docId, record);
    });

    if (isUnitScoped && unauthorizedUnitsSet.size > 0) {
      const unauthorizedList = Array.from(unauthorizedUnitsSet).join(', ');
      throw new Error(
        `Permission Denied: Your Assigned Scope is restricted to "${allowedUnits.join(', ')}". You do not have permission to upload Excel data for unit(s): ${unauthorizedList}.`
      );
    }

    const importedRecords = Array.from(importedMap.values());
    if (importedRecords.length === 0) {
      throw new Error('No valid equipment records found to import for your Assigned Scope.');
    }

    setEquipment((prev) => {
      const map = new Map<string, EquipmentItem>();
      prev.forEach((item) => map.set(item.id, item));
      importedRecords.forEach((rec) => map.set(rec.id, rec));
      return Array.from(map.values());
    });

    const BATCH_SIZE = 400;
    for (let i = 0; i < importedRecords.length; i += BATCH_SIZE) {
      const slice = importedRecords.slice(i, i + BATCH_SIZE);
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ items: slice }),
      });
      if (!res.ok) {
        await fetchSupabaseEquipment();
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || 'Failed to import Excel batch on server.');
      }
    }

    await logAudit(
      'EXCEL_IMPORT',
      'Equipment Master',
      `Imported ${importedRecords.length} unique rows (${added} new, ${updated} updated)`
    );
    return { added, updated };
  };

  const resetToSampleData = async () => {
    if (!canManageLiveDatabase) {
      throw new Error('Access denied: Only Administrators and Lead Engineers can reset the database.');
    }

    const res = await fetch('/api/equipment', {
      method: 'DELETE',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'reset-sample' }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || 'Failed to reset database on server.');
    }

    await fetchSupabaseEquipment();
    await logAudit(
      'DATABASE_RESET',
      'Equipment Master',
      'Re-initialized equipment dataset in Supabase'
    );
  };

  return (
    <EquipmentContext.Provider
      value={{
        equipment,
        unitsConfig,
        updateUnitsConfig,
        loading,
        error,
        updateEquipmentField,
        saveEquipment,
        deleteEquipment,
        bulkDeleteEquipment,
        clearAllEquipment,
        importFromExcel,
        resetToSampleData,
        refreshEquipment: fetchSupabaseEquipment,
        auditLogs,
      }}
    >
      {children}
    </EquipmentContext.Provider>
  );
}

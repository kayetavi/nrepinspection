'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { getSupabaseClient } from '@/lib/supabase';
import {
  useAuth,
  loadLocalUsersRegistry,
  saveLocalUsersRegistry,
  buildAuthHeaders,
} from '@/lib/auth-context';
import { useEquipment } from '@/lib/equipment-context';
import {
  UserProfile,
  UserRole,
  UserStatus,
  UNITS,
  UTILITY_SUB_UNITS,
  MSP_SUB_UNITS,
  resolveMspSubUnit,
  EquipmentItem,
  STATUS_COLUMNS,
  isDone,
  calculateProgress,
  getEquipmentOverallStatus,
  formatEquipmentHierarchyPath,
  getUserAllowedUnits,
  filterEquipmentByUserScope,
} from '@/lib/types';
import EquipmentEditModal from './EquipmentEditModal';
import InspectionReportModal from './InspectionReportModal';
import CloudFolderSyncModal from './CloudFolderSyncModal';
import {
  SweetWarningDeletePopup,
  SweetSuccessPopup,
  SweetSuccessMetaItem,
} from './SweetPopupModal';
import {
  parseEquipmentDocumentField,
  getProviderBadgeMeta,
} from '@/lib/reportUtils';
import {
  Shield,
  UserPlus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  X,
  Key,
  Eye,
  EyeOff,
  Save,
  Database,
  Plus,
  Edit3,
  RotateCcw,
  HardDrive,
  RefreshCw,
  Activity,
  Server,
  FolderOpen,
  FolderSync,
  FolderTree,
  Layers,
  Cpu,
  Upload,
  Download,
  Filter,
} from 'lucide-react';

export type AdminTabKey =
  | 'database'
  | 'structure'
  | 'users'
  | 'add'
  | 'cloud'
  | 'audit'
  | 'storage';

export type AdminSubAction =
  | 'search'
  | 'add_equip'
  | 'docs'
  | 'table'
  | 'clear_all'
  | 'reset_sample'
  | 'struct_units'
  | 'struct_subunits'
  | 'struct_types'
  | 'users_list'
  | 'users_roles'
  | 'users_scope'
  | 'users_add'
  | 'cloud_connect'
  | 'cloud_bulk'
  | 'cloud_sync'
  | 'audit_log'
  | 'audit_filters'
  | 'audit_export'
  | 'storage_meter'
  | 'storage_breakdown'
  | null;

interface StorageTelemetryData {
  ok: boolean;
  measuredAt: string;
  pingMs: number;
  projectRef: string;
  supabaseHost: string;
  database: {
    planTier: string;
    quotaBytes: number;
    usedBytes: number;
    rawPayloadBytes: number;
    remainingBytes: number;
    usedPercent: number;
    remainingPercent: number;
    totalRows: number;
    tableCount: number;
  };
  objectStorage: {
    planTier: string;
    quotaBytes: number;
    usedBytes: number;
    remainingBytes: number;
    usedPercent: number;
    remainingPercent: number;
    bucketCount: number;
    totalFiles: number;
  };
  tables: Array<{
    tableName: string;
    schema: string;
    description: string;
    rowCount: number;
    columnCount: number;
    rawJsonBytes: number;
    indexedStorageBytes: number;
    avgBytesPerRow: number;
    status: 'online' | 'empty' | 'unavailable';
  }>;
  unitBreakdown: Array<{
    unit: string;
    rowCount: number;
    rawBytes: number;
    indexedBytes: number;
    sharePercent: number;
  }>;
  buckets: Array<{
    id: string;
    name: string;
    public: boolean;
    fileCount: number;
    usedBytes: number;
    createdAt: string;
  }>;
}

function formatBytesHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

interface AdminPanelProps {
  onClose: () => void;
  inline?: boolean;
  initialTab?: AdminTabKey;
  activeTabOverride?: AdminTabKey;
  onTabChange?: (tab: AdminTabKey) => void;
  subActionTrigger?: { action: AdminSubAction; ts: number } | null;
}

export default function AdminPanel({
  onClose,
  inline = false,
  initialTab = 'database',
  activeTabOverride,
  onTabChange,
  subActionTrigger,
}: AdminPanelProps) {
  const { user, profile, isAdmin, refreshProfile } = useAuth();
  const isLeadEngineer = profile?.role === 'lead_engineer';
  const canAccessLiveDatabase = isAdmin || isLeadEngineer;
  const {
    equipment: rawEquipment,
    unitsConfig,
    updateUnitsConfig,
    updateEquipmentField,
    saveEquipment,
    deleteEquipment,
    bulkDeleteEquipment,
    clearAllEquipment,
    resetToSampleData,
    refreshEquipment,
    auditLogs,
  } = useEquipment();

  const [newServerUnitInput, setNewServerUnitInput] = useState('');
  const [savingServerUnit, setSavingServerUnit] = useState(false);

  const equipment = useMemo(
    () => filterEquipmentByUserScope(rawEquipment, profile),
    [rawEquipment, profile, unitsConfig]
  );

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [internalTab, setInternalTab] = useState<AdminTabKey>(initialTab);
  const activeTab = activeTabOverride ?? internalTab;

  const setActiveTab = useCallback(
    (nextTab: AdminTabKey) => {
      setInternalTab(nextTab);
      onTabChange?.(nextTab);
    },
    [onTabChange]
  );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Refs for smooth focus/scroll when triggered from sidebar hierarchy
  const dbSearchInputRef = useRef<HTMLInputElement>(null);
  const dbTableSectionRef = useRef<HTMLDivElement>(null);
  const auditFilterInputRef = useRef<HTMLInputElement>(null);
  const storageBreakdownRef = useRef<HTMLDivElement>(null);

  // Project Structure Sheet states
  const [structSection, setStructSection] = useState<'all' | 'units' | 'subunits' | 'types'>('all');
  const [structUnitFilter, setStructUnitFilter] = useState<string>('ALL');
  const [structTypeFilter, setStructTypeFilter] = useState<string>('ALL');
  const [structSearch, setStructSearch] = useState<string>('');

  // Audit Trail Filter states
  const [auditSearch, setAuditSearch] = useState('');
  const [auditUserFilter, setAuditUserFilter] = useState('all');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditDateFilter, setAuditDateFilter] = useState('');

  // Live Supabase Storage & Capacity Telemetry state
  const [storageStats, setStorageStats] = useState<StorageTelemetryData | null>(null);
  const [loadingStorageStats, setLoadingStorageStats] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Database Manager states
  const [dbSearch, setDbSearch] = useState('');
  const [dbUnitFilter, setDbUnitFilter] = useState('all');
  const [dbSubUnitFilter, setDbSubUnitFilter] = useState('all');
  const [dbTypeFilter, setDbTypeFilter] = useState('all');
  const [dbStatusFilter, setDbStatusFilter] = useState('all');
  const [dbDocsOnly, setDbDocsOnly] = useState(false);
  const [dbPage, setDbPage] = useState(1);
  const [dbPageSize, setDbPageSize] = useState(15);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingRecord, setEditingRecord] = useState<EquipmentItem | null>(null);
  const [reportModalRecord, setReportModalRecord] = useState<{
    item: EquipmentItem;
    tab?: 'view' | 'attach';
  } | null>(null);
  const [showCloudSyncModal, setShowCloudSyncModal] = useState(false);
  const [cloudSyncInitialTab, setCloudSyncInitialTab] = useState<'bulk_upload' | 'folder_sync' | 'drive_setup'>('bulk_upload');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmResetSample, setConfirmResetSample] = useState(false);
  const [confirmDeleteUserUid, setConfirmDeleteUserUid] = useState<string | null>(null);
  const [unitToDelete, setUnitToDelete] = useState<string | null>(null);
  const [deletingUnit, setDeletingUnit] = useState(false);
  const [openScopeDropdownUid, setOpenScopeDropdownUid] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [sweetSuccess, setSweetSuccess] = useState<{
    title: string;
    message: string;
    badgeText?: string;
    metaItems?: SweetSuccessMetaItem[];
  } | null>(null);

  // New user form state
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('lead_engineer');
  const [newStatus, setNewStatus] = useState<UserStatus>('approved');
  const [newUnits, setNewUnits] = useState('All');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submittingUser, setSubmittingUser] = useState(false);

  // Table row pending edits state for batch saving
  const [pendingUserEdits, setPendingUserEdits] = useState<{
    [uid: string]: {
      role?: UserRole;
      status?: UserStatus;
      assignedUnits?: string;
      password?: string;
      email?: string;
    };
  }>({});
  const [savingUsersSheet, setSavingUsersSheet] = useState(false);
  const [greenToast, setGreenToast] = useState<{ message: string; visible: boolean } | null>(null);

  // Table row password editing states
  const [passwordEdits, setPasswordEdits] = useState<{ [uid: string]: string }>({});
  const [visiblePasswords, setVisiblePasswords] = useState<{ [uid: string]: boolean }>({});
  const [savingPasswordUid, setSavingPasswordUid] = useState<string | null>(null);
  const [roleConstraintBlocked, setRoleConstraintBlocked] = useState(false);
  const [syncingRoles, setSyncingRoles] = useState(false);

  const showGreenToast = (message: string) => {
    setGreenToast({ message, visible: true });
    setTimeout(() => {
      setGreenToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  const showNotice = (text: string, type: 'success' | 'error' = 'success') => {
    if (type === 'success') {
      showGreenToast(text);
    } else {
      setStatusMsg({ text, type });
      setTimeout(() => setStatusMsg(null), 4000);
    }
  };

  const fetchStorageTelemetry = useCallback(async (showToast = false) => {
    if (!canAccessLiveDatabase) return;
    setLoadingStorageStats(true);
    setStorageError(null);
    try {
      const res = await fetch('/api/storage-stats', {
        method: 'GET',
        headers: buildAuthHeaders(),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load live Supabase storage stats');
      }
      setStorageStats(data as StorageTelemetryData);
      if (showToast) {
        showNotice(`Synced live Supabase storage stats (${data.pingMs} ms latency).`);
      }
    } catch (err: any) {
      setStorageError(err?.message || 'Unable to reach Supabase storage telemetry endpoint');
    } finally {
      setLoadingStorageStats(false);
    }
  }, [canAccessLiveDatabase]);

  // Automatically refresh storage stats when AdminPanel mounts or live record counts change
  useEffect(() => {
    if (!canAccessLiveDatabase) return;
    const timer = setTimeout(() => {
      fetchStorageTelemetry(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [canAccessLiveDatabase, equipment.length, users.length, auditLogs.length, fetchStorageTelemetry]);

  // Server-verified user list listener for administrators via /api/users
  useEffect(() => {
    if (!isAdmin) return;

    const fetchServerUsers = async () => {
      try {
        const res = await fetch('/api/users', {
          method: 'GET',
          headers: buildAuthHeaders(),
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.ok && Array.isArray(json.users)) {
            const list = json.users as UserProfile[];
            setUsers(list);
            saveLocalUsersRegistry(list);
            if (typeof json.constraintBlocked === 'boolean') {
              setRoleConstraintBlocked(json.constraintBlocked);
            }
            return;
          }
        }
      } catch {}
      setUsers(loadLocalUsersRegistry());
    };

    fetchServerUsers();

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel('nrep-users-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users' },
        () => {
          fetchServerUsers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  // Available units for filter (restricted to user's Assigned Scope)
  const allUnits = useMemo(() => {
    const allowed = getUserAllowedUnits(profile);
    const set = new Set<string>(allowed);
    equipment.forEach((e) => {
      if (e.Unit) set.add(e.Unit);
    });
    return Array.from(set);
  }, [equipment, profile]);

  const availableDbTypes = useMemo(() => {
    const counts = new Map<string, number>();
    equipment.forEach((item) => {
      if (dbUnitFilter !== 'all' && item.Unit !== dbUnitFilter) return;
      const t = (item.EquipmentType || '').trim();
      if (t) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, count]) => ({ type, count }));
  }, [equipment, dbUnitFilter]);

  // Filtered equipment for Live Database tab
  const filteredEquipment = useMemo(() => {
    const q = dbSearch.trim().toLowerCase();
    return equipment.filter((item) => {
      if (dbUnitFilter !== 'all' && item.Unit !== dbUnitFilter) return false;
      if (dbSubUnitFilter !== 'all') {
        const itemSub = (item.SubUnit || item.AreaPackage || item.SystemNo || '').trim().toUpperCase();
        const targetSub = dbSubUnitFilter.trim().toUpperCase();
        if (!itemSub.includes(targetSub)) return false;
      }
      if (dbTypeFilter !== 'all' && (item.EquipmentType || '').trim() !== dbTypeFilter) return false;
      const overall = getEquipmentOverallStatus(item);
      if (dbStatusFilter !== 'all' && overall !== dbStatusFilter) return false;
      if (dbDocsOnly) {
        const parsed = parseEquipmentDocumentField(item.DocumentDrawing);
        if (parsed.reports.length === 0 && !parsed.drawingRef) return false;
      }
      if (!q) return true;
      return (
        (item.EquipmentTagNo || '').toLowerCase().includes(q) ||
        (item.Unit || '').toLowerCase().includes(q) ||
        (item.SubUnit || '').toLowerCase().includes(q) ||
        (item.SystemNo || '').toLowerCase().includes(q) ||
        (item.SubSystem || '').toLowerCase().includes(q) ||
        (item.EquipmentDescription || '').toLowerCase().includes(q) ||
        (item.EquipmentType || '').toLowerCase().includes(q) ||
        (item.BaseLineUTG || '').toLowerCase().includes(q) ||
        (item.PMI || '').toLowerCase().includes(q) ||
        (item.DocumentDrawing || '').toLowerCase().includes(q) ||
        (item.Remarks || '').toLowerCase().includes(q)
      );
    });
  }, [equipment, dbSearch, dbUnitFilter, dbSubUnitFilter, dbTypeFilter, dbStatusFilter, dbDocsOnly]);

  // Project Structure computed hierarchy (Units, Sub-units & Systems, Equipment Types & Tags)
  const projectStructureData = useMemo(() => {
    const activeUnitsList = unitsConfig?.units?.length ? unitsConfig.units : UNITS;
    const unitSummaries = activeUnitsList.map((uName) => {
      const uItems = equipment.filter((e) => e.Unit === uName);
      const subUnitsSet = new Set<string>();
      const systemsSet = new Set<string>();
      const subSystemsSet = new Set<string>();
      const typesSet = new Set<string>();

      uItems.forEach((item) => {
        if (item.SubUnit) {
          subUnitsSet.add(item.SubUnit);
        }
        if (item.SystemNo) systemsSet.add(item.SystemNo);
        if (item.SubSystem) subSystemsSet.add(item.SubSystem);
        if (item.EquipmentType) typesSet.add(item.EquipmentType);
      });

      const pct = calculateProgress(uItems);
      const completed = uItems.filter((i) => getEquipmentOverallStatus(i) === 'Completed').length;
      const inProg = uItems.filter((i) => getEquipmentOverallStatus(i) === 'In progress').length;

      return {
        unit: uName,
        totalEquipment: uItems.length,
        subUnitsCount: subUnitsSet.size,
        systemsCount: systemsSet.size,
        subSystemsCount: subSystemsSet.size,
        typesCount: typesSet.size,
        progressPct: pct,
        completed,
        inProg,
        notStarted: uItems.length - completed - inProg,
      };
    });

    // Sub-units, Systems & Sub-Systems breakdown
    const scopedItems =
      structUnitFilter === 'ALL'
        ? equipment
        : equipment.filter((e) => e.Unit === structUnitFilter);

    const subUnitSystemMap = new Map<
      string,
      { key: string; unit: string; subUnit: string; systemNo: string; subSystem: string; items: EquipmentItem[] }
    >();

    scopedItems.forEach((item) => {
      const subU = item.SubUnit || '—';
      const sysN = item.SystemNo || '—';
      const subSys = item.SubSystem || '—';
      const key = `${item.Unit}::${subU}::${sysN}::${subSys}`;
      const existing = subUnitSystemMap.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        subUnitSystemMap.set(key, {
          key,
          unit: item.Unit,
          subUnit: subU,
          systemNo: sysN,
          subSystem: subSys,
          items: [item],
        });
      }
    });

    const subUnitsAndSystems = Array.from(subUnitSystemMap.values()).map((entry) => ({
      ...entry,
      count: entry.items.length,
      progressPct: calculateProgress(entry.items),
    }));

    // Equipment Types breakdown
    const typeMap = new Map<string, EquipmentItem[]>();
    scopedItems.forEach((item) => {
      const t = (item.EquipmentType || 'Unspecified').trim();
      const arr = typeMap.get(t) || [];
      arr.push(item);
      typeMap.set(t, arr);
    });

    const equipmentTypes = Array.from(typeMap.entries())
      .map(([typeName, items]) => ({
        typeName,
        count: items.length,
        progressPct: calculateProgress(items),
        units: Array.from(new Set(items.map((i) => i.Unit))),
      }))
      .sort((a, b) => b.count - a.count);

    const q = structSearch.trim().toLowerCase();
    const filteredTags = scopedItems.filter((item) => {
      if (structTypeFilter !== 'ALL' && (item.EquipmentType || 'Unspecified').trim() !== structTypeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        (item.EquipmentTagNo || '').toLowerCase().includes(q) ||
        (item.EquipmentDescription || '').toLowerCase().includes(q) ||
        (item.EquipmentType || '').toLowerCase().includes(q) ||
        (item.Unit || '').toLowerCase().includes(q) ||
        (item.SubUnit || '').toLowerCase().includes(q) ||
        (item.SystemNo || '').toLowerCase().includes(q) ||
        (item.SubSystem || '').toLowerCase().includes(q)
      );
    });

    return {
      unitSummaries,
      subUnitsAndSystems,
      equipmentTypes,
      filteredTags,
    };
  }, [equipment, structUnitFilter, structTypeFilter, structSearch, unitsConfig]);

  // Filtered Audit Logs & Export
  const distinctAuditUsers = useMemo(() => {
    return Array.from(new Set(auditLogs.map((l) => l.userEmail).filter(Boolean)));
  }, [auditLogs]);

  const distinctAuditActions = useMemo(() => {
    return Array.from(new Set(auditLogs.map((l) => l.action).filter(Boolean)));
  }, [auditLogs]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (auditUserFilter !== 'all' && log.userEmail !== auditUserFilter) return false;
      if (auditActionFilter !== 'all' && log.action !== auditActionFilter) return false;
      if (auditDateFilter) {
        const logDate = (log.timestamp || '').slice(0, 10);
        if (logDate !== auditDateFilter) return false;
      }
      if (!q) return true;
      return (
        (log.action || '').toLowerCase().includes(q) ||
        (log.target || '').toLowerCase().includes(q) ||
        (log.userEmail || '').toLowerCase().includes(q) ||
        (log.details || '').toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditSearch, auditUserFilter, auditActionFilter, auditDateFilter]);

  const handleExportAuditLogs = useCallback(() => {
    const rows = filteredAuditLogs.map((log, idx) => ({
      'S.No.': idx + 1,
      Timestamp: new Date(log.timestamp).toLocaleString('en-GB'),
      Action: log.action,
      Target: log.target,
      'User Email': log.userEmail,
      Details: log.details || '—',
    }));
    const ws = XLSX.utils.json_to_sheet(
      rows.length > 0
        ? rows
        : [{ 'S.No.': 1, Timestamp: new Date().toLocaleString('en-GB'), Action: 'No Logs', Target: '—', 'User Email': '—', Details: '—' }]
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Trail');
    XLSX.writeFile(wb, `NREP_Audit_Trail_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showNotice(`Exported ${filteredAuditLogs.length} audit trail log(s) to Excel.`);
  }, [filteredAuditLogs]);

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredEquipment.length && filteredEquipment.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEquipment.map((e) => e.id)));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenAddModal = () => {
    const defaultUnit = dbUnitFilter !== 'all' ? dbUnitFilter : (allUnits[0] || UNITS[0]);
    const defaultSubUnit = dbSubUnitFilter !== 'all' ? dbSubUnitFilter : '';
    setEditingRecord({
      id: '',
      Unit: defaultUnit,
      SubUnit: defaultSubUnit,
      SystemNo: '',
      SubSystem: '',
      EquipmentTagNo: '',
      EquipmentDescription: '',
      EquipmentType: '',
      FormatIStatus: 'Not Issued',
      FormatIDate: '',
      FormatIIStatus: 'Not Issued',
      FormatIIDate: '',
      FormatIIIStatus: 'Not Issued',
      FormatIIIDate: '',
      FormatIVStatus: 'Not Issued',
      FormatIVDate: '',
      FormatVStatus: 'Not Issued',
      FormatVDate: '',
      InternalInspectionStatus: 'No',
      BaseLineUTG: 'No',
      PMI: 'No',
      FinalSystemAcceptance: 'Not Accepted',
      DocumentDrawing: '',
      Remarks: '',
    });
  };

  // Handle sub-actions triggered from Sidebar Drawer Hierarchy under "Admin & Live Database"
  useEffect(() => {
    if (!subActionTrigger?.action) return;
    const act = subActionTrigger.action;
    const timer = setTimeout(() => {
      switch (act) {
        case 'search':
          setActiveTab('database');
          dbSearchInputRef.current?.focus();
          break;
        case 'add_equip':
          setActiveTab('database');
          handleOpenAddModal();
          break;
        case 'docs':
          setActiveTab('database');
          setDbDocsOnly(false);
          if (filteredEquipment.length > 0) {
            setReportModalRecord({ item: filteredEquipment[0], tab: 'attach' });
          }
          break;
        case 'table':
          setActiveTab('database');
          dbTableSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        case 'clear_all':
          setActiveTab('database');
          setConfirmClearAll(true);
          break;
        case 'reset_sample':
          setActiveTab('database');
          setConfirmResetSample(true);
          break;
        case 'struct_units':
          setActiveTab('structure');
          setStructSection('units');
          break;
        case 'struct_subunits':
          setActiveTab('structure');
          setStructSection('subunits');
          break;
        case 'struct_types':
          setActiveTab('structure');
          setStructSection('types');
          break;
        case 'users_list':
        case 'users_roles':
        case 'users_scope':
          setActiveTab('users');
          break;
        case 'users_add':
          setActiveTab('add');
          break;
        case 'cloud_connect':
          setActiveTab('cloud');
          setCloudSyncInitialTab('drive_setup');
          setShowCloudSyncModal(true);
          break;
        case 'cloud_bulk':
          setActiveTab('cloud');
          setCloudSyncInitialTab('bulk_upload');
          setShowCloudSyncModal(true);
          break;
        case 'cloud_sync':
          setActiveTab('cloud');
          setCloudSyncInitialTab('folder_sync');
          setShowCloudSyncModal(true);
          break;
        case 'audit_log':
          setActiveTab('audit');
          break;
        case 'audit_filters':
          setActiveTab('audit');
          auditFilterInputRef.current?.focus();
          break;
        case 'audit_export':
          setActiveTab('audit');
          handleExportAuditLogs();
          break;
        case 'storage_meter':
          setActiveTab('storage');
          fetchStorageTelemetry(false);
          break;
        case 'storage_breakdown':
          setActiveTab('storage');
          fetchStorageTelemetry(false);
          storageBreakdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
      }
    }, 30);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subActionTrigger?.ts]);

  const handleSingleDelete = async (item: EquipmentItem) => {
    setBusyAction(true);
    try {
      await deleteEquipment(item.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setConfirmDeleteId(null);
      showNotice(`Deleted equipment "${item.EquipmentTagNo}" from live database.`);
      setSweetSuccess({
        title: 'Equipment Deleted Successfully!',
        badgeText: 'Removed from Live Database',
        message: `Equipment "${item.EquipmentTagNo}" (${item.EquipmentDescription || 'Equipment'}) has been permanently deleted from the live database.`,
        metaItems: [
          { label: 'Deleted Tag No.', value: item.EquipmentTagNo, highlight: 'slate' },
          { label: 'Unit / System', value: `${item.Unit} · ${item.SystemNo}` },
        ],
      });
    } catch (err: any) {
      setConfirmDeleteId(null);
      showNotice(err.message || 'Failed to delete record', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleBulkDeleteConfirmed = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBusyAction(true);
    try {
      await bulkDeleteEquipment(ids);
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      showNotice(`Deleted ${ids.length} selected equipment record(s) from live database.`);
      setSweetSuccess({
        title: 'Bulk Delete Completed!',
        badgeText: `${ids.length} Record(s) Deleted`,
        message: `Successfully deleted ${ids.length} selected equipment record(s) from the live database.`,
        metaItems: [
          { label: 'Deleted Count', value: `${ids.length} Equipment Record(s)`, highlight: 'green' },
        ],
      });
    } catch (err: any) {
      setConfirmBulkDelete(false);
      showNotice(err.message || 'Bulk delete failed', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleClearAllConfirmed = async () => {
    const totalBefore = equipment.length;
    setBusyAction(true);
    try {
      await clearAllEquipment();
      setSelectedIds(new Set());
      setConfirmClearAll(false);
      showNotice('All equipment records cleared from live database.');
      setSweetSuccess({
        title: 'Database Cleared Successfully!',
        badgeText: 'All Records Removed',
        message: `All ${totalBefore} equipment records have been cleared from the live database.`,
      });
    } catch (err: any) {
      setConfirmClearAll(false);
      showNotice(err.message || 'Failed to clear database', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleResetSampleConfirmed = async () => {
    setBusyAction(true);
    try {
      await resetToSampleData();
      setSelectedIds(new Set());
      setConfirmResetSample(false);
      showNotice('Database reset to factory sample dataset.');
      setSweetSuccess({
        title: 'Sample Dataset Restored!',
        badgeText: 'Factory Reset Complete',
        message: 'The live database has been restored to the factory sample dataset.',
      });
    } catch (err: any) {
      setConfirmResetSample(false);
      showNotice(err.message || 'Failed to reset sample data', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleUpdatePassword = async (targetUid: string) => {
    const val = passwordEdits[targetUid];
    if (val === undefined) return;
    const trimmed = val.trim();
    if (!trimmed) {
      showNotice('Please enter a new password before saving.', 'error');
      return;
    }
    setSavingPasswordUid(targetUid);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ targetUid, password: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to update password');
      }

      setPasswordEdits((prev) => ({ ...prev, [targetUid]: '' }));
      showNotice(`Password securely hashed & updated for "${targetUid}"`);
    } catch (err: any) {
      showNotice(err.message || 'Failed to update password', 'error');
    } finally {
      setSavingPasswordUid(null);
    }
  };

  const handleRoleChange = (targetUid: string, newRoleValue: UserRole, targetEmail?: string) => {
    setPendingUserEdits((prev) => ({
      ...prev,
      [targetUid]: {
        ...(prev[targetUid] || {}),
        role: newRoleValue,
        email: targetEmail,
      },
    }));
  };

  const handleStatusChange = (targetUid: string, newStatusValue: UserStatus, targetEmail?: string) => {
    setPendingUserEdits((prev) => ({
      ...prev,
      [targetUid]: {
        ...(prev[targetUid] || {}),
        status: newStatusValue,
        email: targetEmail,
      },
    }));
  };

  const handleUnitsAssignment = (targetUid: string, assignedUnits: string, targetEmail?: string) => {
    setPendingUserEdits((prev) => ({
      ...prev,
      [targetUid]: {
        ...(prev[targetUid] || {}),
        assignedUnits,
        email: targetEmail,
      },
    }));
  };

  const handleSaveUsersSheet = async () => {
    const editUids = Object.keys(pendingUserEdits);
    const pwdUids = Object.keys(passwordEdits).filter((uid) => Boolean(passwordEdits[uid]?.trim()));

    const allAffectedUids = Array.from(new Set([...editUids, ...pwdUids]));
    if (allAffectedUids.length === 0) {
      showNotice('No unsaved changes in User & Role sheet.', 'error');
      return;
    }

    setSavingUsersSheet(true);
    let successCount = 0;
    try {
      for (const uid of allAffectedUids) {
        const edits = pendingUserEdits[uid] || {};
        const newPwd = passwordEdits[uid]?.trim();
        const targetUser = users.find((u) => u.uid === uid);
        const email = edits.email || targetUser?.email;

        // Build single consolidated patch payload
        const patchPayload: any = { targetUid: uid };
        if (email) patchPayload.email = email;
        if (edits.role) patchPayload.role = edits.role;
        if (edits.status) patchPayload.status = edits.status;
        if (edits.assignedUnits) patchPayload.assignedUnits = edits.assignedUnits;
        if (newPwd) patchPayload.password = newPwd;

        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(patchPayload),
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `Failed to update user details for "${email || uid}"`);
        }
        if (typeof data.constraintBlocked === 'boolean') {
          setRoleConstraintBlocked(data.constraintBlocked);
        }
        successCount++;
      }

      // Update local state with all applied edits
      setUsers((prev) => {
        const next = prev.map((u) => {
          const edits = pendingUserEdits[u.uid];
          const hasNewPwd = Boolean(passwordEdits[u.uid]?.trim());
          if (!edits && !hasNewPwd) return u;
          return {
            ...u,
            ...(edits?.role ? { role: edits.role } : {}),
            ...(edits?.status ? { status: edits.status } : {}),
            ...(edits?.assignedUnits ? { assignedUnits: edits.assignedUnits } : {}),
            ...(hasNewPwd ? { password: 'updated' } : {}),
          };
        });
        saveLocalUsersRegistry(next);
        return next;
      });

      // Clear pending edit buffers
      setPendingUserEdits({});
      setPasswordEdits({});
      await refreshProfile();

      showGreenToast('User & Role details saved successfully');
    } catch (err: any) {
      showNotice(err.message || 'Failed to save User & Role sheet', 'error');
    } finally {
      setSavingUsersSheet(false);
    }
  };

  const handleSyncAllRolesToSupabase = async () => {
    setSyncingRoles(true);
    try {
      const res = await fetch('/api/users', {
        method: 'GET',
        headers: buildAuthHeaders(),
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to synchronize roles with Supabase');
      }
      if (Array.isArray(json.users)) {
        const list = json.users as UserProfile[];
        setUsers(list);
        saveLocalUsersRegistry(list);
      }
      if (typeof json.constraintBlocked === 'boolean') {
        setRoleConstraintBlocked(json.constraintBlocked);
      }
      showNotice(
        json.constraintBlocked
          ? 'Roles synced! Note: Run the 1-line SQL below in Supabase SQL Editor so the `role` column in Supabase Table Editor shows inspector / lead_engineer directly.'
          : 'All user roles synchronized with Supabase `public.users` & `auth.users`!'
      );
    } catch (err: any) {
      showNotice(err.message || 'Failed to sync roles with Supabase', 'error');
    } finally {
      setSyncingRoles(false);
    }
  };

  const handleDeleteServerUnit = async (unitName: string) => {
    if (!unitName) return;
    setDeletingUnit(true);
    try {
      const remainingUnits = unitsConfig.units.filter(
        (u) => u.trim().toUpperCase() !== unitName.trim().toUpperCase()
      );
      if (remainingUnits.length === 0) {
        throw new Error('Cannot delete all units. At least one unit must remain.');
      }
      await updateUnitsConfig({
        units: remainingUnits,
      });
      setUnitToDelete(null);
      showNotice(`Unit "${unitName}" deleted from Supabase Server config successfully.`);
    } catch (err: any) {
      showNotice(err?.message || 'Failed to delete unit from server', 'error');
    } finally {
      setDeletingUnit(false);
    }
  };

  const handleDeleteUser = async (targetUid: string, email: string) => {
    setBusyAction(true);
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ targetUid }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to delete user');
      }

      setUsers((prev) => {
        const next = prev.filter((u) => u.uid !== targetUid);
        saveLocalUsersRegistry(next);
        return next;
      });
      setConfirmDeleteUserUid(null);
      showNotice(`User ${email} removed from system registry`);
      setSweetSuccess({
        title: 'User Access Revoked & Deleted!',
        badgeText: 'User Removed',
        message: `User account "${email}" has been permanently removed from the system registry.`,
        metaItems: [{ label: 'Deleted User', value: email, highlight: 'slate' }],
      });
    } catch (err: any) {
      setConfirmDeleteUserUid(null);
      showNotice(err.message || 'Failed to delete user', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateOrAuthorizeUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = newEmail.trim();
    if (!rawInput) {
      showNotice('Please enter a valid email or user ID.', 'error');
      return;
    }

    const assignedPass = newPassword.trim();
    setSubmittingUser(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          emailOrUid: rawInput,
          displayName: newName.trim() || rawInput.split('@')[0],
          role: newRole,
          status: newStatus,
          assignedUnits: newUnits,
          password: assignedPass || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok || !data?.user) {
        throw new Error(data?.error || 'Failed to create or authorize user');
      }

      const createdUser = data.user as UserProfile;
      setUsers((prev) => {
        const idx = prev.findIndex(
          (u) => u.uid === createdUser.uid || u.email.toLowerCase() === createdUser.email.toLowerCase()
        );
        let next: UserProfile[];
        if (idx >= 0) {
          next = [...prev];
          next[idx] = createdUser;
        } else {
          next = [createdUser, ...prev];
        }
        saveLocalUsersRegistry(next);
        return next;
      });

      showNotice(
        `Success! Access granted to ${createdUser.email} as ${newRole.toUpperCase()}${
          assignedPass ? ' with assigned password.' : '.'
        }`
      );

      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setActiveTab('users');
    } catch (err: any) {
      showNotice(err.message || 'Failed to grant user access', 'error');
    } finally {
      setSubmittingUser(false);
    }
  };

  if (!canAccessLiveDatabase) {
    const deniedContent = (
      <div className="w-full max-w-md mx-auto my-8 rounded-xl bg-white p-6 shadow-md border border-slate-200 text-center">
        <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-900">Admin or Lead Engineer Access Required</h3>
        <p className="text-xs text-slate-600 mt-2">
          Only designated Administrators and Lead Engineers can access and manage live database records.
        </p>
        <button onClick={onClose} className="mt-5 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-medium">
          Back to Overview
        </button>
      </div>
    );
    return inline ? (
      deniedContent
    ) : (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
        {deniedContent}
      </div>
    );
  }

  const filteredUsers = users
    .filter((u) => {
      const matchesSearch =
        (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
        (u.displayName || '').toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const nameA = (a.displayName || a.email || a.uid).toLowerCase();
      const nameB = (b.displayName || b.email || b.uid).toLowerCase();
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return (a.email || a.uid).toLowerCase().localeCompare((b.email || b.uid).toLowerCase());
    });

  const panelBody = (
    <div
      className={
        inline
          ? 'w-full rounded-xl bg-white shadow-sm border border-slate-200 overflow-hidden flex flex-col'
          : 'w-full rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh]'
      }
    >
      {/* Top Header */}
      <div className="w-full flex justify-between items-center bg-slate-900 text-white px-5 py-3.5 border-b border-slate-800 shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-600/30 text-sky-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-white">
              Admin Console &amp; Live Database Manager
            </h2>
            <p className="text-xs text-slate-400">
              Add, edit, or delete live equipment records in Supabase Cloud &amp; manage user roles and permissions
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>{inline ? 'Back to Project Overview' : 'Close'}</span>
        </button>
      </div>

      {/* Toast / Status Notice Banner (Only visible when an action message is active) */}
      {statusMsg && (
        <div className="w-full px-5 py-2 border-b border-slate-200 bg-slate-50 shrink-0 flex items-center justify-end">
          <div
            className={`text-xs px-3 py-1 rounded-md flex items-center gap-1.5 font-medium ${
              statusMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {statusMsg.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        </div>
      )}

      {/* Live Supabase Storage Summary Bar (Always visible across Admin Console) */}
      {storageStats && activeTab !== 'storage' && (
        <div className="w-full px-5 py-2 bg-slate-900/5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <HardDrive className="w-3.5 h-3.5 text-sky-700" />
              <span>Supabase Cloud DB:</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-600">
              <span>Total Capacity:</span>
              <span className="font-mono font-bold text-slate-900">
                {formatBytesHuman(storageStats.database.quotaBytes)}
              </span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1.5 text-slate-600">
              <span>Used:</span>
              <span className="font-mono font-bold text-sky-800">
                {formatBytesHuman(storageStats.database.usedBytes)} ({storageStats.database.usedBytes.toLocaleString()} B · {storageStats.database.totalRows.toLocaleString()} rows)
              </span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1.5 text-slate-600">
              <span>Remaining:</span>
              <span className="font-mono font-bold text-emerald-700">
                {formatBytesHuman(storageStats.database.remainingBytes)} ({storageStats.database.remainingPercent.toFixed(3)}% Free)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              ● Live {storageStats.pingMs} ms
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('storage')}
              className="text-[11px] font-semibold text-sky-800 hover:text-sky-950 underline cursor-pointer"
            >
              Full Storage Breakdown →
            </button>
          </div>
        </div>
      )}

      {/* Tab Content */}
      <div className={inline ? 'w-full p-4 md:p-5' : 'w-full p-4 md:p-5 overflow-y-auto flex-1'}>
        {activeTab === 'database' ? (
          <div className="w-full space-y-4">
            {/* Database Controls & Bulk Actions Bar */}
            <div className="w-full p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                <input
                  ref={dbSearchInputRef}
                  type="text"
                  placeholder="🔍 Search Tag No, Unit, System, Description, Drawing..."
                  value={dbSearch}
                  onChange={(e) => {
                    setDbSearch(e.target.value);
                    setDbPage(1);
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 w-full sm:w-64 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />

                <select
                  value={dbUnitFilter}
                  onChange={(e) => {
                    const nextU = e.target.value;
                    setDbUnitFilter(nextU);
                    setDbSubUnitFilter('all');
                    setDbPage(1);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                >
                  <option value="all">All Units ({allUnits.length})</option>
                  {allUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>

                {dbUnitFilter === 'MSP' && (
                  <select
                    key="admin-msp-subunit-select"
                    value={dbSubUnitFilter ?? 'all'}
                    onChange={(e) => {
                      setDbSubUnitFilter(e.target.value);
                      setDbPage(1);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-sky-300 bg-sky-50 text-sky-900 text-xs font-semibold"
                    title="Filter by MSP Sub-Unit"
                  >
                    <option value="all">All MSP Sub-Units (3)</option>
                    {MSP_SUB_UNITS.map((su) => (
                      <option key={su} value={su}>
                        MSP › {su}
                      </option>
                    ))}
                  </select>
                )}

                {(dbUnitFilter === 'UTILITY' || (dbUnitFilter === 'all' && dbSubUnitFilter !== 'all')) && (
                  <select
                    key="admin-utility-subunit-select"
                    value={dbSubUnitFilter ?? 'all'}
                    onChange={(e) => {
                      const nextSub = e.target.value;
                      setDbSubUnitFilter(nextSub);
                      if (nextSub !== 'all' && dbUnitFilter === 'all') {
                        setDbUnitFilter('UTILITY');
                      }
                      setDbPage(1);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-sky-300 bg-sky-50 text-sky-900 text-xs font-semibold"
                    title="Filter by UTILITY Sub-Unit"
                  >
                    <option value="all">All UTILITY Sub-Units (8)</option>
                    {UTILITY_SUB_UNITS.map((su) => (
                      <option key={su} value={su}>
                        UTILITY › {su}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={dbTypeFilter}
                  onChange={(e) => {
                    setDbTypeFilter(e.target.value);
                    setDbPage(1);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
                  title="Filter by Equipment Type (e.g. Vessel, Exchanger)"
                >
                  <option value="all">All Types ({availableDbTypes.length})</option>
                  {availableDbTypes.map(({ type, count }) => (
                    <option key={type} value={type}>
                      {type} ({count})
                    </option>
                  ))}
                </select>

                <select
                  value={dbStatusFilter}
                  onChange={(e) => {
                    setDbStatusFilter(e.target.value);
                    setDbPage(1);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="all">All Statuses</option>
                  <option value="Completed">Completed</option>
                  <option value="In progress">In progress</option>
                  <option value="Not started">Not started</option>
                </select>

                <span className="text-xs text-slate-500 font-medium ml-1">
                  Showing <b>{filteredEquipment.length}</b> of <b>{equipment.length}</b> records
                </span>
              </div>

              {/* Action Buttons: Add Record, Bulk Delete, Clear All */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenAddModal}
                  className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Equipment</span>
                </button>

                {selectedIds.size > 0 && (
                  confirmBulkDelete ? (
                    <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">
                      <span className="text-xs font-semibold text-rose-800">
                        Delete {selectedIds.size} selected?
                      </span>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={handleBulkDeleteConfirmed}
                        className="px-2 py-0.5 rounded bg-rose-600 text-white text-xs font-bold hover:bg-rose-700"
                      >
                        Yes, Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmBulkDelete(false)}
                        className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-300 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmBulkDelete(true)}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Selected ({selectedIds.size})</span>
                    </button>
                  )
                )}

                {equipment.length > 0 && (
                  confirmClearAll ? (
                    <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-300 px-2.5 py-1 rounded-lg">
                      <span className="text-xs font-bold text-rose-800">
                        Delete ALL {equipment.length} records?
                      </span>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={handleClearAllConfirmed}
                        className="px-2 py-0.5 rounded bg-rose-700 text-white text-xs font-bold hover:bg-rose-800"
                      >
                        Yes, Clear All
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(false)}
                        className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-300 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(true)}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs flex items-center gap-1 transition-colors"
                      title="Delete all equipment records from live database"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear All Database</span>
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Live Equipment Database Table */}
            <div ref={dbTableSectionRef} className="w-full overflow-x-auto max-h-[560px] overflow-y-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 shadow-[0_1px_0_#e2e8f0]">
                  <tr className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={
                          filteredEquipment.length > 0 && selectedIds.size === filteredEquipment.length
                        }
                        onChange={handleToggleSelectAll}
                        title="Select all visible records"
                      />
                    </th>
                    <th className="py-2.5 px-3">Equipment Tag No.</th>
                    <th className="py-2.5 px-3">Unit</th>
                    <th className="py-2.5 px-3">Hierarchy (Sub-Unit › System › Sub-System)</th>
                    <th className="py-2.5 px-3">Description &amp; Type</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap">Progress</th>
                    {STATUS_COLUMNS.map((col) => (
                      <th key={col.key} className="py-2.5 px-2 text-center whitespace-nowrap">
                        {col.short}
                      </th>
                    ))}
                    <th className="py-2.5 px-3 whitespace-nowrap">Document/Drawing</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Live Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredEquipment.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="py-10 text-center text-slate-500">
                        <div className="text-sm font-semibold text-slate-700 mb-1">
                          No equipment records found in database
                        </div>
                        <div className="text-xs text-slate-400 mb-3">
                          Click &quot;+ Add Equipment&quot; to add a new record or &quot;Reset Sample Data&quot; to restore sample data.
                        </div>
                        <button
                          type="button"
                          onClick={handleOpenAddModal}
                          className="px-3.5 py-1.5 rounded-lg bg-sky-700 text-white font-semibold text-xs inline-flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add First Equipment Record</span>
                        </button>
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const effectiveSize = dbPageSize > 0 ? dbPageSize : filteredEquipment.length || 1;
                      const safePage = Math.min(dbPage, Math.max(1, Math.ceil(filteredEquipment.length / effectiveSize)));
                      const pagedEquipment =
                        dbPageSize > 0
                          ? filteredEquipment.slice((safePage - 1) * effectiveSize, safePage * effectiveSize)
                          : filteredEquipment;
                      return pagedEquipment;
                    })().map((item) => {
                      const isChecked = selectedIds.has(item.id);
                      const isConfirmingRowDelete = confirmDeleteId === item.id;

                      return (
                        <tr
                          key={item.id}
                          className={`hover:bg-slate-50 transition-colors ${
                            isChecked ? 'bg-sky-50/60' : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleSelectRow(item.id)}
                            />
                          </td>
                          <td className="py-2 px-3 font-bold text-sky-900 whitespace-nowrap">
                            {item.EquipmentTagNo}
                          </td>
                          <td className="py-2 px-3 font-bold text-slate-800 whitespace-nowrap">
                            {item.Unit}
                          </td>
                          <td className="py-2 px-3 text-slate-600 max-w-[200px] truncate" title={formatEquipmentHierarchyPath(item)}>
                            {(() => {
                              const parts = [item.SubUnit, item.SystemNo, item.SubSystem].filter(Boolean);
                              if (parts.length === 0) {
                                return <span className="text-slate-400 italic text-[11px]">Direct in {item.Unit}</span>;
                              }
                              return (
                                <span className="inline-flex items-center px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-900 font-semibold text-[11px]">
                                  {parts.join(' › ')}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="py-2 px-3 text-slate-600 max-w-[190px]">
                            <div className="truncate font-medium text-slate-800" title={item.EquipmentDescription}>
                              {item.EquipmentDescription || '—'}
                            </div>
                            <div className="text-[10.5px] text-slate-400">
                              {item.EquipmentType || 'No type'}
                            </div>
                          </td>

                          {/* Equipment Progress % */}
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            {(() => {
                              const pct = calculateProgress([item]);
                              return (
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                                    pct === 100
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : pct > 0
                                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                                >
                                  {pct}%
                                </span>
                              );
                            })()}
                          </td>

                          {/* Inline Live Editable 6 Stage Columns (Includes Base Line UTG) */}
                          {STATUS_COLUMNS.map((col) => {
                            const rawVal = (item[col.key] as string) || '';
                            const val = col.options.includes(rawVal as any)
                              ? rawVal
                              : isDone(rawVal)
                              ? col.doneValue
                              : col.pendingValue;
                            const done = isDone(val);
                            return (
                              <td key={col.key} className="py-2 px-1.5 text-center">
                                <select
                                  value={val}
                                  onChange={async (e) => {
                                    const nextVal = e.target.value;
                                    try {
                                      await updateEquipmentField(item.id, col.key, nextVal);
                                      showNotice(`Updated ${item.EquipmentTagNo} · ${col.short} → ${nextVal}`);
                                    } catch (err: any) {
                                      showNotice(err.message || 'Update failed', 'error');
                                    }
                                  }}
                                  className={`px-1.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                                    done
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : 'bg-amber-50 text-amber-800 border-amber-300'
                                  }`}
                                >
                                  {col.options.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            );
                          })}

                          {/* Document / Drawing & Live Reports */}
                          <td className="py-2 px-3 text-slate-700 text-[11px] whitespace-nowrap">
                            {(() => {
                              const parsed = parseEquipmentDocumentField(item.DocumentDrawing);
                              if (parsed.reports.length > 0) {
                                const badge = getProviderBadgeMeta(parsed.reports[0].provider);
                                return (
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReportModalRecord({ item, tab: 'view' })
                                      }
                                      className="px-2 py-0.5 rounded font-bold text-[11px] border cursor-pointer"
                                      style={{
                                        background: badge.bg,
                                        color: badge.color,
                                        borderColor: badge.border,
                                      }}
                                      title={`View ${parsed.reports.length} live report(s)`}
                                    >
                                      📄 View Live ({parsed.reports.length})
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReportModalRecord({ item, tab: 'attach' })
                                      }
                                      className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold text-[10.5px] cursor-pointer"
                                      title="Attach or upload another report"
                                    >
                                      +
                                    </button>
                                  </div>
                                );
                              }
                              if (parsed.drawingRef) {
                                return (
                                  <div className="inline-flex items-center gap-1.5">
                                    <span
                                      className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 font-semibold font-mono max-w-[120px] truncate"
                                      title={parsed.drawingRef}
                                    >
                                      {parsed.drawingRef}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReportModalRecord({ item, tab: 'attach' })
                                      }
                                      className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-bold text-[10.5px] cursor-pointer"
                                      title="Upload PDF or attach Google Drive / OneDrive link"
                                    >
                                      ⬆️ Attach
                                    </button>
                                  </div>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReportModalRecord({ item, tab: 'attach' })
                                  }
                                  className="px-2 py-0.5 rounded bg-slate-50 hover:bg-sky-50 text-sky-700 border border-dashed border-slate-300 font-semibold text-[11px] cursor-pointer"
                                >
                                  ⬆️ Upload / Link
                                </button>
                              );
                            })()}
                          </td>

                          {/* Edit & Delete Actions */}
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {isConfirmingRowDelete ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busyAction}
                                  onClick={() => handleSingleDelete(item)}
                                  className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold"
                                >
                                  Confirm Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingRecord(item)}
                                  className="px-2.5 py-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                                  title="Edit all fields of this equipment record"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(item.id)}
                                  className="px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                                  title="Delete this equipment record from live database"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer for Live Database Table */}
            {filteredEquipment.length > 0 && (() => {
              const totalItems = filteredEquipment.length;
              const effectiveSize = dbPageSize > 0 ? dbPageSize : totalItems;
              const totalPages = Math.max(1, Math.ceil(totalItems / effectiveSize));
              const currentPage = Math.min(dbPage, totalPages);
              const startIdx = (currentPage - 1) * effectiveSize;
              const endIdx = Math.min(startIdx + effectiveSize, totalItems);

              const pages: number[] = [];
              const maxButtons = 5;
              let start = Math.max(1, currentPage - 2);
              const end = Math.min(totalPages, start + maxButtons - 1);
              if (end - start + 1 < maxButtons) {
                start = Math.max(1, end - maxButtons + 1);
              }
              for (let p = start; p <= end; p++) pages.push(p);

              return (
                <div className="w-full flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-slate-500">
                      Showing <b className="text-slate-800">{startIdx + 1}–{endIdx}</b> of{' '}
                      <b className="text-slate-800">{totalItems}</b> equipment records
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-slate-500">
                      <span>Rows:</span>
                      <select
                        value={dbPageSize}
                        onChange={(e) => {
                          setDbPageSize(Number(e.target.value));
                          setDbPage(1);
                        }}
                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-800 font-semibold cursor-pointer"
                      >
                        <option value={10}>10 / page</option>
                        <option value={15}>15 / page</option>
                        <option value={25}>25 / page</option>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                        <option value={0}>Show All</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setDbPage(Math.max(1, currentPage - 1))}
                      className={`px-2.5 py-1 rounded border font-semibold transition-colors ${
                        currentPage <= 1
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50 cursor-pointer'
                      }`}
                    >
                      ← Previous
                    </button>
                    {pages.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setDbPage(p)}
                        className={`min-w-[28px] h-7 px-2 rounded border font-bold transition-colors cursor-pointer ${
                          p === currentPage
                            ? 'bg-sky-700 text-white border-sky-700'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() => setDbPage(Math.min(totalPages, currentPage + 1))}
                      className={`px-2.5 py-1 rounded border font-semibold transition-colors ${
                        currentPage >= totalPages
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50 cursor-pointer'
                      }`}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : activeTab === 'add' ? (
          <div className="max-w-xl mx-auto py-2 space-y-4">
            <div className="p-4 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-900 leading-relaxed flex items-start gap-3">
              <HelpCircle className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">How to give Admin, Lead Engineer, or Inspector access to another user:</div>
                <p className="mt-1">
                  Enter your colleague&apos;s email address below and set their role to <b>Admin</b> (full control),{' '}
                  <b>Lead Engineer</b> (live database &amp; edit access), or <b>Inspector</b> (inspection updates). When they sign in with that email, the
                  system will immediately recognize them and give them full access!
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateOrAuthorizeUser} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">User Email Address or User ID (Required)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. colleague@nrl.co.in or lead01"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Full Name / Designation (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Rajesh Kumar (Inspection Lead)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-sky-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Role Permission</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="admin">Admin (Full Control)</option>
                    <option value="lead_engineer">Lead Engineer (Live Database &amp; Edit)</option>
                    <option value="inspector">Inspector (Inspection Updates)</option>
                    <option value="viewer">Viewer (Read-only)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Access Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as UserStatus)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="approved">Approved (Active)</option>
                    <option value="pending">Pending Approval</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Unit Scope</label>
                  <select
                    value={newUnits}
                    onChange={(e) => setNewUnits(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="All">All Units</option>
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Assign Login Password (Optional / Recommended)
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="e.g. nrl123 or engineer@2026"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-16 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-sky-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2 px-2 py-1 text-[11px] text-slate-500 hover:text-slate-800 bg-slate-100 rounded"
                  >
                    {showNewPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  The user can use this password to sign in immediately on the login page with their User ID or email.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="w-full py-2.5 px-4 rounded-lg bg-sky-900 text-white font-semibold text-xs hover:bg-sky-800 transition-colors shadow-xs disabled:opacity-50"
                >
                  {submittingUser ? 'Saving to Supabase Cloud...' : 'Authorize User & Grant Access'}
                </button>
              </div>
            </form>
          </div>
        ) : activeTab === 'users' ? (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center justify-between flex-wrap gap-3 shadow-2xs">
              <div className="max-w-xl">
                <p className="font-semibold text-slate-800">
                  <b>User &amp; Roles Manager:</b> Select any user&apos;s role, access status, assigned unit scope, or enter a new password below.
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Changes remain staged locally and are only committed to Supabase Cloud when you click <strong className="text-emerald-700 font-bold">&quot;Save User &amp; Roles&quot;</strong>.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(Object.keys(pendingUserEdits).length > 0 || Object.keys(passwordEdits).some((uid) => Boolean(passwordEdits[uid]?.trim()))) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingUserEdits({});
                      setPasswordEdits({});
                      showNotice('Discarded unsaved User & Role changes.', 'error');
                    }}
                    disabled={savingUsersSheet}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Discard Changes
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveUsersSheet}
                  disabled={
                    savingUsersSheet ||
                    (Object.keys(pendingUserEdits).length === 0 &&
                      !Object.keys(passwordEdits).some((uid) => Boolean(passwordEdits[uid]?.trim())))
                  }
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                    Object.keys(pendingUserEdits).length > 0 ||
                    Object.keys(passwordEdits).some((uid) => Boolean(passwordEdits[uid]?.trim()))
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400 ring-offset-1'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-80'
                  }`}
                  title={
                    Object.keys(pendingUserEdits).length > 0 ||
                    Object.keys(passwordEdits).some((uid) => Boolean(passwordEdits[uid]?.trim()))
                      ? `Save staged user changes to Supabase Cloud`
                      : 'No staged changes to save'
                  }
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingUsersSheet ? 'Saving to Database...' : 'Save User & Roles'}</span>
                  {(Object.keys(pendingUserEdits).length > 0 ||
                    Object.keys(passwordEdits).some((uid) => Boolean(passwordEdits[uid]?.trim()))) && (
                    <span className="px-1.5 py-0.2 rounded-full bg-emerald-900 text-white text-[10px]">
                      {Object.keys(pendingUserEdits).length +
                        Object.keys(passwordEdits).filter((uid) => Boolean(passwordEdits[uid]?.trim())).length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleSyncAllRolesToSupabase}
                  disabled={syncingRoles}
                  className="px-2.5 py-1.5 rounded-lg border border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 font-semibold text-[11px] whitespace-nowrap disabled:opacity-50"
                >
                  {syncingRoles ? 'Syncing...' : '🔄 Sync Roles to Supabase'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('add')}
                  className="px-2.5 py-1.5 rounded-lg bg-sky-900 hover:bg-sky-800 text-white font-medium text-[11px] whitespace-nowrap"
                >
                  + Add User By Email
                </button>
              </div>
            </div>

            {roleConstraintBlocked && (
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="font-bold text-amber-900">
                    ⚠️ Why Supabase Table Editor shows &quot;editor&quot; in the <code className="px-1 py-0.5 rounded bg-amber-100">role</code> column:
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const sql = `ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;\nALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'lead_engineer', 'inspector', 'editor', 'viewer'));\nUPDATE public.users SET role = split_part( split_part(password, '|', 1), 'role:', 2 ) WHERE password LIKE 'role:%|%';`;
                      navigator.clipboard.writeText(sql);
                      showNotice('SQL copied! Paste & Run it in Supabase SQL Editor, then click "🔄 Sync Roles to Supabase".');
                    }}
                    className="px-2.5 py-1 rounded bg-amber-800 text-white hover:bg-amber-900 font-semibold text-[11px]"
                  >
                    📋 Copy SQL Fix for Supabase
                  </button>
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  Your app already saves and enforces <b>Inspector</b> &amp; <b>Lead Engineer</b> via <code className="px-1 py-0.5 rounded bg-amber-100">auth.users</code> and encoded role metadata, so login permissions work 100% accurately. However, your Supabase <code className="px-1 py-0.5 rounded bg-amber-100">public.users</code> table still has the old PostgreSQL check constraint <code className="px-1 py-0.5 rounded bg-amber-100">users_role_check (admin, editor, viewer)</code> which blocks PostgreSQL from writing <code className="px-1 py-0.5 rounded bg-amber-100">inspector</code> or <code className="px-1 py-0.5 rounded bg-amber-100">lead_engineer</code> directly into the <code className="px-1 py-0.5 rounded bg-amber-100">role</code> column. Run this 1-time SQL in <b>Supabase Dashboard → SQL Editor</b> to allow <code className="px-1 py-0.5 rounded bg-amber-100">inspector</code> &amp; <code className="px-1 py-0.5 rounded bg-amber-100">lead_engineer</code> in the <code className="px-1 py-0.5 rounded bg-amber-100">role</code> column:
                </p>
                <pre className="p-2 rounded bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto select-all">
{`ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'lead_engineer', 'inspector', 'editor', 'viewer'));
UPDATE public.users SET role = split_part(split_part(password, '|', 1), 'role:', 2) WHERE password LIKE 'role:%|%';`}
                </pre>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Dummy decoy inputs to intercept any aggressive browser password manager autofill */}
              <div style={{ display: 'none' }} aria-hidden="true">
                <input type="text" name="fake_username_remember" tabIndex={-1} autoComplete="off" />
                <input type="password" name="fake_password_remember" tabIndex={-1} autoComplete="new-password" />
              </div>

              <div className="relative w-full sm:w-72">
                <input
                  type="search"
                  id="user_admin_filter_query_input"
                  name="user_filter_query_no_autofill"
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="Filter users by email or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 pr-7 text-xs rounded-lg border border-slate-200 w-full bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    title="Clear filter"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs px-1"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs"
                >
                  <option value="all">All statuses</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending Approval</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            <div className="w-full overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">User &amp; Email</th>
                    <th className="py-2.5 px-3">Role</th>
                    <th className="py-2.5 px-3">Assigned Password</th>
                    <th className="py-2.5 px-3">Access Status</th>
                    <th className="py-2.5 px-3">Assigned Scope</th>
                    <th className="py-2.5 px-3">Last Active</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No users registered yet. Click &quot;+ Grant User Access&quot; to authorize a colleague.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => {
                      const isSelf = u.uid === user?.uid || u.email.toLowerCase() === user?.email?.toLowerCase();
                      const isVisible = Boolean(visiblePasswords[u.uid]);
                      const currentPassValue = passwordEdits[u.uid] ?? '';
                      const staged = pendingUserEdits[u.uid];
                      const stagedPassword = passwordEdits[u.uid];
                      const hasRowEdits = Boolean(staged) || Boolean(stagedPassword?.trim());
                      const effectiveRole =
                        staged?.role ??
                        (u.role === 'editor' || u.role === 'engineer'
                          ? 'inspector'
                          : u.role || 'viewer');
                      const effectiveStatus = staged?.status ?? (u.status || 'approved');
                      const effectiveScope =
                        staged?.assignedUnits !== undefined ? staged.assignedUnits : (u.assignedUnits || 'All');

                      return (
                        <tr
                          key={u.uid}
                          className={`transition-colors ${
                            hasRowEdits ? 'bg-emerald-50/40 border-l-4 border-l-emerald-500' : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-slate-900">{u.displayName || 'No Name'}</span>
                              {hasRowEdits && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  ● Unsaved
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">{u.email}</div>
                            {u.uid === 'admin' && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] bg-sky-100 text-sky-800 font-semibold">
                                Default Admin Account
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={effectiveRole}
                              disabled={isSelf}
                              onChange={(e) => handleRoleChange(u.uid, e.target.value as UserRole, u.email)}
                              className={`px-2 py-1 rounded border text-xs font-semibold text-sky-950 disabled:opacity-50 transition-colors ${
                                staged?.role
                                  ? 'border-emerald-500 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-400 font-bold'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              <option value="admin">Admin (Full Control)</option>
                              <option value="lead_engineer">Lead Engineer (Live Database)</option>
                              <option value="inspector">Inspector</option>
                              <option value="viewer">Viewer (Read-Only)</option>
                            </select>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5 min-w-[190px]">
                              <div className="relative flex-1">
                                <input
                                  type={isVisible ? 'text' : 'password'}
                                  value={currentPassValue}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setPasswordEdits((prev) => ({ ...prev, [u.uid]: val }));
                                  }}
                                  placeholder={u.password ? '•••••• (Reset)' : 'Set password...'}
                                  className="w-full text-xs font-mono px-2 py-1 pr-6 rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                                />
                                <button
                                  type="button"
                                  title={isVisible ? 'Hide password' : 'Show password'}
                                  onClick={() => setVisiblePasswords((prev) => ({ ...prev, [u.uid]: !prev[u.uid] }))}
                                  className="absolute right-1 top-1.5 text-slate-400 hover:text-slate-600 p-0.5"
                                >
                                  {isVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleUpdatePassword(u.uid)}
                                disabled={savingPasswordUid === u.uid}
                                title="Hash on backend & save to Supabase Cloud"
                                className="px-2 py-1 bg-sky-900 text-white rounded text-[11px] font-medium hover:bg-sky-800 transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1"
                              >
                                <Save className="w-3 h-3" />
                                {savingPasswordUid === u.uid ? '...' : 'Save'}
                              </button>
                            </div>
                            {u.password && (
                              <div className="text-[10px] text-emerald-600 font-medium mt-0.5 flex items-center gap-1">
                                <Key className="w-2.5 h-2.5" /> Encrypted on Backend
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                                  effectiveStatus === 'approved'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : effectiveStatus === 'pending'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                                }`}
                              >
                                {effectiveStatus}
                              </span>
                              {!isSelf && (
                                <select
                                  value={effectiveStatus}
                                  onChange={(e) => handleStatusChange(u.uid, e.target.value as UserStatus, u.email)}
                                  className={`text-[11px] border rounded px-1.5 py-0.5 bg-white transition-colors ${
                                    staged?.status
                                      ? 'border-emerald-500 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-400 font-bold'
                                      : 'border-slate-200'
                                  }`}
                                >
                                  <option value="approved">Approve</option>
                                  <option value="pending">Mark Pending</option>
                                  <option value="suspended">Suspend</option>
                                </select>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            {(() => {
                              const currentScope = effectiveScope;
                              const isAll =
                                !currentScope ||
                                currentScope.trim() === '' ||
                                currentScope.toLowerCase() === 'all' ||
                                currentScope.toLowerCase() === 'all units';

                              const selectedUnitsList = isAll
                                ? []
                                : currentScope
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean);

                              const scopedItems = isAll
                                ? equipment
                                : equipment.filter((e) => {
                                    const uUpper = (e.Unit || '').trim().toUpperCase();
                                    return selectedUnitsList.some((su) => su.toUpperCase() === uUpper);
                                  });
                              const scopedPct = calculateProgress(scopedItems);

                              const isOpen = openScopeDropdownUid === u.uid;

                              const toggleUnit = (unitName: string) => {
                                let nextList: string[];
                                if (isAll) {
                                  // Switching from All to only this unit
                                  nextList = [unitName];
                                } else {
                                  const exists = selectedUnitsList.some(
                                    (su) => su.toUpperCase() === unitName.toUpperCase()
                                  );
                                  if (exists) {
                                    nextList = selectedUnitsList.filter(
                                      (su) => su.toUpperCase() !== unitName.toUpperCase()
                                    );
                                  } else {
                                    nextList = [...selectedUnitsList, unitName];
                                  }
                                }
                                const nextValue =
                                  nextList.length === 0 || nextList.length === UNITS.length
                                    ? 'All'
                                    : nextList.join(', ');
                                handleUnitsAssignment(u.uid, nextValue, u.email);
                              };

                              return (
                                <div className="relative flex flex-col gap-1 min-w-[190px]">
                                  <button
                                    type="button"
                                    onClick={() => setOpenScopeDropdownUid(isOpen ? null : u.uid)}
                                    className={`text-xs border rounded-lg px-2.5 py-1.5 font-semibold text-left flex items-center justify-between gap-1.5 cursor-pointer transition-colors shadow-2xs ${
                                      staged?.assignedUnits !== undefined
                                        ? 'border-emerald-500 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-400 font-bold'
                                        : !isAll
                                        ? 'border-sky-300 bg-sky-50 text-sky-950'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    <span className="truncate max-w-[155px]">
                                      {isAll
                                        ? `All Units (${UNITS.length})`
                                        : `${selectedUnitsList.length} Unit${selectedUnitsList.length > 1 ? 's' : ''}: ${selectedUnitsList.join(', ')}`}
                                    </span>
                                    <span className="text-[10px] text-slate-400 shrink-0">▼</span>
                                  </button>

                                  {isOpen && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setOpenScopeDropdownUid(null)}
                                      />
                                      <div className="absolute top-full left-0 mt-1 z-50 w-56 p-2 rounded-xl border border-slate-200 bg-white shadow-xl space-y-1.5">
                                        <div className="flex items-center justify-between pb-1 border-b border-slate-100 text-[11px]">
                                          <span className="font-bold text-slate-700">Assign Multiple Units:</span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              handleUnitsAssignment(u.uid, 'All', u.email);
                                            }}
                                            className={`font-semibold cursor-pointer text-[10px] px-1.5 py-0.5 rounded ${
                                              isAll
                                                ? 'bg-sky-600 text-white'
                                                : 'text-sky-700 hover:bg-sky-50'
                                            }`}
                                          >
                                            All Units
                                          </button>
                                        </div>

                                        <div className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
                                          {UNITS.map((unit) => {
                                            const isChecked =
                                              isAll ||
                                              selectedUnitsList.some(
                                                (su) => su.toUpperCase() === unit.toUpperCase()
                                              );
                                            const uCount = equipment.filter((e) => e.Unit === unit).length;
                                            return (
                                              <label
                                                key={unit}
                                                className="flex items-center justify-between px-2 py-1 rounded hover:bg-slate-50 cursor-pointer text-xs"
                                              >
                                                <div className="flex items-center gap-2">
                                                  <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => toggleUnit(unit)}
                                                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer w-3.5 h-3.5"
                                                  />
                                                  <span className="font-medium text-slate-800">{unit}</span>
                                                </div>
                                                <span className="text-[10px] text-slate-400 font-mono">
                                                  {uCount} eq.
                                                </span>
                                              </label>
                                            );
                                          })}
                                        </div>

                                        <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[10px]">
                                          <span className="text-slate-500">
                                            Selected: <b>{isAll ? 'All' : selectedUnitsList.length}</b>
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => setOpenScopeDropdownUid(null)}
                                            className="px-2 py-0.5 rounded bg-slate-900 text-white font-semibold cursor-pointer"
                                          >
                                            Done
                                          </button>
                                        </div>
                                      </div>
                                    </>
                                  )}

                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                                    <span className="font-semibold text-slate-700">
                                      {scopedItems.length} equip.
                                    </span>
                                    <span>·</span>
                                    <span className={scopedPct > 0 ? 'text-emerald-700 font-bold' : 'text-slate-500'}>
                                      {scopedPct}% stage prog.
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 tabular-nums">
                            {u.lastLoginAt ? u.lastLoginAt.slice(0, 10) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {!isSelf && (
                              confirmDeleteUserUid === u.uid ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteUser(u.uid, u.email)}
                                    className="px-2 py-0.5 rounded bg-rose-600 text-white text-[11px] font-bold"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteUserUid(null)}
                                    className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteUserUid(u.uid)}
                                  title="Revoke and delete user access"
                                  className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'structure' ? (
          /* SHEET 2: PROJECT STRUCTURE (UNITS, SUB-UNITS & SYSTEMS, EQUIPMENT TYPES & TAGS) */
          <div className="space-y-5">
            {/* Structure Sub-Navigation & Unit Filter Bar */}
            <div className="p-3.5 rounded-xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  <FolderTree className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    2 · Project Structure Hierarchy (Units, Sub-Units, Systems &amp; Equipment Types)
                  </h3>
                  <p className="text-xs text-slate-400">
                    {unitsConfig.units.length} Server-Configured Units ({unitsConfig.units.join(', ')}) · {projectStructureData.subUnitsAndSystems.length} Sub-Units/Systems · {projectStructureData.equipmentTypes.length} Equipment Types
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'all', label: 'All Structure Layers' },
                  { id: 'units', label: `├─ Units (${unitsConfig.units.length})` },
                  { id: 'subunits', label: `├─ Sub-Units & Systems (${projectStructureData.subUnitsAndSystems.length})` },
                  { id: 'types', label: `└─ Equipment Types & Tags (${projectStructureData.equipmentTypes.length})` },
                ].map((btn) => (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => setStructSection(btn.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      structSection === btn.id
                        ? 'bg-sky-500 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* LAYER 1: CANONICAL UNITS */}
            {(structSection === 'all' || structSection === 'units') && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-sky-700" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      ├─ 2.1 Server Units: {unitsConfig.units.join(', ')}
                    </h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canAccessLiveDatabase && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={newServerUnitInput}
                          onChange={(e) => setNewServerUnitInput(e.target.value)}
                          placeholder="New Unit name (e.g. HGU)..."
                          className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600 w-44"
                        />
                        <button
                          type="button"
                          disabled={savingServerUnit || !newServerUnitInput.trim()}
                          onClick={async () => {
                            const clean = newServerUnitInput.trim();
                            if (!clean) return;
                            if (unitsConfig.units.some((u) => u.toUpperCase() === clean.toUpperCase())) {
                              setStatusMsg({ text: `Unit "${clean}" already exists on server.`, type: 'error' });
                              return;
                            }
                            setSavingServerUnit(true);
                            try {
                              await updateUnitsConfig({
                                units: [...unitsConfig.units, clean],
                              });
                              setNewServerUnitInput('');
                              setStatusMsg({
                                text: `Unit "${clean}" added & saved to Supabase Server!`,
                                type: 'success',
                              });
                            } catch (err: any) {
                              setStatusMsg({
                                text: err?.message || 'Failed to save unit to server',
                                type: 'error',
                              });
                            } finally {
                              setSavingServerUnit(false);
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-sky-900 text-white hover:bg-sky-800 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          {savingServerUnit ? 'Saving...' : '+ Add Server Unit'}
                        </button>
                      </div>
                    )}
                    {structUnitFilter !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => setStructUnitFilter('ALL')}
                        className="text-xs font-semibold text-sky-700 hover:underline cursor-pointer"
                      >
                        Clear Unit Filter ({structUnitFilter}) ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {projectStructureData.unitSummaries.map((u) => {
                    const isSelected = structUnitFilter === u.unit;
                    return (
                      <div
                        key={u.unit}
                        onClick={() => setStructUnitFilter(isSelected ? 'ALL' : u.unit)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                          isSelected
                            ? 'border-sky-600 bg-sky-50/70 shadow-xs'
                            : 'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-sky-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-slate-900 font-mono px-2.5 py-0.5 rounded bg-white border border-slate-200">
                            {u.unit}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-sky-800 bg-sky-100/80 px-2 py-0.5 rounded-full">
                              {u.totalEquipment} Equip.
                            </span>
                            {canAccessLiveDatabase && (
                              <button
                                type="button"
                                title={`Delete "${u.unit}" unit from Supabase Server`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setUnitToDelete(u.unit);
                                }}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5 text-[11px] text-center">
                          <div className="p-1.5 rounded bg-white border border-slate-200/80">
                            <div className="text-slate-400 text-[10px]">Sub-Units</div>
                            <div className="font-bold text-slate-800">{u.subUnitsCount || 1}</div>
                          </div>
                          <div className="p-1.5 rounded bg-white border border-slate-200/80">
                            <div className="text-slate-400 text-[10px]">Systems</div>
                            <div className="font-bold text-slate-800">{u.systemsCount}</div>
                          </div>
                          <div className="p-1.5 rounded bg-white border border-slate-200/80">
                            <div className="text-slate-400 text-[10px]">Eq. Types</div>
                            <div className="font-bold text-slate-800">{u.typesCount}</div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 font-medium">Stage Completion</span>
                            <span className="font-mono font-bold text-emerald-700">{u.progressPct}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className="h-full bg-emerald-600"
                              style={{ width: `${Math.min(100, u.progressPct)}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/70 text-[11px]">
                          <span className="text-slate-500">
                            Done: <b>{u.completed}</b> · In Prog: <b>{u.inProg}</b>
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDbUnitFilter(u.unit);
                              setDbSubUnitFilter('all');
                              setActiveTab('database');
                            }}
                            className="text-sky-700 font-bold hover:underline cursor-pointer"
                          >
                            Open in DB →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* LAYER 2: SUB-UNITS & SYSTEMS */}
            {(structSection === 'all' || structSection === 'subunits') && (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FolderTree className="w-4 h-4 text-sky-700" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      ├─ 2.2 Sub-Units &amp; Systems ({projectStructureData.subUnitsAndSystems.length})
                    </h4>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">Filter by Unit:</span>
                    <select
                      value={structUnitFilter}
                      onChange={(e) => setStructUnitFilter(e.target.value)}
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-semibold"
                    >
                      <option value="ALL">All 7 Units</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="max-h-[340px] overflow-y-auto overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Unit</th>
                        <th className="py-2.5 px-3">Sub-Unit / Package</th>
                        <th className="py-2.5 px-3">System No.</th>
                        <th className="py-2.5 px-3">Sub-System</th>
                        <th className="py-2.5 px-3 text-right">Equipment Count</th>
                        <th className="py-2.5 px-3 text-center">Stage Progress</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {projectStructureData.subUnitsAndSystems.map((row) => (
                        <tr key={row.key} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-bold text-slate-900 font-mono">{row.unit}</td>
                          <td className="py-2 px-3 text-sky-900 font-semibold">{row.subUnit}</td>
                          <td className="py-2 px-3 text-slate-700">{row.systemNo}</td>
                          <td className="py-2 px-3 text-indigo-800 font-medium">{row.subSystem}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                            {row.count}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[11px] font-bold">
                              {row.progressPct}%
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setDbUnitFilter(row.unit);
                                setDbSearch(row.subSystem !== '—' ? row.subSystem : row.systemNo !== '—' ? row.systemNo : row.subUnit !== '—' ? row.subUnit : '');
                                setActiveTab('database');
                              }}
                              className="px-2.5 py-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold cursor-pointer"
                            >
                              Filter in Live DB →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* LAYER 3: EQUIPMENT TYPES & TAGS */}
            {(structSection === 'all' || structSection === 'types') && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-sky-700" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      └─ 2.3 Equipment Types &amp; Tags ({projectStructureData.filteredTags.length} Tags)
                    </h4>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="🔍 Search equipment tag or description..."
                      value={structSearch}
                      onChange={(e) => setStructSearch(e.target.value)}
                      className="px-3 py-1 rounded-lg border border-slate-300 text-xs bg-white w-56"
                    />
                    <select
                      value={structTypeFilter}
                      onChange={(e) => setStructTypeFilter(e.target.value)}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                    >
                      <option value="ALL">All Equipment Types ({projectStructureData.equipmentTypes.length})</option>
                      {projectStructureData.equipmentTypes.map((t) => (
                        <option key={t.typeName} value={t.typeName}>
                          {t.typeName} ({t.count})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Equipment Type Pills */}
                <div className="flex flex-wrap gap-2">
                  {projectStructureData.equipmentTypes.map((t) => {
                    const active = structTypeFilter === t.typeName;
                    return (
                      <button
                        key={t.typeName}
                        type="button"
                        onClick={() => setStructTypeFilter(active ? 'ALL' : t.typeName)}
                        className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                          active
                            ? 'bg-sky-900 text-white border-sky-950 font-bold'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 font-medium'
                        }`}
                      >
                        <span>{t.typeName}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10.5px] font-mono ${
                            active ? 'bg-sky-700 text-white' : 'bg-white text-slate-600 border border-slate-200'
                          }`}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Compact Equipment Tags Directory Table */}
                <div className="max-h-[360px] overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="py-2 px-3">Equipment Tag No.</th>
                        <th className="py-2 px-3">Equipment Type</th>
                        <th className="py-2 px-3">Description</th>
                        <th className="py-2 px-3">Hierarchy Path</th>
                        <th className="py-2 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {projectStructureData.filteredTags.slice(0, 100).map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-bold text-sky-900 font-mono whitespace-nowrap">
                            {item.EquipmentTagNo}
                          </td>
                          <td className="py-2 px-3">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[11px]">
                              {item.EquipmentType || 'Unspecified'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-700">{item.EquipmentDescription || '—'}</td>
                          <td className="py-2 px-3 text-slate-600 font-medium">
                            {formatEquipmentHierarchyPath(item)}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setEditingRecord(item)}
                              className="px-2.5 py-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold cursor-pointer mr-1.5"
                            >
                              ✏️ Edit Tag
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDbSearch(item.EquipmentTagNo);
                                setActiveTab('database');
                              }}
                              className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold cursor-pointer"
                            >
                              Locate in DB →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'cloud' ? (
          /* SHEET 5: CLOUD REPORT SYNC & DRIVE SWITCHER (3 MODULES) */
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <FolderSync className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    5 · Cloud Report Sync &amp; Drive Switcher (Google Drive + Microsoft OneDrive)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Manage all 3 Cloud Report modules: Connect Drive Folder, Direct Bulk Report Upload, and Auto-Match Tag Sync
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setCloudSyncInitialTab('bulk_upload');
                  setShowCloudSyncModal(true);
                }}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Upload className="w-4 h-4" />
                <span>Launch Full Cloud Workspace Modal</span>
              </button>
            </div>

            {/* 3 MODULE CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Module 1: Connect Drive Folder */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-900 text-[11px] font-bold">
                      Module 1 · Drive Setup &amp; Switcher
                    </span>
                    <HardDrive className="w-5 h-5 text-sky-700" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    ├─ Connect Drive Folder (Google Drive / OneDrive)
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Switch active cloud storage provider between <b>Google Drive</b> and <b>Microsoft OneDrive</b>, or configure your shared folder URL and Apps Script / Graph API bridge.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCloudSyncInitialTab('drive_setup');
                    setShowCloudSyncModal(true);
                  }}
                  className="w-full py-2.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <HardDrive className="w-3.5 h-3.5 text-sky-400" />
                  <span>Open Connect Drive Folder</span>
                </button>
              </div>

              {/* Module 2: Bulk Upload Reports (Direct to Drive) */}
              <div className="p-4 rounded-xl border-2 border-emerald-500/70 bg-emerald-50/30 shadow-2xs flex flex-col justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[11px] font-bold">
                      Module 2 · Direct Bulk Upload
                    </span>
                    <Upload className="w-5 h-5 text-emerald-700" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    ├─ Bulk Upload Reports (Direct to Drive)
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Drag and drop multiple <b>PDF or Photo</b> inspection reports from your PC or mobile. Filenames matching an Equipment Tag No. are automatically linked in Supabase!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCloudSyncInitialTab('bulk_upload');
                    setShowCloudSyncModal(true);
                  }}
                  className="w-full py-2.5 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Open Bulk Upload Reports (Direct to Drive)</span>
                </button>
              </div>

              {/* Module 3: Folder Auto-Sync by Tag No. */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-900 text-[11px] font-bold">
                      Module 3 · Cloud Folder Auto-Sync
                    </span>
                    <FolderSync className="w-5 h-5 text-indigo-700" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    └─ Auto-Sync Cloud Folder Manifest
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Scan existing files inside your connected Google Drive or OneDrive folder and automatically bind matching reports to their respective Equipment Tag Numbers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCloudSyncInitialTab('folder_sync');
                    setShowCloudSyncModal(true);
                  }}
                  className="w-full py-2.5 px-3 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderSync className="w-3.5 h-3.5" />
                  <span>Open Cloud Folder Auto-Sync</span>
                </button>
              </div>
            </div>

            {/* Live Equipment Document / Cloud Report Links Summary */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Live Equipment with Attached Documents / Cloud Reports (
                  {
                    equipment.filter((e) => {
                      const p = parseEquipmentDocumentField(e.DocumentDrawing);
                      return p.reports.length > 0 || Boolean(p.drawingRef);
                    }).length
                  }{' '}
                  Linked)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDbDocsOnly(true);
                    setActiveTab('database');
                  }}
                  className="text-xs font-semibold text-sky-700 hover:underline cursor-pointer"
                >
                  View All in Live Database →
                </button>
              </div>
              <div className="max-h-[320px] overflow-y-auto overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-2 px-3">Equipment Tag No.</th>
                      <th className="py-2 px-3">Unit › System</th>
                      <th className="py-2 px-3">Linked Document / Cloud Report</th>
                      <th className="py-2 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {equipment
                      .filter((e) => {
                        const p = parseEquipmentDocumentField(e.DocumentDrawing);
                        return p.reports.length > 0 || Boolean(p.drawingRef);
                      })
                      .slice(0, 50)
                      .map((item) => {
                        const parsed = parseEquipmentDocumentField(item.DocumentDrawing);
                        return (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-bold text-sky-900 font-mono">
                              {item.EquipmentTagNo}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              <b>{item.Unit}</b> › {item.SubUnit || item.SystemNo}
                            </td>
                            <td className="py-2 px-3">
                              {parsed.reports.length > 0 ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
                                  📄 {parsed.reports.length} Cloud Report(s) ({parsed.reports[0].title || 'Report'})
                                </span>
                              ) : (
                                <span className="font-mono text-slate-700">{parsed.drawingRef}</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setReportModalRecord({
                                    item,
                                    tab: parsed.reports.length > 0 ? 'view' : 'attach',
                                  })
                                }
                                className="px-2.5 py-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold cursor-pointer"
                              >
                                {parsed.reports.length > 0 ? '📄 View / Manage' : '⬆️ Attach Report'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : activeTab === 'audit' ? (
          /* SHEET 6: AUDIT TRAIL (ACTIVITY LOG, FILTERS: USER, DATE, ACTION & EXPORT) */
          <div className="space-y-4">
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mr-1">
                  <Filter className="w-3.5 h-3.5 text-sky-700" />
                  <span>Filters:</span>
                </div>
                <input
                  ref={auditFilterInputRef}
                  type="text"
                  placeholder="🔍 Search user, action, target, details..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white w-full sm:w-56 focus:outline-none focus:ring-1 focus:ring-sky-600"
                />

                {/* User Filter */}
                <select
                  value={auditUserFilter}
                  onChange={(e) => setAuditUserFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
                >
                  <option value="all">All Users ({distinctAuditUsers.length})</option>
                  {distinctAuditUsers.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>

                {/* Action Filter */}
                <select
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium"
                >
                  <option value="all">All Actions ({distinctAuditActions.length})</option>
                  {distinctAuditActions.map((act) => (
                    <option key={act} value={act}>
                      {act}
                    </option>
                  ))}
                </select>

                {/* Date Filter */}
                <input
                  type="date"
                  value={auditDateFilter}
                  onChange={(e) => setAuditDateFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                  title="Filter audit logs by date"
                />

                {(auditSearch || auditUserFilter !== 'all' || auditActionFilter !== 'all' || auditDateFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuditSearch('');
                      setAuditUserFilter('all');
                      setAuditActionFilter('all');
                      setAuditDateFilter('');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  Showing <b>{filteredAuditLogs.length}</b> of <b>{auditLogs.length}</b> logs
                </span>
                <button
                  type="button"
                  onClick={handleExportAuditLogs}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Audit Trail (.xlsx)</span>
                </button>
              </div>
            </div>

            <div className="w-full overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Target</th>
                    <th className="py-2.5 px-3">User</th>
                    <th className="py-2.5 px-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        No audit events match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 text-slate-500 tabular-nums whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleTimeString('en-GB')} ·{' '}
                          {new Date(log.timestamp).toLocaleDateString('en-GB')}
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 font-medium">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-800 font-medium whitespace-nowrap">{log.target}</td>
                        <td className="py-2 px-3 text-slate-600 truncate max-w-[180px]">{log.userEmail}</td>
                        <td className="py-2 px-3 text-slate-500 truncate max-w-[280px]" title={log.details}>
                          {log.details || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Supabase Storage & Capacity Live Telemetry Tab */
          <div className="space-y-5">
            {/* Top Status & Live Refresh Header */}
            <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold tracking-tight text-white">
                      Supabase Cloud Live Storage &amp; Database Telemetry
                    </h3>
                    {storageStats && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono text-[11px]">
                        ● Connected ({storageStats.pingMs} ms)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    100% live byte &amp; row inspection directly from Supabase PostgreSQL tables, Auth &amp; Object Storage buckets (Zero cached/mock metrics)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {storageStats && (
                  <div className="text-right hidden sm:block">
                    <div className="text-[11px] font-mono text-slate-300">
                      Instance: <span className="text-sky-400 font-semibold">{storageStats.projectRef}</span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      Synced: {new Date(storageStats.measuredAt).toLocaleTimeString('en-GB')}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fetchStorageTelemetry(true)}
                  disabled={loadingStorageStats}
                  className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingStorageStats ? 'animate-spin' : ''}`} />
                  <span>{loadingStorageStats ? 'Inspecting Supabase...' : 'Refresh Live Stats'}</span>
                </button>
              </div>
            </div>

            {storageError && (
              <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{storageError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => fetchStorageTelemetry(true)}
                  className="px-2.5 py-1 rounded bg-rose-700 text-white font-semibold"
                >
                  Retry
                </button>
              </div>
            )}

            {!storageStats && loadingStorageStats ? (
              <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-sky-700" />
                <span>Querying live Supabase PostgreSQL tables &amp; storage buckets...</span>
              </div>
            ) : storageStats ? (
              <>
                {/* SECTION 1: PostgreSQL Database Capacity (Total vs Used vs Remaining) */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-sky-800" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        1. PostgreSQL Database Storage ({storageStats.database.planTier})
                      </h4>
                    </div>
                    <span className="font-mono text-xs text-slate-600">
                      Total Live Rows Across {storageStats.database.tableCount} Tables:{' '}
                      <strong className="text-slate-900">{storageStats.database.totalRows.toLocaleString()} rows</strong>
                    </span>
                  </div>

                  {/* 3 Primary Metric Cards: Total Quota | Actual Used | Remaining Available */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                    {/* Card 1: Total Allocated Capacity */}
                    <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Total Database Quota (Allocated Capacity)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                          {formatBytesHuman(storageStats.database.quotaBytes)}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">Allocated</span>
                      </div>
                      <div className="mt-1.5 text-[11px] font-mono text-slate-500 tabular-nums">
                        Exact: {storageStats.database.quotaBytes.toLocaleString()} Bytes
                      </div>
                    </div>

                    {/* Card 2: Actual Used Space */}
                    <div className="p-4 rounded-lg bg-sky-50/70 border border-sky-200">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-900">
                        Actual Database Used (Consumed Storage)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="text-2xl font-bold font-mono text-sky-950 tabular-nums">
                          {formatBytesHuman(storageStats.database.usedBytes)}
                        </span>
                        <span className="text-xs font-mono font-bold text-sky-800">
                          ({storageStats.database.usedPercent.toFixed(4)}%)
                        </span>
                      </div>
                      <div className="mt-1.5 text-[11px] font-mono text-sky-900/80 tabular-nums space-y-0.5">
                        <div>Indexed Tuple Footprint: {storageStats.database.usedBytes.toLocaleString()} Bytes</div>
                        <div>Raw UTF-8 Row Payload: {storageStats.database.rawPayloadBytes.toLocaleString()} Bytes</div>
                      </div>
                    </div>

                    {/* Card 3: Remaining Free Capacity */}
                    <div className="p-4 rounded-lg bg-emerald-50/70 border border-emerald-200">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-900">
                        Remaining Free Space (Available Capacity)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className="text-2xl font-bold font-mono text-emerald-950 tabular-nums">
                          {formatBytesHuman(storageStats.database.remainingBytes)}
                        </span>
                        <span className="text-xs font-mono font-bold text-emerald-700">
                          ({storageStats.database.remainingPercent.toFixed(4)}% Free)
                        </span>
                      </div>
                      <div className="mt-1.5 text-[11px] font-mono text-emerald-900/80 tabular-nums">
                        Exact Free: {storageStats.database.remainingBytes.toLocaleString()} Bytes
                      </div>
                    </div>
                  </div>

                  {/* Visual Capacity Meter */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-600">
                      <span>
                        Used: {formatBytesHuman(storageStats.database.usedBytes)} ({storageStats.database.usedBytes.toLocaleString()} B)
                      </span>
                      <span>
                        Available: {formatBytesHuman(storageStats.database.remainingBytes)} ({storageStats.database.remainingBytes.toLocaleString()} B)
                      </span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-slate-100 border border-slate-200 overflow-hidden">
                      <div
                        className="h-full bg-sky-700 transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(storageStats.database.usedBytes > 0 ? 1.5 : 0, storageStats.database.usedPercent))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* SECTION 2: Per-Table Live Database Breakdown */}
                <div ref={storageBreakdownRef} className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-sky-800" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        2. Live Table-Wise Storage Breakdown (PostgreSQL Schemas)
                      </h4>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Real-time UTF-8 row serialization + PostgreSQL B-Tree &amp; heap tuple overhead
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50/70 text-slate-600 border-b border-slate-200 font-semibold">
                          <th className="py-2.5 px-3">Schema · Table</th>
                          <th className="py-2.5 px-3">Purpose</th>
                          <th className="py-2.5 px-3 text-right">Live Rows</th>
                          <th className="py-2.5 px-3 text-right">Cols</th>
                          <th className="py-2.5 px-3 text-right">Raw UTF-8 Payload</th>
                          <th className="py-2.5 px-3 text-right">Total Indexed Storage</th>
                          <th className="py-2.5 px-3 text-right">Avg / Row</th>
                          <th className="py-2.5 px-3 text-center">State</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {storageStats.tables.map((t) => (
                          <tr key={`${t.schema}.${t.tableName}`} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                              <span className="text-slate-400 font-normal">{t.schema}.</span>
                              {t.tableName}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">{t.description}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                              {t.rowCount.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums">
                              {t.columnCount}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                              {formatBytesHuman(t.rawJsonBytes)}{' '}
                              <span className="text-[10px] text-slate-400">
                                ({t.rawJsonBytes.toLocaleString()} B)
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-sky-900 tabular-nums whitespace-nowrap">
                              {formatBytesHuman(t.indexedStorageBytes)}{' '}
                              <span className="text-[10px] text-slate-400 font-normal">
                                ({t.indexedStorageBytes.toLocaleString()} B)
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 tabular-nums whitespace-nowrap">
                              {t.avgBytesPerRow.toLocaleString()} B
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  t.status === 'online'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : t.status === 'empty'
                                    ? 'bg-slate-100 text-slate-600 border border-slate-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {t.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SECTION 3: Unit-Wise Equipment Storage Footprint (7 NRL Units) */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      3. Unit-Wise Equipment Data Footprint (public.equipment by NRL Unit)
                    </h4>
                    <span className="text-[11px] font-mono text-slate-500">
                      Live distribution across {storageStats.unitBreakdown.length} units
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {storageStats.unitBreakdown.map((u) => (
                      <div
                        key={u.unit}
                        className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 flex flex-col justify-between gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-slate-900 px-2 py-0.5 rounded bg-white border border-slate-200">
                            {u.unit}
                          </span>
                          <span className="font-mono text-xs font-semibold text-sky-900">
                            {u.rowCount.toLocaleString()} equip.
                          </span>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-slate-600">{formatBytesHuman(u.indexedBytes)}</span>
                            <span className="text-slate-500">{u.indexedBytes.toLocaleString()} B ({u.sharePercent}%)</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className="h-full bg-sky-700"
                              style={{ width: `${Math.min(100, u.sharePercent)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SECTION 4: Supabase Object Storage Buckets (1 GB Quota) */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-sky-800" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        4. Supabase Object Storage Buckets ({storageStats.objectStorage.planTier})
                      </h4>
                    </div>
                    <span className="text-[11px] font-mono text-slate-600">
                      Buckets: <strong>{storageStats.objectStorage.bucketCount}</strong> · Files:{' '}
                      <strong>{storageStats.objectStorage.totalFiles}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-[11px] font-semibold uppercase text-slate-500">
                        Total Bucket Quota (Allocated Capacity)
                      </div>
                      <div className="text-lg font-bold font-mono text-slate-900 mt-1">
                        {formatBytesHuman(storageStats.objectStorage.quotaBytes)}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {storageStats.objectStorage.quotaBytes.toLocaleString()} Bytes
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-sky-50/60 border border-sky-200">
                      <div className="text-[11px] font-semibold uppercase text-sky-900">
                        Bucket Storage Used (Consumed Storage)
                      </div>
                      <div className="text-lg font-bold font-mono text-sky-950 mt-1">
                        {formatBytesHuman(storageStats.objectStorage.usedBytes)}
                      </div>
                      <div className="text-[11px] font-mono text-sky-800">
                        {storageStats.objectStorage.usedBytes.toLocaleString()} Bytes ({storageStats.objectStorage.totalFiles} files)
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-emerald-50/60 border border-emerald-200">
                      <div className="text-[11px] font-semibold uppercase text-emerald-900">
                        Bucket Space Remaining (Available Capacity)
                      </div>
                      <div className="text-lg font-bold font-mono text-emerald-950 mt-1">
                        {formatBytesHuman(storageStats.objectStorage.remainingBytes)}
                      </div>
                      <div className="text-[11px] font-mono text-emerald-800">
                        {storageStats.objectStorage.remainingBytes.toLocaleString()} Bytes ({storageStats.objectStorage.remainingPercent.toFixed(2)}% Free)
                      </div>
                    </div>
                  </div>

                  {storageStats.buckets.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                            <th className="py-2 px-3">Bucket Name</th>
                            <th className="py-2 px-3">Visibility</th>
                            <th className="py-2 px-3 text-right">Files</th>
                            <th className="py-2 px-3 text-right">Used Size</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono">
                          {storageStats.buckets.map((b) => (
                            <tr key={b.id}>
                              <td className="py-2 px-3 font-bold text-slate-900">{b.name}</td>
                              <td className="py-2 px-3">
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">
                                  {b.public ? 'PUBLIC' : 'PRIVATE'}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right">{b.fileCount.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right">
                                {formatBytesHuman(b.usedBytes)} ({b.usedBytes.toLocaleString()} B)
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 font-mono">
                      No Object Storage buckets provisioned in storage.buckets (0 B used of 1.00 GB). All application records are stored in PostgreSQL tables above.
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Add / Edit Equipment Modal from inside Admin Database Manager */}
      {editingRecord && (
        <EquipmentEditModal
          item={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSave={async (updatedItem) => {
            await saveEquipment(updatedItem);
            fetchStorageTelemetry();
            showNotice(
              editingRecord.id
                ? `Updated equipment "${updatedItem.EquipmentTagNo}" in live database.`
                : `Added new equipment "${updatedItem.EquipmentTagNo}" to live database.`
            );
          }}
          onDelete={
            editingRecord.id
              ? async (id) => {
                  await deleteEquipment(id);
                  fetchStorageTelemetry();
                  showNotice(`Deleted equipment "${editingRecord.EquipmentTagNo}" from live database.`);
                }
              : undefined
          }
        />
      )}

      {/* Live Inspection Report Viewer & Uploader inside Admin Console */}
      {reportModalRecord && (
        <InspectionReportModal
          item={reportModalRecord.item}
          canEdit={true}
          initialTab={reportModalRecord.tab}
          onClose={() => setReportModalRecord(null)}
          onUpdated={async () => {
            await refreshEquipment();
            fetchStorageTelemetry();
          }}
          onOpenCloudSync={() => {
            setCloudSyncInitialTab('bulk_upload');
            setShowCloudSyncModal(true);
          }}
        />
      )}

      {/* Google Drive / OneDrive Folder Sync & Bulk Direct Upload Modal inside Admin Console */}
      {showCloudSyncModal && (
        <CloudFolderSyncModal
          equipment={equipment}
          scopeLabel="All Project Units (Admin Console)"
          initialTab={cloudSyncInitialTab}
          onClose={() => setShowCloudSyncModal(false)}
          onSynced={async () => {
            await refreshEquipment();
            fetchStorageTelemetry();
          }}
        />
      )}

      {/* SweetAlert-Style Warning Confirmation Popup for Single Equipment Delete */}
      {(() => {
        const targetItem = confirmDeleteId
          ? equipment.find((e) => e.id === confirmDeleteId) || null
          : null;
        return (
          <SweetWarningDeletePopup
            open={Boolean(targetItem)}
            title="Warning: Delete Equipment Record?"
            targetType="Equipment Record"
            targetName={
              targetItem
                ? `${targetItem.EquipmentTagNo} (${targetItem.Unit}${
                    targetItem.SubUnit ? ` › ${targetItem.SubUnit}` : ''
                  })`
                : ''
            }
            description={
              targetItem
                ? `Are you sure you want to permanently delete equipment "${targetItem.EquipmentTagNo}" (${
                    targetItem.EquipmentDescription || 'Equipment'
                  }) from the live database?`
                : ''
            }
            warningNote="All inspection statuses and linked report references for this equipment tag will be deleted."
            confirmLabel="Yes, Delete Equipment"
            cancelLabel="No, Cancel"
            loading={busyAction}
            onCancel={() => setConfirmDeleteId(null)}
            onConfirm={() => {
              if (targetItem) handleSingleDelete(targetItem);
            }}
          />
        );
      })()}

      {/* SweetAlert-Style Warning Confirmation Popup for Bulk Delete Selected Equipment */}
      <SweetWarningDeletePopup
        open={confirmBulkDelete}
        title="Warning: Delete Selected Equipment?"
        targetType="Bulk Equipment Delete"
        targetName={`${selectedIds.size} Selected Equipment Record(s)`}
        description={`Are you sure you want to permanently delete all ${selectedIds.size} selected equipment record(s) from the live NREP database?`}
        warningNote="This bulk deletion cannot be undone once confirmed."
        confirmLabel={`Yes, Delete ${selectedIds.size} Record(s)`}
        cancelLabel="No, Keep Selected"
        loading={busyAction}
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={handleBulkDeleteConfirmed}
      />

      {/* SweetAlert-Style Warning Confirmation Popup for Clear All Database */}
      <SweetWarningDeletePopup
        open={confirmClearAll}
        title="Critical Warning: Clear Entire Database?"
        targetType="All Database Records"
        targetName={`All ${equipment.length} Equipment Records`}
        description={`Are you sure you want to delete ALL ${equipment.length} equipment records from the live Supabase database?`}
        warningNote="Every equipment record across all units will be removed. Make sure you have exported an Excel backup first."
        confirmLabel="Yes, Clear Entire Database"
        cancelLabel="Cancel, Keep Database"
        requireConfirmText="DELETE"
        loading={busyAction}
        onCancel={() => setConfirmClearAll(false)}
        onConfirm={handleClearAllConfirmed}
      />

      {/* SweetAlert-Style Warning Confirmation Popup for Reset to Sample Data */}
      <SweetWarningDeletePopup
        open={confirmResetSample}
        title="Warning: Reset to Factory Sample Data?"
        targetType="Database Reset"
        targetName="Restore Default Sample Dataset"
        description="Are you sure you want to overwrite the current live database with the default factory sample dataset?"
        warningNote="Current custom changes not exported to Excel will be replaced by the sample dataset."
        confirmLabel="Yes, Reset Sample Data"
        cancelLabel="Cancel"
        loading={busyAction}
        onCancel={() => setConfirmResetSample(false)}
        onConfirm={handleResetSampleConfirmed}
      />

      {/* SweetAlert-Style Warning Confirmation Popup for Deleting User Account */}
      {(() => {
        const targetUser = confirmDeleteUserUid
          ? users.find((u) => u.uid === confirmDeleteUserUid) || null
          : null;
        return (
          <SweetWarningDeletePopup
            open={Boolean(targetUser)}
            title="Warning: Revoke & Delete User Account?"
            targetType="User Account"
            targetName={
              targetUser
                ? `${targetUser.displayName || 'User'} (${targetUser.email})`
                : ''
            }
            description={
              targetUser
                ? `Are you sure you want to revoke access and delete "${targetUser.email}" from the NREP system registry?`
                : ''
            }
            warningNote="This user will immediately lose login and editing privileges."
            confirmLabel="Yes, Delete User"
            cancelLabel="No, Keep User"
            loading={busyAction}
            onCancel={() => setConfirmDeleteUserUid(null)}
            onConfirm={() => {
              if (targetUser) handleDeleteUser(targetUser.uid, targetUser.email);
            }}
          />
        );
      })()}

      {/* SweetAlert-Style Warning Confirmation Popup for Server Unit Delete */}
      <SweetWarningDeletePopup
        open={Boolean(unitToDelete)}
        title="Warning: Delete Project Unit from Server?"
        targetType="Canonical Unit"
        targetName={unitToDelete || ''}
        description={
          unitToDelete
            ? `Are you sure you want to remove Unit "${unitToDelete}" from the Supabase Server configuration?`
            : ''
        }
        warningNote="Removing this unit will update the server unit registry. Existing equipment tagged under this unit will remain intact in the database."
        confirmLabel="Yes, Delete Unit"
        cancelLabel="Cancel"
        loading={deletingUnit}
        onCancel={() => setUnitToDelete(null)}
        onConfirm={() => {
          if (unitToDelete) handleDeleteServerUnit(unitToDelete);
        }}
      />

      {/* Mint-Green Popup Toast Window matching reference screenshot image_073d974d */}
      {greenToast?.visible && (
        <div
          role="status"
          className="fixed top-6 right-6 z-[9999] flex items-center justify-between gap-5 px-4 py-3 rounded-[3px] shadow-lg text-white select-none transition-all duration-200 animate-in fade-in slide-in-from-top-2"
          style={{
            backgroundColor: '#7de2a4',
            minWidth: '330px',
            maxWidth: '92vw',
          }}
        >
          <span className="font-bold text-white text-[13px] tracking-tight antialiased">
            {greenToast.message}
          </span>
          <button
            type="button"
            onClick={() => setGreenToast(null)}
            className="text-gray-600 hover:text-gray-900 transition-colors p-0.5 cursor-pointer ml-3 flex items-center justify-center"
            aria-label="Close notification"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      )}

      {/* SweetAlert-Style Success Popup Window */}
      <SweetSuccessPopup
        open={Boolean(sweetSuccess)}
        title={sweetSuccess?.title || 'Success!'}
        message={sweetSuccess?.message || ''}
        badgeText={sweetSuccess?.badgeText}
        metaItems={sweetSuccess?.metaItems}
        confirmLabel="OK, Done!"
        onClose={() => setSweetSuccess(null)}
      />
    </div>
  );

  if (inline) {
    return (
      <div className="w-full min-h-screen px-4 md:px-6 py-4">
        {panelBody}
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen px-4 md:px-6 fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs py-4 overflow-y-auto">
      <div className="w-full max-h-[96vh] flex flex-col">
        {panelBody}
      </div>
    </div>
  );
}

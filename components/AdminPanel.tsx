'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  setDoc,
} from 'firebase/firestore';
import { db, safeFirestoreWrite } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useEquipment } from '@/lib/equipment-context';
import {
  UserProfile,
  UserRole,
  UserStatus,
  UNITS,
  UTILITY_SUB_UNITS,
  EquipmentItem,
  STATUS_COLUMNS,
  isDone,
  calculateProgress,
  getEquipmentOverallStatus,
} from '@/lib/types';
import EquipmentEditModal from './EquipmentEditModal';
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
} from 'lucide-react';

interface AdminPanelProps {
  onClose: () => void;
  inline?: boolean;
  initialTab?: 'database' | 'users' | 'add' | 'audit';
}

export default function AdminPanel({
  onClose,
  inline = false,
  initialTab = 'database',
}: AdminPanelProps) {
  const { user, profile, isAdmin } = useAuth();
  const {
    equipment,
    updateEquipmentField,
    saveEquipment,
    deleteEquipment,
    bulkDeleteEquipment,
    clearAllEquipment,
    resetToSampleData,
    auditLogs,
  } = useEquipment();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeTab, setActiveTab] = useState<'database' | 'users' | 'add' | 'audit'>(initialTab);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Database Manager states
  const [dbSearch, setDbSearch] = useState('');
  const [dbUnitFilter, setDbUnitFilter] = useState('all');
  const [dbSubUnitFilter, setDbSubUnitFilter] = useState('all');
  const [dbStatusFilter, setDbStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingRecord, setEditingRecord] = useState<EquipmentItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmResetSample, setConfirmResetSample] = useState(false);
  const [confirmDeleteUserUid, setConfirmDeleteUserUid] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // New user form state
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('editor');
  const [newStatus, setNewStatus] = useState<UserStatus>('approved');
  const [newUnits, setNewUnits] = useState('All');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submittingUser, setSubmittingUser] = useState(false);

  // Table row password editing states
  const [passwordEdits, setPasswordEdits] = useState<{ [uid: string]: string }>({});
  const [visiblePasswords, setVisiblePasswords] = useState<{ [uid: string]: boolean }>({});
  const [savingPasswordUid, setSavingPasswordUid] = useState<string | null>(null);

  const showNotice = (text: string, type: 'success' | 'error' = 'success') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // Real-time user list listener for administrators
  useEffect(() => {
    if (!isAdmin) return;

    const usersRef = collection(db, 'users');
    const unsubscribe = onSnapshot(
      usersRef,
      async (snapshot) => {
        const list: UserProfile[] = [];
        let hasAdminDoc = false;
        const initialEdits: { [uid: string]: string } = {};

        snapshot.forEach((d) => {
          const uData = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
          list.push(uData);
          initialEdits[d.id] =
            uData.password && !uData.password.startsWith('sha256:') ? uData.password : '';
          if (d.id === 'admin' || uData.role === 'admin') {
            hasAdminDoc = true;
          }
        });

        if (!hasAdminDoc) {
          try {
            const seedRes = await fetch('/api/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'get-bootstrap-admin-seed' }),
            });
            const seedData = await seedRes.json();
            if (seedData?.ok && seedData?.adminRecord) {
              const defaultAdmin = seedData.adminRecord as UserProfile;
              list.unshift(defaultAdmin);
              initialEdits['admin'] = '';
            }
          } catch {}
        }

        setUsers(list);
        setPasswordEdits((prev) => ({ ...initialEdits, ...prev }));
      },
      (err) => {
        console.warn('Note on loading users list:', err.message);
        if (profile) {
          setUsers([profile]);
        }
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Available units for filter
  const allUnits = useMemo(() => {
    const set = new Set<string>(UNITS);
    equipment.forEach((e) => {
      if (e.Unit) set.add(e.Unit);
    });
    return Array.from(set);
  }, [equipment]);

  // Filtered equipment for Live Database tab
  const filteredEquipment = useMemo(() => {
    const q = dbSearch.trim().toLowerCase();
    return equipment.filter((item) => {
      if (dbUnitFilter !== 'all' && item.Unit !== dbUnitFilter) return false;
      if (dbSubUnitFilter !== 'all') {
        const itemSub = item.SubUnit || item.AreaPackage || item.SystemNo || '';
        if (item.Unit !== 'UTILITY' || itemSub !== dbSubUnitFilter) return false;
      }
      const overall = getEquipmentOverallStatus(item);
      if (dbStatusFilter !== 'all' && overall !== dbStatusFilter) return false;
      if (!q) return true;
      return (
        (item.EquipmentTagNo || '').toLowerCase().includes(q) ||
        (item.Unit || '').toLowerCase().includes(q) ||
        (item.SubUnit || '').toLowerCase().includes(q) ||
        (item.SystemNo || '').toLowerCase().includes(q) ||
        (item.EquipmentDescription || '').toLowerCase().includes(q) ||
        (item.EquipmentType || '').toLowerCase().includes(q) ||
        (item.BaseLineUTG || '').toLowerCase().includes(q) ||
        (item.DocumentDrawing || '').toLowerCase().includes(q) ||
        (item.Remarks || '').toLowerCase().includes(q)
      );
    });
  }, [equipment, dbSearch, dbUnitFilter, dbSubUnitFilter, dbStatusFilter]);

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
    const defaultUnit = dbUnitFilter !== 'all' ? dbUnitFilter : UNITS[0];
    const defaultSubUnit =
      defaultUnit === 'UTILITY'
        ? dbSubUnitFilter !== 'all'
          ? dbSubUnitFilter
          : UTILITY_SUB_UNITS[0]
        : '';
    setEditingRecord({
      id: '',
      Unit: defaultUnit,
      SubUnit: defaultSubUnit,
      SystemNo: defaultSubUnit || `${defaultUnit} Main System`,
      EquipmentTagNo: '',
      EquipmentDescription: '',
      EquipmentType: '',
      FormatIStatus: 'Not Issued',
      FormatIDate: '',
      FormatIIStatus: 'Not Issued',
      FormatIIDate: '',
      FormatIIIStatus: 'Not Issued',
      FormatIIIDate: '',
      InternalInspectionStatus: 'No',
      BaseLineUTG: 'No',
      PunchPointsCategoryClosed: '',
      FinalSystemAcceptance: 'Not accept',
      DocumentDrawing: '',
      Remarks: '',
    });
  };

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
    } catch (err: any) {
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
    } catch (err: any) {
      showNotice(err.message || 'Bulk delete failed', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleClearAllConfirmed = async () => {
    setBusyAction(true);
    try {
      await clearAllEquipment();
      setSelectedIds(new Set());
      setConfirmClearAll(false);
      showNotice('All equipment records cleared from live database.');
    } catch (err: any) {
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
    } catch (err: any) {
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
      const hashRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hash-password', password: trimmed }),
      });
      const hashData = await hashRes.json();
      if (!hashRes.ok || !hashData?.hashedPassword) {
        throw new Error(hashData?.error || 'Failed to hash password on backend');
      }

      const userRef = doc(db, 'users', targetUid);
      await safeFirestoreWrite(() => setDoc(userRef, { password: hashData.hashedPassword }, { merge: true }));
      setPasswordEdits((prev) => ({ ...prev, [targetUid]: '' }));
      showNotice(`Password securely hashed & updated for "${targetUid}"`);
    } catch (err: any) {
      showNotice(err.message || 'Failed to update password', 'error');
    } finally {
      setSavingPasswordUid(null);
    }
  };

  const handleRoleChange = async (targetUid: string, newRoleValue: UserRole) => {
    try {
      setUsers((prev) => prev.map((u) => (u.uid === targetUid ? { ...u, role: newRoleValue } : u)));
      const userRef = doc(db, 'users', targetUid);
      await safeFirestoreWrite(() => setDoc(userRef, { role: newRoleValue }, { merge: true }));

      const adminDocRef = doc(db, 'admins', targetUid);
      if (newRoleValue === 'admin') {
        const target = users.find((u) => u.uid === targetUid);
        await safeFirestoreWrite(() =>
          setDoc(adminDocRef, {
            uid: targetUid,
            email: target?.email,
            assignedAt: new Date().toISOString(),
          })
        );
      } else {
        await safeFirestoreWrite(() => deleteDoc(adminDocRef).catch(() => {}));
      }

      showNotice(`Updated user role to ${newRoleValue}`);
    } catch (err: any) {
      showNotice(err.message || 'Failed to update role', 'error');
    }
  };

  const handleStatusChange = async (targetUid: string, newStatusValue: UserStatus) => {
    try {
      setUsers((prev) => prev.map((u) => (u.uid === targetUid ? { ...u, status: newStatusValue } : u)));
      const userRef = doc(db, 'users', targetUid);
      await safeFirestoreWrite(() => setDoc(userRef, { status: newStatusValue }, { merge: true }));
      showNotice(`User access status updated to ${newStatusValue}`);
    } catch (err: any) {
      showNotice(err.message || 'Failed to update status', 'error');
    }
  };

  const handleUnitsAssignment = async (targetUid: string, assignedUnits: string) => {
    try {
      setUsers((prev) => prev.map((u) => (u.uid === targetUid ? { ...u, assignedUnits } : u)));
      const userRef = doc(db, 'users', targetUid);
      await safeFirestoreWrite(() => setDoc(userRef, { assignedUnits }, { merge: true }));
      showNotice('Updated assigned unit jurisdiction');
    } catch (err: any) {
      showNotice(err.message || 'Failed to update units', 'error');
    }
  };

  const handleDeleteUser = async (targetUid: string, email: string) => {
    try {
      setUsers((prev) => prev.filter((u) => u.uid !== targetUid));
      await safeFirestoreWrite(async () => {
        await deleteDoc(doc(db, 'users', targetUid));
        await deleteDoc(doc(db, 'admins', targetUid)).catch(() => {});
      });
      setConfirmDeleteUserUid(null);
      showNotice(`User ${email} removed from system registry`);
    } catch (err: any) {
      showNotice(err.message || 'Failed to delete user', 'error');
    }
  };

  const handleCreateOrAuthorizeUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = newEmail.trim();
    if (!rawInput) {
      showNotice('Please enter a valid email or user ID.', 'error');
      return;
    }

    const email = rawInput.includes('@') ? rawInput.toLowerCase() : `${rawInput.toLowerCase()}@nrl.co.in`;
    const assignedPass = newPassword.trim();

    setSubmittingUser(true);
    setStatusMsg(null);

    try {
      const existing = users.find((u) => u.email.toLowerCase() === email || u.uid === rawInput.toLowerCase());
      const targetId = existing ? existing.uid : rawInput.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_');

      let hashedPassword = existing?.password || undefined;
      if (assignedPass) {
        const hashRes = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'hash-password', password: assignedPass }),
        });
        const hashData = await hashRes.json();
        if (hashRes.ok && hashData?.hashedPassword) {
          hashedPassword = hashData.hashedPassword;
        }
      }

      const userDocRef = doc(db, 'users', targetId);
      const record: UserProfile = {
        uid: targetId,
        email: email,
        displayName: newName.trim() || rawInput.split('@')[0],
        role: newRole,
        status: newStatus,
        assignedUnits: newUnits,
        ...(hashedPassword ? { password: hashedPassword } : {}),
        createdAt: existing?.createdAt || new Date().toISOString(),
        lastLoginAt: existing?.lastLoginAt || 'Not logged in yet',
      };

      setUsers((prev) => {
        const idx = prev.findIndex((u) => u.uid === targetId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = record;
          return copy;
        }
        return [record, ...prev];
      });

      await safeFirestoreWrite(() => setDoc(userDocRef, record, { merge: true }));

      if (newRole === 'admin') {
        const adminDocRef = doc(db, 'admins', targetId);
        await safeFirestoreWrite(() =>
          setDoc(adminDocRef, {
            uid: targetId,
            email: email,
            assignedAt: new Date().toISOString(),
          })
        );
      }

      showNotice(
        `Success! Access granted to ${rawInput} as ${newRole.toUpperCase()}${
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

  if (!isAdmin) {
    const deniedContent = (
      <div className="w-full max-w-md mx-auto my-8 rounded-xl bg-white p-6 shadow-md border border-slate-200 text-center">
        <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-900">Administrator Access Required</h3>
        <p className="text-xs text-slate-600 mt-2">
          Only designated system administrators can manage live database records and user privileges.
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

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.displayName || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const panelBody = (
    <div
      className={
        inline
          ? 'w-full rounded-xl bg-white shadow-sm border border-slate-200 overflow-hidden flex flex-col'
          : 'w-full max-w-6xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]'
      }
    >
      {/* Top Header */}
      <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between border-b border-slate-800 shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-600/30 text-sky-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-white">
              Admin Console &amp; Live Database Manager
            </h2>
            <p className="text-xs text-slate-400">
              Add, edit, or delete live equipment records in Cloud Firestore &amp; manage user roles and permissions
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors"
        >
          <X className="w-4 h-4" />
          <span>{inline ? 'Back to Project Overview' : 'Close'}</span>
        </button>
      </div>

      {/* Tab Selection */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab('database')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              activeTab === 'database'
                ? 'bg-sky-900 text-white shadow-xs border border-sky-950'
                : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Live Database ({equipment.length} Equip.)</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'users'
                ? 'bg-sky-900 text-white shadow-xs border border-sky-950 font-semibold'
                : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200'
            }`}
          >
            👥 Users &amp; Roles ({users.length})
          </button>

          <button
            onClick={() => setActiveTab('add')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'add'
                ? 'bg-sky-900 text-white shadow-xs border border-sky-950 font-semibold'
                : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ Grant User Access</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'audit'
                ? 'bg-sky-900 text-white shadow-xs border border-sky-950 font-semibold'
                : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200'
            }`}
          >
            📋 Audit Trail ({auditLogs.length})
          </button>
        </div>

        {statusMsg && (
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
        )}
      </div>

      {/* Tab Content */}
      <div className={inline ? 'p-5' : 'p-5 overflow-y-auto flex-1'}>
        {activeTab === 'database' ? (
          <div className="space-y-4">
            {/* Database Controls & Bulk Actions Bar */}
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                <input
                  type="text"
                  placeholder="🔍 Search Tag No, Unit, System, Description, Drawing..."
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 w-full sm:w-64 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />

                <select
                  value={dbUnitFilter}
                  onChange={(e) => {
                    const nextU = e.target.value;
                    setDbUnitFilter(nextU);
                    if (nextU !== 'UTILITY' && nextU !== 'all') {
                      setDbSubUnitFilter('all');
                    }
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

                {(dbUnitFilter === 'UTILITY' || dbUnitFilter === 'all') && (
                  <select
                    value={dbSubUnitFilter}
                    onChange={(e) => {
                      const nextSub = e.target.value;
                      setDbSubUnitFilter(nextSub);
                      if (nextSub !== 'all') {
                        setDbUnitFilter('UTILITY');
                      }
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
                  value={dbStatusFilter}
                  onChange={(e) => setDbStatusFilter(e.target.value)}
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

              {/* Action Buttons: Add Record, Bulk Delete, Reset, Clear All */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenAddModal}
                  className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors"
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

                {confirmResetSample ? (
                  <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                    <span className="text-xs font-semibold text-amber-900">Reset to sample data?</span>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={handleResetSampleConfirmed}
                      className="px-2 py-0.5 rounded bg-amber-600 text-white text-xs font-bold hover:bg-amber-700"
                    >
                      Confirm Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmResetSample(false)}
                      className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-300 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmResetSample(true)}
                    className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium text-xs flex items-center gap-1 transition-colors"
                    title="Restore default factory sample data"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Sample Data</span>
                  </button>
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
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
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
                    <th className="py-2.5 px-3">System No.</th>
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
                    filteredEquipment.map((item) => {
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
                          <td className="py-2 px-3 text-slate-600 max-w-[180px] truncate" title={item.SubUnit || item.SystemNo}>
                            {item.Unit === 'UTILITY' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-900 font-semibold text-[11px]">
                                {item.SubUnit || item.SystemNo}
                              </span>
                            ) : (
                              <span>{item.SystemNo}</span>
                            )}
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

                          {/* Document / Drawing */}
                          <td className="py-2 px-3 text-slate-700 font-mono text-[11px] max-w-[160px] truncate" title={item.DocumentDrawing || ''}>
                            {item.DocumentDrawing ? (
                              /^https?:\/\//i.test(item.DocumentDrawing) ? (
                                <a
                                  href={item.DocumentDrawing}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-700 hover:underline font-semibold"
                                >
                                  📄 View Doc
                                </a>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 font-semibold">
                                  {item.DocumentDrawing}
                                </span>
                              )
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
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
          </div>
        ) : activeTab === 'add' ? (
          <div className="max-w-xl mx-auto py-2 space-y-4">
            <div className="p-4 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-900 leading-relaxed flex items-start gap-3">
              <HelpCircle className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">How to give Admin or Editor access to another user:</div>
                <p className="mt-1">
                  Enter your colleague&apos;s email address below and set their role to <b>Admin</b> (full control) or{' '}
                  <b>Editor</b> (can edit data and upload Excel). When they sign in with that email, the
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
                  placeholder="e.g. colleague@nrl.co.in or engineer01"
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
                    <option value="editor">Editor (Can edit &amp; upload)</option>
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
                  {submittingUser ? 'Saving to Cloud Firestore...' : 'Authorize User & Grant Access'}
                </button>
              </div>
            </form>
          </div>
        ) : activeTab === 'users' ? (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between flex-wrap gap-2">
              <span>
                <b>Instructions:</b> Change any user&apos;s role from <b>Viewer</b> to <b>Admin</b> or <b>Editor</b> using
                the dropdown menu in the table below. Changes update in Cloud Firestore immediately.
              </span>
              <button
                onClick={() => setActiveTab('add')}
                className="px-2.5 py-1 rounded bg-sky-900 text-white font-medium text-[11px] whitespace-nowrap"
              >
                + Add User By Email
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <input
                type="text"
                placeholder="Filter users by email or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 w-full sm:w-72 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
              />

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

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
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
                      const isVisible = visiblePasswords[u.uid] || false;
                      const currentPassValue = passwordEdits[u.uid] !== undefined ? passwordEdits[u.uid] : '';

                      return (
                        <tr key={u.uid} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{u.displayName || 'No Name'}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{u.email}</div>
                            {u.uid === 'admin' && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] bg-sky-100 text-sky-800 font-semibold">
                                Default Admin Account
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={u.role || 'viewer'}
                              disabled={isSelf}
                              onChange={(e) => handleRoleChange(u.uid, e.target.value as UserRole)}
                              className="px-2 py-1 rounded border border-slate-300 bg-white text-xs font-semibold text-sky-950 disabled:opacity-50"
                            >
                              <option value="admin">Admin (Full Control)</option>
                              <option value="editor">Editor (Can edit &amp; upload)</option>
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
                                title="Hash on backend & save to Cloud Firestore"
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
                                  u.status === 'approved'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : u.status === 'pending'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                                }`}
                              >
                                {u.status}
                              </span>
                              {!isSelf && (
                                <select
                                  value={u.status}
                                  onChange={(e) => handleStatusChange(u.uid, e.target.value as UserStatus)}
                                  className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-white"
                                >
                                  <option value="approved">Approve</option>
                                  <option value="pending">Mark Pending</option>
                                  <option value="suspended">Suspend</option>
                                </select>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={u.assignedUnits || 'All'}
                              onChange={(e) => handleUnitsAssignment(u.uid, e.target.value)}
                              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white max-w-[160px]"
                            >
                              <option value="All">All Units</option>
                              {UNITS.map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </select>
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
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span>Displaying latest 50 security and data mutation logs</span>
              <span className="font-mono text-[11px]">Synced via Firestore</span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
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
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        No audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
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
        )}
      </div>

      {/* Add / Edit Equipment Modal from inside Admin Database Manager */}
      {editingRecord && (
        <EquipmentEditModal
          item={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSave={async (updatedItem) => {
            await saveEquipment(updatedItem);
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
                  showNotice(`Deleted equipment "${editingRecord.EquipmentTagNo}" from live database.`);
                }
              : undefined
          }
        />
      )}
    </div>
  );

  if (inline) {
    return panelBody;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 md:p-6 overflow-y-auto">
      {panelBody}
    </div>
  );
}

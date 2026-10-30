'use client';

import React, { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useEquipment } from '@/lib/equipment-context';
import { UserProfile, UserRole, UserStatus, UNITS } from '@/lib/types';
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
} from 'lucide-react';

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const { user, profile, isAdmin } = useAuth();
  const { auditLogs } = useEquipment();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'add' | 'audit'>('users');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

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
          initialEdits[d.id] = uData.password || '';
          if (d.id === 'admin' || uData.email?.toLowerCase() === 'kayetavijit97@gmail.com') {
            hasAdminDoc = true;
          }
        });

        // Ensure default 'admin' account document exists in Firestore
        if (!hasAdminDoc) {
          const defaultAdmin: UserProfile = {
            uid: 'admin',
            email: 'kayetavijit97@gmail.com',
            displayName: 'admin',
            role: 'admin',
            status: 'approved',
            password: 'admin',
            assignedUnits: 'All',
            createdAt: new Date().toISOString(),
            lastLoginAt: 'System Master Admin',
          };
          try {
            await setDoc(doc(db, 'users', 'admin'), defaultAdmin, { merge: true });
            await setDoc(doc(db, 'admins', 'admin'), {
              uid: 'admin',
              email: 'kayetavijit97@gmail.com',
              assignedAt: new Date().toISOString(),
            }, { merge: true });
            list.unshift(defaultAdmin);
            initialEdits['admin'] = 'admin';
          } catch (e) {}
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
  }, [isAdmin]);

  const handleUpdatePassword = async (targetUid: string) => {
    const val = passwordEdits[targetUid];
    if (val === undefined) return;
    const trimmed = val.trim();
    if (!trimmed) {
      setStatusMsg({ text: 'Password cannot be blank.', type: 'error' });
      return;
    }
    setSavingPasswordUid(targetUid);
    try {
      const userRef = doc(db, 'users', targetUid);
      await setDoc(userRef, { password: trimmed }, { merge: true });
      setStatusMsg({ text: `Password successfully assigned/updated for "${targetUid}"`, type: 'success' });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ text: err.message || 'Failed to update password', type: 'error' });
    } finally {
      setSavingPasswordUid(null);
    }
  };

  const handleRoleChange = async (targetUid: string, newRoleValue: UserRole) => {
    try {
      const userRef = doc(db, 'users', targetUid);
      await setDoc(userRef, { role: newRoleValue }, { merge: true });

      // If made admin, sync with admins collection
      const adminDocRef = doc(db, 'admins', targetUid);
      if (newRoleValue === 'admin') {
        const target = users.find((u) => u.uid === targetUid);
        await setDoc(adminDocRef, {
          uid: targetUid,
          email: target?.email,
          assignedAt: new Date().toISOString(),
        });
      } else {
        await deleteDoc(adminDocRef).catch(() => {});
      }

      setStatusMsg({ text: `Updated user role to ${newRoleValue}`, type: 'success' });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ text: err.message || 'Failed to update role', type: 'error' });
    }
  };

  const handleStatusChange = async (targetUid: string, newStatusValue: UserStatus) => {
    try {
      const userRef = doc(db, 'users', targetUid);
      await setDoc(userRef, { status: newStatusValue }, { merge: true });
      setStatusMsg({ text: `User access status updated to ${newStatusValue}`, type: 'success' });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ text: err.message || 'Failed to update status', type: 'error' });
    }
  };

  const handleUnitsAssignment = async (targetUid: string, assignedUnits: string) => {
    try {
      const userRef = doc(db, 'users', targetUid);
      await setDoc(userRef, { assignedUnits }, { merge: true });
      setStatusMsg({ text: 'Updated assigned unit jurisdiction', type: 'success' });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ text: err.message || 'Failed to update units', type: 'error' });
    }
  };

  const handleDeleteUser = async (targetUid: string, email: string) => {
    if (!confirm(`Are you sure you want to remove user access for ${email}?`)) return;
    try {
      await deleteDoc(doc(db, 'users', targetUid));
      await deleteDoc(doc(db, 'admins', targetUid)).catch(() => {});
      setStatusMsg({ text: `User ${email} removed from system registry`, type: 'success' });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ text: err.message || 'Failed to delete user', type: 'error' });
    }
  };

  // Add / Pre-authorize another user by email or user ID
  const handleCreateOrAuthorizeUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = newEmail.trim();
    if (!rawInput) {
      setStatusMsg({ text: 'Please enter a valid email or user ID.', type: 'error' });
      return;
    }

    const email = rawInput.includes('@') ? rawInput.toLowerCase() : `${rawInput.toLowerCase()}@nrl.co.in`;
    const assignedPass = newPassword.trim();

    setSubmittingUser(true);
    setStatusMsg(null);

    try {
      // Find if user already exists
      const existing = users.find((u) => u.email.toLowerCase() === email || u.uid === rawInput.toLowerCase());
      const targetId = existing ? existing.uid : rawInput.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_');

      const userDocRef = doc(db, 'users', targetId);
      const record: UserProfile = {
        uid: targetId,
        email: email,
        displayName: newName.trim() || rawInput.split('@')[0],
        role: newRole,
        status: newStatus,
        assignedUnits: newUnits,
        password: assignedPass || existing?.password || undefined,
        createdAt: existing?.createdAt || new Date().toISOString(),
        lastLoginAt: existing?.lastLoginAt || 'Not logged in yet',
      };

      await setDoc(userDocRef, record, { merge: true });

      if (newRole === 'admin') {
        const adminDocRef = doc(db, 'admins', targetId);
        await setDoc(adminDocRef, {
          uid: targetId,
          email: email,
          assignedAt: new Date().toISOString(),
        });
      }

      setStatusMsg({
        text: `Success! Access granted to ${rawInput} as ${newRole.toUpperCase()}${assignedPass ? ` with assigned password.` : '.'} They can now sign in on the login screen.`,
        type: 'success',
      });

      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setActiveTab('users');
    } catch (err: any) {
      setStatusMsg({ text: err.message || 'Failed to grant user access', type: 'error' });
    } finally {
      setSubmittingUser(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl text-center">
          <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-900">Administrator Access Required</h3>
          <p className="text-xs text-slate-600 mt-2">
            Only designated administrators (such as <span className="font-mono">kayetavijit97@gmail.com</span>) can
            manage user privileges and assign admin/editor access to other users.
          </p>
          <button onClick={onClose} className="mt-5 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-medium">
            Close Panel
          </button>
        </div>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 md:p-6 overflow-y-auto">
      <div className="w-full max-w-5xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-600/30 text-sky-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Admin & User Access Control</h2>
              <p className="text-xs text-slate-400">
                Grant Admin/Editor rights to colleagues, approve user registrations, and configure permissions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('users')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'users'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Registered Users & Roles ({users.length})
            </button>
            <button
              onClick={() => setActiveTab('add')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'add'
                  ? 'bg-white text-sky-900 shadow-xs border border-slate-200 font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 text-sky-600" />
              + Grant Access to Another User
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'audit'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Audit Trail ({auditLogs.length})
            </button>
          </div>

          {statusMsg && (
            <div
              className={`text-xs px-3 py-1 rounded-md flex items-center gap-1.5 ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
              {statusMsg.text}
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'add' ? (
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
                  <label className="block text-slate-600 font-semibold mb-1">User Email Address (Required)</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. colleague@nrl.co.in or colleague@gmail.com"
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
                      <option value="editor">Editor (Can edit & upload)</option>
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
              {/* Instructions Box */}
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                <span>
                  <b>Instructions:</b> Change any user&apos;s role from <b>Viewer</b> to <b>Admin</b> or <b>Editor</b> using
                  the dropdown menu in the table below. Changes update in Cloud Firestore immediately.
                </span>
                <button
                  onClick={() => setActiveTab('add')}
                  className="px-2.5 py-1 rounded bg-sky-900 text-white font-medium text-[11px] whitespace-nowrap ml-3"
                >
                  + Add User By Email
                </button>
              </div>

              {/* Filter tools */}
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

              {/* Users table */}
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                      <th className="py-2.5 px-3">User & Email</th>
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
                          No users registered yet. Click &quot;+ Grant Access to Another User&quot; to authorize a colleague.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isSelf = u.uid === user?.uid || u.email.toLowerCase() === user?.email?.toLowerCase();
                        const isVisible = visiblePasswords[u.uid] || false;
                        const currentPassValue = passwordEdits[u.uid] !== undefined ? passwordEdits[u.uid] : (u.password || '');

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
                                <option value="editor">Editor (Can edit & upload)</option>
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
                                    placeholder="Set password..."
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
                                  title="Save password to Cloud Firestore"
                                  className="px-2 py-1 bg-sky-900 text-white rounded text-[11px] font-medium hover:bg-sky-800 transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1"
                                >
                                  <Save className="w-3 h-3" />
                                  {savingPasswordUid === u.uid ? '...' : 'Save'}
                                </button>
                              </div>
                              {u.password && (
                                <div className="text-[10px] text-emerald-600 font-medium mt-0.5 flex items-center gap-1">
                                  <Key className="w-2.5 h-2.5" /> Assigned
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
                                <button
                                  onClick={() => handleDeleteUser(u.uid, u.email)}
                                  title="Revoke and delete user access"
                                  className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
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
      </div>
    </div>
  );
}

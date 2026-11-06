'use client';

import React, { useState } from 'react';
import {
  EquipmentItem,
  UNITS,
  UTILITY_SUB_UNITS,
  MSP_SUB_UNITS,
  STATUS_COLUMNS,
  isDone,
  calculateProgress,
  formatEquipmentHierarchyPath,
  getUserAllowedUnits,
} from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import {
  parseEquipmentDocumentField,
  serializeEquipmentDocumentField,
  getProviderBadgeMeta,
} from '@/lib/reportUtils';
import InspectionReportModal from './InspectionReportModal';
import {
  SweetWarningDeletePopup,
  SweetSuccessPopup,
} from './SweetPopupModal';
import {
  Edit3,
  Plus,
  Trash2,
  Save,
  X,
  FileText,
  AlertCircle,
  CheckCircle2,
  Check,
  RotateCcw,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface EquipmentEditModalProps {
  item: EquipmentItem;
  onClose: () => void;
  onSave: (updatedItem: EquipmentItem) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export default function EquipmentEditModal({
  item,
  onClose,
  onSave,
  onDelete,
}: EquipmentEditModalProps) {
  const { profile } = useAuth();
  const allowedUnits = getUserAllowedUnits(profile);
  const isNewRecord = !item.id;
  const [formData, setFormData] = useState<EquipmentItem>({
    ...item,
    Unit: allowedUnits.includes(item.Unit) ? item.Unit : (allowedUnits[0] || item.Unit || 'RPTU'),
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletedSuccess, setDeletedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);

  const parsedDoc = parseEquipmentDocumentField(formData.DocumentDrawing);
  const currentProgress = calculateProgress([formData]);

  const handleChange = (field: keyof EquipmentItem, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSetAllStages = (mode: 'done' | 'pending') => {
    setFormData((prev) => {
      const next = { ...prev };
      STATUS_COLUMNS.forEach((col) => {
        (next as any)[col.key] = mode === 'done' ? col.doneValue : col.pendingValue;
      });
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.EquipmentTagNo.trim()) {
      setErrorMsg('Equipment Tag Number is required.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      await onSave(formData);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save equipment');
      setSaving(false);
    }
  };

  const handleDeleteRecord = async () => {
    if (!onDelete || !item.id) return;
    setDeleting(true);
    setErrorMsg('');
    try {
      await onDelete(item.id);
      setConfirmDelete(false);
      setDeleting(false);
      setDeletedSuccess(true);
    } catch (err: any) {
      setConfirmDelete(false);
      setErrorMsg(err.message || 'Failed to delete equipment');
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-3 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[560px] max-h-[86vh] bg-white rounded-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
        style={{
          boxShadow:
            '0 24px 48px -12px rgba(15, 23, 42, 0.42), 0 0 0 1px rgba(148, 163, 184, 0.24)',
        }}
      >
        {/* PREMIUM COMPACT EXECUTIVE HEADER */}
        <div
          className="px-4 py-3 text-white flex items-center justify-between shrink-0"
          style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
            borderBottom: '1px solid rgba(56, 189, 248, 0.28)',
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-sky-300 shrink-0"
              style={{
                background:
                  'linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(14, 165, 233, 0.12) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.2)',
              }}
            >
              {isNewRecord ? <Plus className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[13.5px] font-extrabold tracking-tight text-white truncate">
                  {isNewRecord ? 'Add Equipment' : formData.EquipmentTagNo || 'Edit Equipment'}
                </h2>
                <span
                  className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    currentProgress === 100
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                      : currentProgress > 0
                      ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                      : 'bg-slate-800 text-slate-300 border-slate-600'
                  }`}
                >
                  {currentProgress}% Complete
                </span>
              </div>
              <p className="text-[10.5px] text-sky-200/80 truncate mt-0.5">
                {formatEquipmentHierarchyPath(formData)}
                {formData.EquipmentTagNo ? ` › ${formData.EquipmentTagNo}` : ''}
                {formData.EquipmentDescription ? ` · ${formData.EquipmentDescription}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 ml-2"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* COMPACT SCROLLABLE FORM BODY */}
        <form onSubmit={handleSubmit} className="p-3.5 sm:p-4 overflow-y-auto space-y-2.5 text-xs flex-1 bg-slate-50/40">
          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* SECTION 1: EQUIPMENT IDENTIFICATION & 4-LEVEL HIERARCHY (Unit > Sub-Unit > System > Sub-System) */}
          <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-sky-600" />
                <span>Hierarchy (Unit › Sub-Unit › System › Sub-System)</span>
              </div>
              <span className="text-[9.5px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">
                Path: {formatEquipmentHierarchyPath(formData)}
                {formData.EquipmentTagNo ? ` › ${formData.EquipmentTagNo}` : ''}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Tag Number */}
              <div>
                <label className="block text-[10.5px] font-bold text-slate-700 mb-0.5">
                  Equipment Tag No. <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 1P30-RB-2221"
                  value={formData.EquipmentTagNo ?? ''}
                  onChange={(e) => handleChange('EquipmentTagNo', e.target.value)}
                  className="w-full px-2.5 py-1 text-[11.5px] font-mono font-bold rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>

              {/* Unit Dropdown */}
              <div>
                <label className="block text-[10.5px] font-bold text-slate-700 mb-0.5">
                  1. Unit <span className="text-rose-600">*</span>
                </label>
                <select
                  value={formData.Unit || allowedUnits[0] || 'RPTU'}
                  onChange={(e) => {
                    const nextUnit = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      Unit: nextUnit,
                      SubUnit:
                        nextUnit === 'UTILITY' && prev.SubUnit && UTILITY_SUB_UNITS.includes(prev.SubUnit)
                          ? prev.SubUnit
                          : nextUnit === 'MSP' && prev.SubUnit && MSP_SUB_UNITS.includes(prev.SubUnit)
                          ? prev.SubUnit
                          : '',
                    }));
                  }}
                  className="w-full px-2 py-1 text-[11.5px] font-bold rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600 cursor-pointer"
                >
                  {allowedUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* 2. Sub-Unit (Optional - skip if blank) */}
              <div>
                <label className="block text-[10.5px] font-bold text-slate-700 mb-0.5">
                  2. Sub-Unit <span className="text-[9.5px] font-normal text-slate-400">(Optional)</span>
                </label>
                {formData.Unit === 'UTILITY' ? (
                  <select
                    value={formData.SubUnit ?? ''}
                    onChange={(e) => handleChange('SubUnit', e.target.value)}
                    className="w-full px-2 py-1 text-[11.5px] font-semibold rounded-lg border border-sky-300 bg-sky-50/60 text-sky-900 focus:outline-none focus:ring-1 focus:ring-sky-600 cursor-pointer"
                  >
                    <option value="">— Skip (Direct in UTILITY) —</option>
                    {UTILITY_SUB_UNITS.map((su) => (
                      <option key={su} value={su}>
                        {su}
                      </option>
                    ))}
                  </select>
                ) : formData.Unit === 'MSP' ? (
                  <select
                    value={formData.SubUnit ?? ''}
                    onChange={(e) => handleChange('SubUnit', e.target.value)}
                    className="w-full px-2 py-1 text-[11.5px] font-semibold rounded-lg border border-emerald-300 bg-emerald-50/60 text-emerald-900 focus:outline-none focus:ring-1 focus:ring-emerald-600 cursor-pointer"
                  >
                    <option value="">— Skip (Direct in MSP) —</option>
                    {MSP_SUB_UNITS.map((su) => (
                      <option key={su} value={su}>
                        {su}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Leave blank to skip"
                    value={formData.SubUnit ?? ''}
                    onChange={(e) => handleChange('SubUnit', e.target.value)}
                    className="w-full px-2.5 py-1 text-[11.5px] rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                  />
                )}
              </div>

              {/* 3. System No. (Optional - skip if blank) */}
              <div>
                <label className="block text-[10.5px] font-bold text-slate-700 mb-0.5">
                  3. System <span className="text-[9.5px] font-normal text-slate-400">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Leave blank to skip"
                  value={formData.SystemNo ?? ''}
                  onChange={(e) => handleChange('SystemNo', e.target.value)}
                  className="w-full px-2.5 py-1 text-[11.5px] rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>

              {/* 4. Sub-System (Optional - skip if blank) */}
              <div>
                <label className="block text-[10.5px] font-bold text-slate-700 mb-0.5">
                  4. Sub-System <span className="text-[9.5px] font-normal text-slate-400">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Leave blank to skip"
                  value={formData.SubSystem ?? ''}
                  onChange={(e) => handleChange('SubSystem', e.target.value)}
                  className="w-full px-2.5 py-1 text-[11.5px] rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10.5px] font-semibold text-slate-600 mb-0.5">
                  Equipment Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. BULK ACID STORAGE TANK"
                  value={formData.EquipmentDescription ?? ''}
                  onChange={(e) => handleChange('EquipmentDescription', e.target.value)}
                  className="w-full px-2.5 py-1 text-[11.5px] rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-[10.5px] font-semibold text-slate-600 mb-0.5">
                  Equipment Type
                </label>
                <input
                  type="text"
                  placeholder="e.g. TANK / PUMP / VESSEL"
                  value={formData.EquipmentType ?? ''}
                  onChange={(e) => handleChange('EquipmentType', e.target.value)}
                  className="w-full px-2.5 py-1 text-[11.5px] rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: 6-STEP INSPECTION PIPELINE */}
          <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-1.5">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>{STATUS_COLUMNS.length} Inspection Stages</span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleSetAllStages('done')}
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Check className="w-2.5 h-2.5" />
                  <span>All Done</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {STATUS_COLUMNS.map((col) => {
                const rawVal = (formData[col.key] as string) || '';
                const val = col.options.includes(rawVal as any)
                  ? rawVal
                  : isDone(rawVal)
                  ? col.doneValue
                  : col.pendingValue;
                const stageDone = isDone(val);
                return (
                  <div
                    key={col.key}
                    className={`p-1.5 rounded-lg border transition-colors ${
                      stageDone
                        ? 'bg-emerald-50/70 border-emerald-200'
                        : 'bg-amber-50/50 border-amber-200/80'
                    }`}
                  >
                    <label
                      className="block text-[10px] font-bold text-slate-700 truncate mb-0.5"
                      title={col.label}
                    >
                      {col.short}
                    </label>
                    <select
                      value={val ?? col.pendingValue}
                      onChange={(e) => handleChange(col.key, e.target.value)}
                      className={`w-full px-1.5 py-0.5 text-[11px] font-bold rounded border cursor-pointer ${
                        stageDone
                          ? 'bg-white text-emerald-800 border-emerald-300'
                          : 'bg-white text-amber-800 border-amber-300'
                      }`}
                    >
                      {col.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SECTION 3: INSPECTION DATES, REPORTS & REMARKS */}
          <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-2">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Calendar className="w-3 h-3 text-sky-600" />
              <span>Dates, Documents &amp; Remarks</span>
            </div>

            {/* Dates row */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                  Format-I Date
                </label>
                <input
                  type="date"
                  value={formData.FormatIDate ?? ''}
                  onChange={(e) => handleChange('FormatIDate', e.target.value)}
                  className="w-full px-1.5 py-1 text-[11px] font-mono rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                  Format-II Date
                </label>
                <input
                  type="date"
                  value={formData.FormatIIDate ?? ''}
                  onChange={(e) => handleChange('FormatIIDate', e.target.value)}
                  className="w-full px-1.5 py-1 text-[11px] font-mono rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                  Format-III Date
                </label>
                <input
                  type="date"
                  value={formData.FormatIIIDate ?? ''}
                  onChange={(e) => handleChange('FormatIIIDate', e.target.value)}
                  className="w-full px-1.5 py-1 text-[11px] font-mono rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                  Format-IV Date
                </label>
                <input
                  type="date"
                  value={formData.FormatIVDate ?? ''}
                  onChange={(e) => handleChange('FormatIVDate', e.target.value)}
                  className="w-full px-1.5 py-1 text-[11px] font-mono rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                  Format-V Date
                </label>
                <input
                  type="date"
                  value={formData.FormatVDate ?? ''}
                  onChange={(e) => handleChange('FormatVDate', e.target.value)}
                  className="w-full px-1.5 py-1 text-[11px] font-mono rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                />
              </div>
            </div>

            {/* Drawing Ref. No. / Document Code */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                Drawing Ref. No. / Document Code
              </label>
              <input
                type="text"
                placeholder="e.g. DWG-RPTU-V101-01"
                value={parsedDoc.drawingRef ?? ''}
                onChange={(e) => {
                  const nextRef = e.target.value;
                  if (parsedDoc.reports.length > 0) {
                    handleChange(
                      'DocumentDrawing',
                      serializeEquipmentDocumentField(nextRef, parsedDoc.reports)
                    );
                  } else {
                    handleChange('DocumentDrawing', nextRef);
                  }
                }}
                className="w-full px-2.5 py-1 text-[11.5px] font-mono rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
              />
            </div>

            {/* Live Reports Attached Banner */}
            {!isNewRecord && (
              <div className="p-2 rounded-lg bg-gradient-to-r from-sky-50 to-indigo-50/60 border border-sky-200/90 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10.5px] font-bold text-sky-950 flex items-center gap-1">
                    <FileText className="w-3 h-3 text-sky-700" />
                    <span>Reports:</span>
                  </span>
                  {parsedDoc.reports.length === 0 ? (
                    <span className="text-[10.5px] text-slate-500">
                      No cloud reports linked yet
                    </span>
                  ) : (
                    parsedDoc.reports.slice(0, 2).map((rep) => {
                      const badge = getProviderBadgeMeta(rep.provider);
                      return (
                        <span
                          key={rep.id}
                          className="font-mono text-[9.5px] font-bold px-1.5 py-0.5 rounded border"
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderColor: badge.border,
                          }}
                        >
                          {rep.stageLabel} ({badge.shortLabel})
                        </span>
                      );
                    })
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowReportModal(true)}
                  className="px-2.5 py-1 text-[10.5px] font-bold rounded-md bg-sky-700 hover:bg-sky-800 text-white transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                >
                  <span>{parsedDoc.reports.length > 0 ? `Reports (${parsedDoc.reports.length})` : '+ Upload / Link'}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Remarks Input */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                Remarks / Field Findings
              </label>
              <input
                type="text"
                placeholder="Field inspection findings, punch points, clearance notes..."
                value={formData.Remarks || ''}
                onChange={(e) => handleChange('Remarks', e.target.value)}
                className="w-full px-2.5 py-1 text-[11.5px] rounded-lg border border-slate-300 bg-slate-50/60 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
              />
            </div>
          </div>

          {/* STICKY FOOTER ACTIONS */}
          <div className="pt-1 flex items-center justify-between gap-2 flex-wrap">
            <div>
              {!isNewRecord && onDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving || deleting}
                className="px-3 py-1.5 text-[11.5px] font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || deleting}
                className="px-4 py-1.5 text-[11.5px] font-bold text-white rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                }}
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : isNewRecord ? 'Add Record' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Embedded Live Inspection Report Modal */}
      {showReportModal && (
        <InspectionReportModal
          item={formData}
          canEdit={true}
          onClose={() => setShowReportModal(false)}
          onUpdated={(updatedEquip) => {
            setFormData(updatedEquip);
          }}
        />
      )}

      {/* Warning Confirmation for Deletion */}
      <SweetWarningDeletePopup
        open={confirmDelete}
        title="Warning: Delete Equipment Record?"
        targetType="Equipment Record"
        targetName={`${formData.EquipmentTagNo} (${formData.Unit}${
          formData.SubUnit ? ` › ${formData.SubUnit}` : ''
        })`}
        description={`Are you sure you want to permanently delete equipment "${formData.EquipmentTagNo}" from the live database?`}
        warningNote="All inspection statuses and linked report references will be removed."
        confirmLabel="Yes, Delete Equipment"
        cancelLabel="No, Cancel"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDeleteRecord}
      />

      {/* Success Popup */}
      <SweetSuccessPopup
        open={deletedSuccess}
        title="Equipment Deleted Successfully!"
        badgeText="Removed from Database"
        message={`Equipment "${formData.EquipmentTagNo}" has been permanently deleted from the live database.`}
        metaItems={[
          { label: 'Deleted Tag No.', value: formData.EquipmentTagNo, highlight: 'slate' },
          { label: 'Unit / System', value: `${formData.Unit} · ${formData.SystemNo}` },
        ]}
        confirmLabel="OK, Done"
        onClose={() => {
          setDeletedSuccess(false);
          onClose();
        }}
      />
    </div>
  );
}

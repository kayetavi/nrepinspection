'use client';

import React, { useState } from 'react';
import { EquipmentItem, STATUS_COLUMNS, STATUS_OPTIONS, isDone, isInProgress } from '@/lib/types';
import { useEquipment } from '@/lib/equipment-context';
import { useAuth } from '@/lib/auth-context';
import { ExternalLink, Check, AlertCircle, Save, Trash2, X } from 'lucide-react';

interface EquipmentDetailModalProps {
  item: EquipmentItem;
  onClose: () => void;
}

export default function EquipmentDetailModal({ item, onClose }: EquipmentDetailModalProps) {
  const { isEditor, isAdmin } = useAuth();
  const { saveEquipment, deleteEquipment } = useEquipment();
  const [formData, setFormData] = useState<EquipmentItem>({ ...item });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleChange = (field: keyof EquipmentItem, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await saveEquipment(formData);
      setMsg({ text: 'Changes saved directly to Cloud Firestore', type: 'success' });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ text: err.message || 'Save failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to permanently delete equipment ${item.EquipmentTagNo}?`)) return;
    try {
      await deleteEquipment(item.id);
      onClose();
    } catch (err: any) {
      setMsg({ text: err.message || 'Delete failed', type: 'error' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-sky-950 text-white px-6 py-4 flex items-center justify-between border-b border-sky-900 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-sky-800 text-sky-200 font-semibold">
                {formData.Unit}
              </span>
              <span className="text-xs text-sky-300">·</span>
              <span className="text-xs text-sky-300">{formData.SystemNo}</span>
            </div>
            <h2 className="text-lg font-bold tracking-tight mt-1 flex items-center gap-2">
              {formData.EquipmentTagNo}
              <span className="text-sm font-normal text-sky-200">
                — {formData.EquipmentDescription || 'No description'}
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-sky-300 hover:text-white hover:bg-sky-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action feedback */}
        {msg && (
          <div
            className={`px-6 py-2.5 text-xs flex items-center gap-2 border-b ${
              msg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {msg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {msg.text}
          </div>
        )}

        {/* Body Form */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Milestone Pipeline Stepper */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Inspection Milestone Pipeline
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {STATUS_COLUMNS.map((col) => {
                const val = (formData[col.key] as string) || '';
                const done = isDone(val);
                const prog = isInProgress(val);
                return (
                  <div
                    key={col.key}
                    className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                      done
                        ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900'
                        : prog
                        ? 'border-amber-200 bg-amber-50/50 text-amber-900'
                        : 'border-slate-200 bg-slate-50/80 text-slate-600'
                    }`}
                  >
                    <span className="font-medium text-[11px] text-slate-500">{col.short}</span>
                    {isEditor ? (
                      <select
                        value={val}
                        onChange={(e) => handleChange(col.key, e.target.value)}
                        className="mt-1.5 text-xs bg-white border border-slate-200 rounded px-1.5 py-1 focus:ring-1 focus:ring-sky-600"
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt || 'Select...'}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="mt-1.5 font-semibold text-xs">{val || 'Not Started'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Core Specifications */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-slate-500 font-medium mb-1">Equipment Tag No.</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.EquipmentTagNo}
                onChange={(e) => handleChange('EquipmentTagNo', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Equipment Type</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.EquipmentType || ''}
                onChange={(e) => handleChange('EquipmentType', e.target.value)}
                placeholder="e.g. Tank, Vessel, Pump, Motor"
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Unit / Package</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.Unit}
                onChange={(e) => handleChange('Unit', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-slate-500 font-medium mb-1">System No. & Details</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.SystemNo}
                onChange={(e) => handleChange('SystemNo', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Area / Package</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.AreaPackage || ''}
                onChange={(e) => handleChange('AreaPackage', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">RFI No.</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.RFINo || ''}
                onChange={(e) => handleChange('RFINo', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-slate-500 font-medium mb-1">Format-I Clearance Date</label>
              <input
                type="date"
                disabled={!isEditor}
                value={formData.FormatIDate || ''}
                onChange={(e) => handleChange('FormatIDate', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Format-II Clearance Date</label>
              <input
                type="date"
                disabled={!isEditor}
                value={formData.FormatIIDate || ''}
                onChange={(e) => handleChange('FormatIIDate', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Format-III Clearance Date</label>
              <input
                type="date"
                disabled={!isEditor}
                value={formData.FormatIIIDate || ''}
                onChange={(e) => handleChange('FormatIIIDate', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs bg-white disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-slate-500 font-medium mb-1">Punch Points Category Closed</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.PunchPointsCategoryClosed || ''}
                onChange={(e) => handleChange('PunchPointsCategoryClosed', e.target.value)}
                placeholder="e.g. A, B, or All Closed"
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Last Inspection Date</label>
              <input
                type="date"
                disabled={!isEditor}
                value={formData.LastInspectionDate || ''}
                onChange={(e) => handleChange('LastInspectionDate', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Responsible Agency / Vendor</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.ResponsibleAgency || ''}
                onChange={(e) => handleChange('ResponsibleAgency', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>
          </div>

          {/* Description & Remarks */}
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-500 font-medium mb-1">Equipment Description</label>
              <input
                type="text"
                disabled={!isEditor}
                value={formData.EquipmentDescription || ''}
                onChange={(e) => handleChange('EquipmentDescription', e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Engineer Remarks & Punch Notes</label>
              <textarea
                rows={2}
                disabled={!isEditor}
                value={formData.Remarks || ''}
                onChange={(e) => handleChange('Remarks', e.target.value)}
                placeholder="Enter field observations, hydrotest records, punch point remarks..."
                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-slate-500 font-medium mb-1">Document Link / URL</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  disabled={!isEditor}
                  value={formData.Link || ''}
                  onChange={(e) => handleChange('Link', e.target.value)}
                  placeholder="https://..."
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs bg-white disabled:bg-slate-50"
                />
                {formData.Link && (
                  <a
                    href={formData.Link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-50 text-sky-800 hover:bg-sky-100 font-medium"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Link
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer controls */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div>
            {isAdmin && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-rose-700 hover:bg-rose-100 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Equipment
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-medium"
            >
              Cancel
            </button>
            {isEditor && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-900 text-white hover:bg-sky-800 text-xs font-medium transition-colors shadow-xs disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save to Cloud'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import {
  EquipmentItem,
  UNITS,
  UTILITY_SUB_UNITS,
  STATUS_COLUMNS,
  isDone,
  calculateProgress,
} from '@/lib/types';

interface EquipmentEditModalProps {
  item: EquipmentItem;
  onClose: () => void;
  onSave: (updatedItem: EquipmentItem) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export default function EquipmentEditModal({ item, onClose, onSave, onDelete }: EquipmentEditModalProps) {
  const isNewRecord = !item.id;
  const [formData, setFormData] = useState<EquipmentItem>({ ...item });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete equipment');
      setDeleting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
          width: '100%',
          maxWidth: '840px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #cbd5e1',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: '#ffffff',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>{isNewRecord ? '➕' : '✏️'}</span>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
                {isNewRecord ? 'Add New Equipment Record' : `Edit Equipment: ${item.EquipmentTagNo}`}
              </h2>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
              {isNewRecord
                ? 'Create a new equipment record directly in the live Cloud Firestore database'
                : `${item.Unit} · ${item.SystemNo} · ${item.EquipmentDescription || 'No description'}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: '#e2e8f0',
              borderRadius: '6px',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              lineHeight: 1,
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {errorMsg && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '10px 14px',
                borderRadius: '6px',
                fontSize: '13px',
              }}
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Section 1: General Info */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '10px' }}>
              Equipment Identification
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Tag Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 1U59-TT-8631"
                  value={formData.EquipmentTagNo}
                  onChange={(e) => handleChange('EquipmentTagNo', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Equipment Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. BULK ACID STORAGE TANK"
                  value={formData.EquipmentDescription || ''}
                  onChange={(e) => handleChange('EquipmentDescription', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Equipment Type
                </label>
                <input
                  type="text"
                  placeholder="e.g. TANK / PUMP / VESSEL"
                  value={formData.EquipmentType || ''}
                  onChange={(e) => handleChange('EquipmentType', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Unit *
                </label>
                <select
                  value={formData.Unit || 'RPTU'}
                  onChange={(e) => {
                    const nextUnit = e.target.value;
                    if (nextUnit === 'UTILITY') {
                      const defaultSub = formData.SubUnit && UTILITY_SUB_UNITS.includes(formData.SubUnit)
                        ? formData.SubUnit
                        : UTILITY_SUB_UNITS[0];
                      setFormData((prev) => ({
                        ...prev,
                        Unit: 'UTILITY',
                        SubUnit: defaultSub,
                        SystemNo: defaultSub,
                      }));
                    } else {
                      setFormData((prev) => ({
                        ...prev,
                        Unit: nextUnit,
                        SubUnit: '',
                        SystemNo: prev.Unit === 'UTILITY' ? `${nextUnit} Main System` : prev.SystemNo || `${nextUnit} Main System`,
                      }));
                    }
                  }}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box', background: '#ffffff', fontWeight: 600 }}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              {formData.Unit === 'UTILITY' && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#0369a1', marginBottom: '4px' }}>
                    Sub-Unit (Under UTILITY) *
                  </label>
                  <select
                    value={formData.SubUnit || UTILITY_SUB_UNITS[0]}
                    onChange={(e) => {
                      const sub = e.target.value;
                      setFormData((prev) => ({
                        ...prev,
                        SubUnit: sub,
                        SystemNo: sub,
                      }));
                    }}
                    style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #0284c7', borderRadius: '6px', boxSizing: 'border-box', background: '#f0f9ff', color: '#0c4a6e', fontWeight: 700 }}
                  >
                    {UTILITY_SUB_UNITS.map((su) => (
                      <option key={su} value={su}>
                        {su}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  {formData.Unit === 'UTILITY' ? 'System / Package Detail' : 'System No.'}
                </label>
                <input
                  type="text"
                  placeholder={formData.Unit === 'UTILITY' ? 'e.g. DM-CPU' : 'e.g. RPTU-SYS-01'}
                  value={formData.SystemNo || ''}
                  onChange={(e) => handleChange('SystemNo', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>

          {/* Section 2: 6-Step Inspection Pipeline (including Base Line UTG) */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a' }}>
                  Inspection Stages (6-Step Pipeline · Includes Base Line UTG)
                </div>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: calculateProgress([formData]) === 100 ? '#dcfce7' : '#e0f2fe',
                    color: calculateProgress([formData]) === 100 ? '#15803d' : '#0369a1',
                    border: calculateProgress([formData]) === 100 ? '1px solid #86efac' : '1px solid #7dd3fc',
                  }}
                >
                  Progress: {calculateProgress([formData])}%
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => handleSetAllStages('done')}
                  style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #86efac', background: '#dcfce7', color: '#15803d', cursor: 'pointer', fontWeight: 600 }}
                >
                  ✓ Mark All Done (100%)
                </button>
                <button
                  type="button"
                  onClick={() => handleSetAllStages('pending')}
                  style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f1f5f9', color: '#475569', cursor: 'pointer' }}
                >
                  Reset All Pending (0%)
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              {STATUS_COLUMNS.map((col) => {
                const rawVal = (formData[col.key] as string) || '';
                const val = col.options.includes(rawVal as any)
                  ? rawVal
                  : isDone(rawVal)
                  ? col.doneValue
                  : col.pendingValue;
                const stageDone = isDone(val);
                return (
                  <div key={col.key} style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={col.label}>
                      {col.short} ({col.label})
                    </label>
                    <select
                      value={val}
                      onChange={(e) => handleChange(col.key, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        fontSize: '12px',
                        borderRadius: '4px',
                        border: stageDone ? '1px solid #86efac' : '1px solid #fcd34d',
                        background: stageDone ? '#f0fdf4' : '#fffbeb',
                        fontWeight: 700,
                        color: stageDone ? '#15803d' : '#b45309',
                      }}
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

          {/* Section 3: Dates, Document/Drawing & Remarks */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '10px' }}>
              Inspection Dates, Document/Drawing &amp; Punch Points
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Format-I Date
                </label>
                <input
                  type="date"
                  value={formData.FormatIDate || ''}
                  onChange={(e) => handleChange('FormatIDate', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Format-II Date
                </label>
                <input
                  type="date"
                  value={formData.FormatIIDate || ''}
                  onChange={(e) => handleChange('FormatIIDate', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Format-III Date
                </label>
                <input
                  type="date"
                  value={formData.FormatIIIDate || ''}
                  onChange={(e) => handleChange('FormatIIIDate', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Punch Points Category Closed
                </label>
                <input
                  type="text"
                  placeholder="e.g. Cat-A closed, Cat-B pending"
                  value={formData.PunchPointsCategoryClosed || ''}
                  onChange={(e) => handleChange('PunchPointsCategoryClosed', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Document/Drawing (No. or URL)
                </label>
                <input
                  type="text"
                  placeholder="e.g. DWG-RPTU-V101-01 or https://..."
                  value={formData.DocumentDrawing || ''}
                  onChange={(e) => handleChange('DocumentDrawing', e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ marginTop: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Remarks / Notes
              </label>
              <textarea
                rows={2}
                placeholder="Field inspection findings, punch points, clearance notes..."
                value={formData.Remarks || ''}
                onChange={(e) => handleChange('Remarks', e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Modal Actions */}
          <div
            style={{
              paddingTop: '16px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              {!isNewRecord && onDelete && (
                confirmDelete ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#dc2626' }}>Delete this record?</span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={handleDeleteRecord}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#ffffff',
                        background: '#dc2626',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer',
                      }}
                    >
                      {deleting ? 'Deleting...' : 'Yes, Delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      style={{
                        padding: '6px 10px',
                        fontSize: '12px',
                        color: '#475569',
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '5px',
                        cursor: 'pointer',
                      }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    style={{
                      padding: '8px 14px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      color: '#dc2626',
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    🗑️ Delete Equipment
                  </button>
                )
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={saving || deleting}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#475569',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || deleting}
                style={{
                  padding: '8px 20px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#ffffff',
                  background: '#0284c7',
                  border: '1px solid #0284c7',
                  borderRadius: '6px',
                  cursor: saving ? 'wait' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {saving ? 'Saving...' : isNewRecord ? '➕ Add to Database' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

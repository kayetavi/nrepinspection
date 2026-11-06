'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  AlertTriangle,
  CloudUpload,
  Trash2,
  X,
  Sparkles,
  FileCheck2,
  HardDrive,
  ShieldAlert,
  Loader2,
} from 'lucide-react';

export interface SweetSuccessMetaItem {
  label: string;
  value: string;
  highlight?: 'green' | 'blue' | 'amber' | 'slate';
}

export interface SweetSuccessPopupProps {
  open: boolean;
  title: string;
  message: string;
  subtitle?: string;
  badgeText?: string;
  metaItems?: SweetSuccessMetaItem[];
  confirmLabel?: string;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
  onClose: () => void;
}

export interface SweetWarningDeletePopupProps {
  open: boolean;
  title?: string;
  targetName: string;
  targetType?: string;
  description: string;
  warningNote?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  requireConfirmText?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export interface UploadProgressPopupProps {
  open: boolean;
  title?: string;
  fileName?: string;
  equipmentTag?: string;
  stageLabel?: string;
  destinationLabel?: string;
  currentStepIndex?: number; // optional manual override (0, 1, 2)
  batchCurrent?: number;
  batchTotal?: number;
}

/**
 * 1. Real-Time Animated Upload Progress Modal Overlay
 */
export function UploadProgressPopup({
  open,
  title = 'Uploading & Synchronizing Live Report...',
  fileName,
  equipmentTag,
  stageLabel,
  destinationLabel = 'Central Google Drive & Live Database',
  currentStepIndex,
  batchCurrent,
  batchTotal,
}: UploadProgressPopupProps) {
  const [simulatedPct, setSimulatedPct] = useState(14);
  const [autoStep, setAutoStep] = useState(0);

  useEffect(() => {
    if (!open) {
      const resetTimer = setTimeout(() => {
        setSimulatedPct(14);
        setAutoStep(0);
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    const pctTimer = setInterval(() => {
      setSimulatedPct((prev) => {
        if (prev >= 94) return 94;
        const step = prev < 50 ? 9 : prev < 78 ? 5 : 2;
        return Math.min(94, prev + step);
      });
    }, 320);

    const stepTimer1 = setTimeout(() => setAutoStep(1), 650);
    const stepTimer2 = setTimeout(() => setAutoStep(2), 1600);

    return () => {
      clearInterval(pctTimer);
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
    };
  }, [open, batchCurrent]);

  const activeStep = typeof currentStepIndex === 'number' ? currentStepIndex : autoStep;
  const displayPct =
    batchTotal && batchTotal > 1 && typeof batchCurrent === 'number'
      ? Math.min(96, Math.max(12, Math.round(((batchCurrent - 0.25) / batchTotal) * 100)))
      : simulatedPct;

  const steps = [
    'Reading & validating inspection report file...',
    `Uploading directly to ${destinationLabel}...`,
    'Linking report to Equipment Tag & updating live stage progress...',
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 26000,
            backgroundColor: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.86, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 12 }}
            transition={{ type: 'spring', stiffness: 340, damping: 26 }}
            style={{
              width: '100%',
              maxWidth: '460px',
              background: '#ffffff',
              borderRadius: '18px',
              border: '1px solid #cbd5e1',
              boxShadow: '0 25px 60px -12px rgba(2, 132, 199, 0.35)',
              overflow: 'hidden',
              padding: '26px 24px 22px',
              textAlign: 'center',
              position: 'relative',
            }}
          >
            {/* Top gradient accent bar */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '5px',
                background: 'linear-gradient(90deg, #0284c7 0%, #10b981 50%, #3b82f6 100%)',
              }}
            />

            {/* Animated Cloud Upload Orb */}
            <div
              style={{
                position: 'relative',
                width: '84px',
                height: '84px',
                margin: '4px auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <motion.div
                animate={{ scale: [1, 1.22, 1], opacity: [0.35, 0.12, 0.35] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '999px',
                  background: 'radial-gradient(circle, #38bdf8 0%, #0284c7 100%)',
                }}
              />
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
                style={{
                  position: 'absolute',
                  inset: '4px',
                  borderRadius: '999px',
                  border: '3px dashed #0284c7',
                  borderTopColor: '#10b981',
                }}
              />
              <motion.div
                animate={{ y: [-3, 3, -3] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '999px',
                  background: 'linear-gradient(135deg, #0284c7 0%, #059669 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  boxShadow: '0 10px 20px -5px rgba(2, 132, 199, 0.5)',
                }}
              >
                <CloudUpload size={30} />
              </motion.div>
            </div>

            {/* Batch Counter Badge if Multi-file */}
            {batchTotal && batchTotal > 1 && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 12px',
                  borderRadius: '999px',
                  background: '#e0f2fe',
                  color: '#0369a1',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  marginBottom: '8px',
                  border: '1px solid #bae6fd',
                }}
              >
                <span>
                  Uploading File {batchCurrent || 1} of {batchTotal}
                </span>
              </div>
            )}

            <h3
              style={{
                margin: '0 0 6px',
                fontSize: '18px',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.01em',
              }}
            >
              {title}
            </h3>

            {(equipmentTag || stageLabel || fileName) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  flexWrap: 'wrap',
                  marginBottom: '14px',
                }}
              >
                {equipmentTag && (
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 800,
                      padding: '3px 9px',
                      borderRadius: '6px',
                      background: '#0f172a',
                      color: '#ffffff',
                    }}
                  >
                    Tag: {equipmentTag}
                  </span>
                )}
                {stageLabel && (
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: '6px',
                      background: '#ecfdf5',
                      color: '#047857',
                      border: '1px solid #a7f3d0',
                    }}
                  >
                    {stageLabel}
                  </span>
                )}
                {fileName && (
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: '6px',
                      background: '#f1f5f9',
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      maxWidth: '280px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    📄 {fileName}
                  </span>
                )}
              </div>
            )}

            {/* Animated Progress Bar */}
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: '#0284c7',
                  marginBottom: '5px',
                }}
              >
                <span>Live Cloud Sync in Progress...</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{displayPct}%</span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: '10px',
                  background: '#e2e8f0',
                  borderRadius: '999px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <motion.div
                  initial={{ width: '10%' }}
                  animate={{ width: `${displayPct}%` }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  style={{
                    height: '100%',
                    borderRadius: '999px',
                    background: 'linear-gradient(90deg, #0284c7 0%, #10b981 100%)',
                  }}
                />
              </div>
            </div>

            {/* Live Step-by-Step Checklist */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '10px 12px',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '7px',
              }}
            >
              {steps.map((stepText, idx) => {
                const isDone = idx < activeStep;
                const isCurrent = idx === activeStep;
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      fontWeight: isCurrent ? 700 : 600,
                      color: isDone ? '#15803d' : isCurrent ? '#0284c7' : '#94a3b8',
                    }}
                  >
                    {isDone ? (
                      <CheckCircle2 size={15} color="#16a34a" style={{ flexShrink: 0 }} />
                    ) : isCurrent ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        style={{ display: 'flex', flexShrink: 0 }}
                      >
                        <Loader2 size={15} color="#0284c7" />
                      </motion.div>
                    ) : (
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '999px',
                          border: '1.5px solid #cbd5e1',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span>{stepText}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * 2. SweetAlert-Style ("Swit") Animated Success Popup Window
 */
export function SweetSuccessPopup({
  open,
  title,
  message,
  subtitle,
  badgeText,
  metaItems = [],
  confirmLabel = 'OK, Done!',
  secondaryLabel,
  onSecondaryAction,
  onClose,
}: SweetSuccessPopupProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 27000,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.72, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 15 }}
            transition={{ type: 'spring', stiffness: 360, damping: 24 }}
            style={{
              width: '100%',
              maxWidth: '450px',
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid #d1fae5',
              boxShadow: '0 25px 65px -12px rgba(16, 185, 129, 0.38)',
              padding: '28px 24px 22px',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Top Emerald Celebration Ribbon */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '6px',
                background: 'linear-gradient(90deg, #10b981 0%, #059669 50%, #0284c7 100%)',
              }}
            />

            {/* Close Corner Button */}
            <button
              type="button"
              onClick={onClose}
              style={{
                position: 'absolute',
                top: '14px',
                right: '14px',
                width: '30px',
                height: '30px',
                borderRadius: '999px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="Close"
            >
              <X size={15} />
            </button>

            {/* SweetAlert2-style Animated Checkmark Circle */}
            <div
              style={{
                position: 'relative',
                width: '86px',
                height: '86px',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: [1, 1.25, 1.1], opacity: [0.5, 0.15, 0] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '999px',
                  background: '#10b981',
                }}
              />
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18, delay: 0.05 }}
                style={{
                  width: '74px',
                  height: '74px',
                  borderRadius: '999px',
                  background: 'linear-gradient(135deg, #dcfce7 0%, #a7f3d0 100%)',
                  border: '3px solid #10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 10px 25px -5px rgba(16, 185, 129, 0.45)',
                }}
              >
                <motion.div
                  initial={{ scale: 0, rotate: -25 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 16, delay: 0.14 }}
                >
                  <CheckCircle2 size={42} color="#059669" strokeWidth={2.5} />
                </motion.div>
              </motion.div>
            </div>

            {badgeText && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 12px',
                  borderRadius: '999px',
                  background: '#ecfdf5',
                  border: '1px solid #6ee7b7',
                  color: '#047857',
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '8px',
                }}
              >
                <Sparkles size={12} />
                <span>{badgeText}</span>
              </div>
            )}

            <h3
              style={{
                margin: '0 0 6px',
                fontSize: '20px',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
              }}
            >
              {title}
            </h3>

            <p
              style={{
                margin: '0 0 12px',
                fontSize: '13.5px',
                color: '#334155',
                lineHeight: 1.5,
                fontWeight: 500,
              }}
            >
              {message}
            </p>

            {subtitle && (
              <p
                style={{
                  margin: '0 0 14px',
                  fontSize: '12px',
                  color: '#64748b',
                  lineHeight: 1.4,
                }}
              >
                {subtitle}
              </p>
            )}

            {/* Metadata Details Box */}
            {metaItems.length > 0 && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  marginBottom: '18px',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                {metaItems.map((item, idx) => {
                  const colorMap = {
                    green: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
                    blue: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
                    amber: { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
                    slate: { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1' },
                  };
                  const badgeStyle = item.highlight ? colorMap[item.highlight] : null;

                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        fontSize: '12px',
                      }}
                    >
                      <span style={{ color: '#64748b', fontWeight: 600 }}>{item.label}:</span>
                      {badgeStyle ? (
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '6px',
                            background: badgeStyle.bg,
                            color: badgeStyle.text,
                            border: `1px solid ${badgeStyle.border}`,
                            fontWeight: 800,
                            fontSize: '11.5px',
                          }}
                        >
                          {item.value}
                        </span>
                      ) : (
                        <span
                          style={{
                            color: '#0f172a',
                            fontWeight: 700,
                            wordBreak: 'break-word',
                            textAlign: 'right',
                          }}
                        >
                          {item.value}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Action Buttons */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                marginTop: '4px',
              }}
            >
              {secondaryLabel && onSecondaryAction && (
                <button
                  type="button"
                  onClick={onSecondaryAction}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#0f172a',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {secondaryLabel}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: '11px 22px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 6px 16px -3px rgba(5, 150, 105, 0.45)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <CheckCircle2 size={17} />
                <span>{confirmLabel}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * 3. SweetAlert-Style ("Swit") Warning Delete Confirmation Popup Window
 */
export function SweetWarningDeletePopup({
  open,
  title = 'Warning: Confirm Delete?',
  targetName,
  targetType = 'Record',
  description,
  warningNote = 'This action cannot be undone once confirmed.',
  confirmLabel = 'Yes, Delete Now',
  cancelLabel = 'Cancel, Keep It',
  requireConfirmText,
  loading = false,
  onConfirm,
  onCancel,
}: SweetWarningDeletePopupProps) {
  const [typedText, setTypedText] = useState('');

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setTypedText(''), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const isConfirmDisabled =
    loading ||
    Boolean(requireConfirmText && typedText.trim() !== requireConfirmText);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 27500,
            backgroundColor: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !loading) onCancel();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.76, y: 22 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 12 }}
            transition={{ type: 'spring', stiffness: 360, damping: 24 }}
            style={{
              width: '100%',
              maxWidth: '450px',
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid #fecaca',
              boxShadow: '0 25px 65px -12px rgba(220, 38, 38, 0.38)',
              padding: '28px 24px 22px',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Top Crimson/Amber Warning Ribbon */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '6px',
                background: 'linear-gradient(90deg, #dc2626 0%, #f59e0b 50%, #dc2626 100%)',
              }}
            />

            {/* Close Corner Button */}
            {!loading && (
              <button
                type="button"
                onClick={onCancel}
                style={{
                  position: 'absolute',
                  top: '14px',
                  right: '14px',
                  width: '30px',
                  height: '30px',
                  borderRadius: '999px',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title="Cancel"
              >
                <X size={15} />
              </button>
            )}

            {/* Animated Pulsing Warning Shield / Triangle */}
            <div
              style={{
                position: 'relative',
                width: '84px',
                height: '84px',
                margin: '0 auto 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <motion.div
                animate={{ scale: [1, 1.22, 1], opacity: [0.35, 0.1, 0.35] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '999px',
                  background: '#ef4444',
                }}
              />
              <motion.div
                initial={{ rotate: -10, scale: 0.8 }}
                animate={{ rotate: [0, -6, 6, -3, 3, 0], scale: 1 }}
                transition={{ duration: 0.55 }}
                style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '999px',
                  background: 'linear-gradient(135deg, #fee2e2 0%, #fef3c7 100%)',
                  border: '3px solid #dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 10px 25px -5px rgba(220, 38, 38, 0.35)',
                }}
              >
                <AlertTriangle size={38} color="#dc2626" strokeWidth={2.4} />
              </motion.div>
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 11px',
                borderRadius: '999px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '11px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: '8px',
              }}
            >
              <ShieldAlert size={12} />
              <span>Delete Warning · {targetType}</span>
            </div>

            <h3
              style={{
                margin: '0 0 8px',
                fontSize: '19.5px',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
              }}
            >
              {title}
            </h3>

            {/* Target Item Highlight Box */}
            <div
              style={{
                margin: '0 auto 12px',
                padding: '9px 14px',
                borderRadius: '10px',
                background: '#fff1f2',
                border: '1.5px solid #fda4af',
                color: '#9f1239',
                fontSize: '13.5px',
                fontWeight: 800,
                wordBreak: 'break-word',
              }}
            >
              {targetName}
            </div>

            <p
              style={{
                margin: '0 0 12px',
                fontSize: '13px',
                color: '#334155',
                lineHeight: 1.5,
                fontWeight: 500,
              }}
            >
              {description}
            </p>

            {warningNote && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  color: '#92400e',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  marginBottom: requireConfirmText ? '12px' : '18px',
                }}
              >
                ⚠️ {warningNote}
              </div>
            )}

            {requireConfirmText && (
              <div style={{ marginBottom: '16px', textAlign: 'left' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#991b1b',
                    marginBottom: '6px',
                  }}
                >
                  Type <code style={{ background: '#fee2e2', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>{requireConfirmText}</code> below to confirm:
                </label>
                <input
                  type="text"
                  value={typedText}
                  onChange={(e) => setTypedText(e.target.value)}
                  placeholder={`Type ${requireConfirmText} to unlock delete`}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: typedText.trim() === requireConfirmText ? '2px solid #16a34a' : '1.5px solid #fca5a5',
                    fontSize: '13px',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
            )}

            {/* Cancel + Confirm Delete Buttons */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <button
                type="button"
                disabled={loading}
                onClick={onCancel}
                style={{
                  flex: 1,
                  padding: '11px 16px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#334155',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {cancelLabel}
              </button>

              <button
                type="button"
                disabled={isConfirmDisabled}
                onClick={onConfirm}
                style={{
                  flex: 1.2,
                  padding: '11px 18px',
                  borderRadius: '10px',
                  border: 'none',
                  background: isConfirmDisabled
                    ? '#cbd5e1'
                    : 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                  color: isConfirmDisabled ? '#64748b' : '#ffffff',
                  fontSize: '13.5px',
                  fontWeight: 800,
                  cursor: loading ? 'wait' : isConfirmDisabled ? 'not-allowed' : 'pointer',
                  boxShadow: isConfirmDisabled ? 'none' : '0 6px 16px -3px rgba(220, 38, 38, 0.45)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                {loading ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                      style={{ display: 'flex' }}
                    >
                      <Loader2 size={16} />
                    </motion.div>
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    <span>{confirmLabel}</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

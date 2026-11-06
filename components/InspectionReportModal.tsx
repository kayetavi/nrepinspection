'use client';

import React, { useState, useMemo } from 'react';
import {
  EquipmentItem,
  InspectionReportAttachment,
  ReportStageKey,
  STATUS_COLUMNS,
  isDone,
  calculateProgress,
  formatEquipmentHierarchyPath,
} from '@/lib/types';
import {
  REPORT_STAGE_OPTIONS,
  parseEquipmentDocumentField,
  getProviderBadgeMeta,
  getStageLabel,
} from '@/lib/reportUtils';
import { buildAuthHeaders } from '@/lib/auth-context';
import {
  UploadProgressPopup,
  SweetSuccessPopup,
  SweetWarningDeletePopup,
  SweetSuccessMetaItem,
} from './SweetPopupModal';
import {
  FileText,
  ExternalLink,
  Upload,
  Link2,
  Trash2,
  CheckCircle2,
  FolderSync,
  Eye,
  Download,
  X,
} from 'lucide-react';

interface InspectionReportModalProps {
  item: EquipmentItem;
  canEdit: boolean;
  initialTab?: 'view' | 'attach';
  viewOnly?: boolean;
  onClose: () => void;
  onUpdated: (updatedEquipment: EquipmentItem) => void;
  onOpenCloudSync?: () => void;
}

export default function InspectionReportModal({
  item,
  canEdit,
  initialTab,
  viewOnly = false,
  onClose,
  onUpdated,
  onOpenCloudSync,
}: InspectionReportModalProps) {
  const effectiveCanEdit = canEdit && !viewOnly;
  const [currentItem, setCurrentItem] = useState<EquipmentItem>(item);
  const parsedDoc = useMemo(
    () => parseEquipmentDocumentField(currentItem.DocumentDrawing),
    [currentItem.DocumentDrawing]
  );

  const [activeTab, setActiveTab] = useState<'view' | 'attach'>(
    viewOnly
      ? 'view'
      : initialTab || (parsedDoc.reports.length > 0 ? 'view' : effectiveCanEdit ? 'attach' : 'view')
  );
  const [selectedReportId, setSelectedReportId] = useState<string>(
    parsedDoc.reports[0]?.id || ''
  );

  // Upload / Attach form states — default to direct file_upload so engineers don't need Drive/OneDrive accounts
  const [attachMode, setAttachMode] = useState<'file_upload' | 'cloud_link'>('file_upload');
  const [stage, setStage] = useState<ReportStageKey>('FormatIStatus');
  const [reportTitle, setReportTitle] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [drawingRef, setDrawingRef] = useState(parsedDoc.drawingRef || '');
  const [autoCompleteStage, setAutoCompleteStage] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [failedDirectImageIds, setFailedDirectImageIds] = useState<Set<string>>(() => new Set());
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [driveBridgeInfo, setDriveBridgeInfo] = useState<{
    activeProvider?: 'google_drive' | 'onedrive' | 'both' | 'supabase_storage';
    enabled: boolean;
    targetFolderUrl?: string;
    organizeByUnitSubfolder?: boolean;
    onedriveEnabled?: boolean;
    onedriveTargetFolderUrl?: string;
    onedriveFolderPath?: string;
    onedriveOrganizeByUnitSubfolder?: boolean;
  } | null>(null);

  // SweetAlert-style Popup states for Upload Success & Delete Warning/Success
  const [sweetSuccess, setSweetSuccess] = useState<{
    title: string;
    message: string;
    subtitle?: string;
    badgeText?: string;
    metaItems?: SweetSuccessMetaItem[];
  } | null>(null);
  const [reportPendingDelete, setReportPendingDelete] =
    useState<InspectionReportAttachment | null>(null);

  React.useEffect(() => {
    let active = true;
    fetch('/api/drive-bridge', {
      method: 'GET',
      headers: buildAuthHeaders(),
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        if (active && data?.ok && data.config) {
          setDriveBridgeInfo({
            activeProvider: data.config.activeProvider,
            enabled: Boolean(data.config.enabled),
            targetFolderUrl: data.config.targetFolderUrl,
            organizeByUnitSubfolder: data.config.organizeByUnitSubfolder,
            onedriveEnabled: Boolean(data.config.onedriveEnabled),
            onedriveTargetFolderUrl: data.config.onedriveTargetFolderUrl,
            onedriveFolderPath: data.config.onedriveFolderPath,
            onedriveOrganizeByUnitSubfolder: data.config.onedriveOrganizeByUnitSubfolder,
          });
        }
      })
      .catch(() => {});

    // Automatically check if any attached Google Drive / Cloud report was deleted in Drive
    if (parseEquipmentDocumentField(item.DocumentDrawing).reports.length > 0) {
      fetch('/api/reports/reconcile', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ equipmentId: item.id }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (active && res?.ok && res.removedCount > 0 && Array.isArray(res.updatedEquipment)) {
            const updatedEq = res.updatedEquipment.find((u: EquipmentItem) => u.id === item.id);
            if (updatedEq) {
              setCurrentItem(updatedEq);
              onUpdated(updatedEq);
              setStatusMsg({
                type: 'ok',
                text: `Synced with Google Drive: Automatically removed ${res.removedCount} report(s) that were deleted in Drive.`,
              });
            }
          }
        })
        .catch(() => {});
    }

    return () => {
      active = false;
    };
  }, [item.id]);

  const selectedReport: InspectionReportAttachment | null = useMemo(() => {
    if (parsedDoc.reports.length === 0) return null;
    return (
      parsedDoc.reports.find((r) => r.id === selectedReportId) || parsedDoc.reports[0]
    );
  }, [parsedDoc.reports, selectedReportId]);

  const handleAttachSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);

    if (attachMode === 'cloud_link' && !cloudUrl.trim()) {
      setStatusMsg({
        type: 'err',
        text: 'Please paste a Google Drive, OneDrive, or Cloud Report share link.',
      });
      return;
    }

    if (attachMode === 'file_upload' && !selectedFile) {
      setStatusMsg({
        type: 'err',
        text: 'Please select a PDF or Image inspection report file to upload.',
      });
      return;
    }

    setSubmitting(true);
    try {
      let res: Response;
      if (attachMode === 'file_upload' && selectedFile) {
        const fd = new FormData();
        fd.append('equipmentId', currentItem.id);
        fd.append('stage', stage);
        fd.append('title', reportTitle.trim() || selectedFile.name);
        fd.append('autoCompleteStage', String(autoCompleteStage));
        fd.append('drawingRef', drawingRef.trim());
        fd.append('file', selectedFile);

        res = await fetch('/api/reports', {
          method: 'POST',
          headers: buildAuthHeaders(),
          body: fd,
        });
      } else {
        res = await fetch('/api/reports', {
          method: 'POST',
          headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            equipmentId: currentItem.id,
            stage,
            title: reportTitle.trim(),
            url: cloudUrl.trim(),
            autoCompleteStage,
            drawingRef: drawingRef.trim(),
          }),
        });
      }

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to attach inspection report');
      }

      const updatedEquip: EquipmentItem = json.equipment;
      setCurrentItem(updatedEquip);
      onUpdated(updatedEquip);

      if (json.attachment?.id) {
        setSelectedReportId(json.attachment.id);
      }
      const uploadedTitle =
        json.attachment?.title || reportTitle.trim() || selectedFile?.name || 'Inspection Report';
      const uploadedStageLabel = getStageLabel(stage);
      const isBoth = json.storageDestination === 'both';
      const isOneDrive = json.storageDestination === 'onedrive';
      const isGoogleDrive = json.storageDestination === 'google_drive';

      setCloudUrl('');
      setReportTitle('');
      setSelectedFile(null);
      const destLabel = isBoth
        ? 'Uploaded directly to BOTH Google Drive & Microsoft OneDrive & linked live!'
        : isOneDrive
        ? 'Uploaded directly to Central Microsoft OneDrive Folder & linked live!'
        : isGoogleDrive
        ? 'Uploaded directly to Central Google Drive Folder & linked live!'
        : 'Live inspection report uploaded and synchronized!';
      setStatusMsg({
        type: 'ok',
        text: json.driveBridgeWarning
          ? `${destLabel} (Note: ${json.driveBridgeWarning})`
          : destLabel,
      });
      setSweetSuccess({
        title: 'Report Uploaded Successfully!',
        badgeText: isBoth
          ? 'Saved to Google Drive + OneDrive'
          : isOneDrive
          ? 'Saved to Microsoft OneDrive'
          : isGoogleDrive
          ? 'Saved to Google Drive'
          : 'Live Cloud Synced',
        message: isBoth
          ? `Your report "${uploadedTitle}" has been uploaded simultaneously to both Google Drive and Microsoft OneDrive and linked live to ${currentItem.EquipmentTagNo}.`
          : isOneDrive
          ? `Your report "${uploadedTitle}" has been uploaded directly to the Central Microsoft OneDrive Folder and linked live to ${currentItem.EquipmentTagNo}.`
          : isGoogleDrive
          ? `Your report "${uploadedTitle}" has been uploaded directly to the Central Google Drive Folder and linked live to ${currentItem.EquipmentTagNo}.`
          : `Your report "${uploadedTitle}" has been uploaded and synchronized live with ${currentItem.EquipmentTagNo}.`,
        subtitle: json.driveBridgeWarning
          ? `Note: ${json.driveBridgeWarning}`
          : autoCompleteStage
          ? `Stage "${uploadedStageLabel}" has been automatically marked as Completed!`
          : undefined,
        metaItems: [
          { label: 'Equipment Tag No.', value: currentItem.EquipmentTagNo, highlight: 'blue' },
          { label: 'Hierarchy Path', value: formatEquipmentHierarchyPath(currentItem) },
          { label: 'Inspection Stage', value: uploadedStageLabel, highlight: 'green' },
          {
            label: 'Saved Location',
            value: isBoth
              ? `Google Drive + OneDrive (${currentItem.Unit})`
              : isOneDrive
              ? `Microsoft OneDrive (${currentItem.Unit} Folder)`
              : isGoogleDrive
              ? `Google Drive (${currentItem.Unit} Folder)`
              : 'Live Cloud Storage',
            highlight: isBoth || isOneDrive || isGoogleDrive ? 'blue' : 'green',
          },
        ],
      });
      setActiveTab('view');
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Error attaching inspection report',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAttachment = async (rep: InspectionReportAttachment) => {
    const attachmentId = rep.id;
    setDeletingId(attachmentId);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/reports', {
        method: 'DELETE',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          equipmentId: currentItem.id,
          attachmentId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to remove report');
      }
      const updatedEquip: EquipmentItem = json.equipment;
      setCurrentItem(updatedEquip);
      onUpdated(updatedEquip);
      setReportPendingDelete(null);

      const deletedInDrive = json.driveDeleteStatus?.trashedInDrive;
      const deletedInOneDrive = json.onedriveDeleteStatus?.deletedInOneDrive;
      const driveAttempted = json.driveDeleteStatus?.attempted;
      const msgText =
        deletedInDrive && deletedInOneDrive
          ? 'Report removed from app AND deleted in both Google Drive & Microsoft OneDrive!'
          : deletedInOneDrive
          ? 'Report removed from app AND deleted in Microsoft OneDrive!'
          : deletedInDrive
          ? 'Report removed from app AND moved to Google Drive Trash!'
          : driveAttempted
          ? 'Report removed from app! (Note: To also auto-delete files inside Google Drive when deleting from the app, copy the updated Apps Script in Tab 3 and redeploy).'
          : 'Report removed from equipment record & Cloud Storage.';

      setStatusMsg({
        type: 'ok',
        text: msgText,
      });

      setSweetSuccess({
        title: 'Report Deleted Successfully!',
        badgeText:
          deletedInDrive && deletedInOneDrive
            ? 'Removed from App, Google Drive & OneDrive'
            : deletedInOneDrive
            ? 'Removed from App & OneDrive'
            : deletedInDrive
            ? 'Removed from App & Google Drive'
            : 'Report Removed',
        message: `"${rep.title}" has been permanently removed from ${currentItem.EquipmentTagNo}.`,
        subtitle:
          deletedInDrive && deletedInOneDrive
            ? 'The file was automatically removed from both your Google Drive and Microsoft OneDrive folders.'
            : deletedInOneDrive
            ? 'The file was also automatically deleted from your Microsoft OneDrive folder.'
            : deletedInDrive
            ? 'The file was also automatically moved to Trash in your Google Drive folder.'
            : undefined,
        metaItems: [
          { label: 'Equipment Tag No.', value: currentItem.EquipmentTagNo, highlight: 'slate' },
          { label: 'Deleted Report', value: rep.title },
          { label: 'Stage', value: rep.stageLabel, highlight: 'amber' },
          {
            label: 'Cloud Sync Status',
            value:
              deletedInDrive && deletedInOneDrive
                ? 'Deleted in App + Google Drive + OneDrive'
                : deletedInOneDrive
                ? 'Deleted in App + Microsoft OneDrive'
                : deletedInDrive
                ? 'Deleted in App + Google Drive'
                : 'Removed from App Record',
            highlight: 'green',
          },
        ],
      });
    } catch (err: any) {
      setReportPendingDelete(null);
      setStatusMsg({ type: 'err', text: err?.message || 'Could not remove report' });
    } finally {
      setDeletingId(null);
    }
  };

  const isImageReport = (rep: InspectionReportAttachment) => {
    if (rep.mimeType && rep.mimeType.startsWith('image/')) return true;
    if (/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(rep.title || '')) return true;
    return /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(rep.viewUrl || '');
  };

  /**
   * Returns a direct raw image binary URL suitable for an `<img src="..." />` tag.
   */
  const getDirectImagePreviewUrl = (rep: InspectionReportAttachment): string | null => {
    if (!isImageReport(rep) || failedDirectImageIds.has(rep.id)) {
      return null;
    }
    if (rep.provider === 'supabase_storage' && rep.viewUrl) {
      return rep.viewUrl;
    }
    if (rep.secondaryProvider === 'supabase_storage' && rep.secondaryViewUrl) {
      return rep.secondaryViewUrl;
    }
    const params = new URLSearchParams();
    if (rep.fileId) params.set('fileId', rep.fileId);
    if (rep.viewUrl) params.set('url', rep.viewUrl);
    if (rep.storagePath) params.set('storagePath', rep.storagePath);
    if (rep.title) params.set('title', rep.title);
    return `/api/reports/proxy?${params.toString()}`;
  };

  const isCompactModal = activeTab === 'attach' || parsedDoc.reports.length === 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: isCompactModal ? '620px' : '820px',
          height: isCompactModal ? 'auto' : '78vh',
          maxHeight: isCompactModal ? '86vh' : '680px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow:
            '0 24px 48px -12px rgba(15, 23, 42, 0.38), 0 0 0 1px rgba(148, 163, 184, 0.22)',
          overflow: 'hidden',
          transition: 'max-width 0.2s ease',
        }}
      >
        {/* Top Executive Header */}
        <div
          style={{
            padding: '12px 18px',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
            color: '#ffffff',
            borderBottom: '1px solid rgba(56, 189, 248, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '9px',
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(14, 165, 233, 0.15) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FileText size={16} color="#38bdf8" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '14.5px',
                    fontWeight: 800,
                    color: '#ffffff',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {currentItem.EquipmentTagNo}
                </h2>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1.5px 7px',
                    borderRadius: '999px',
                    background: 'rgba(16, 185, 129, 0.2)',
                    color: '#6ee7b7',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {calculateProgress([currentItem])}% Complete
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#bae6fd', marginTop: '1px' }}>
                <b>{formatEquipmentHierarchyPath(currentItem)}</b> ·{' '}
                {currentItem.EquipmentDescription || 'Equipment'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '7px',
                background: 'rgba(56, 189, 248, 0.18)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                color: '#e0f2fe',
                fontSize: '11px',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              <FileText size={12.5} />
              <span>Uploaded Reports: {parsedDoc.reports.length}</span>
            </span>
            {effectiveCanEdit && onOpenCloudSync && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenCloudSync();
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 10px',
                  borderRadius: '7px',
                  background: 'rgba(16, 185, 129, 0.18)',
                  border: '1px solid rgba(52, 211, 153, 0.4)',
                  color: '#d1fae5',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title="Bulk drag-and-drop multiple PDF/Image reports or sync a Google Drive folder"
              >
                <FolderSync size={13} />
                <span>Bulk Sync</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                color: '#ffffff',
                borderRadius: '8px',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="Close modal"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Sub-Bar: Compact Stage Pills + Segmented Mode Switcher */}
        <div
          style={{
            padding: '8px 18px',
            background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            {STATUS_COLUMNS.map((col) => {
              const val = (currentItem[col.key] as string) || col.pendingValue;
              const done = isDone(val);
              const stageReports = parsedDoc.reports.filter((r) => r.stage === col.key);
              const hasReportForStage = stageReports.length > 0;
              const isStageImg = hasReportForStage && stageReports.every((r) => isImageReport(r));
              return (
                <span
                  key={col.key}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '5px',
                    background: done ? '#dcfce7' : '#ffffff',
                    color: done ? '#166534' : '#64748b',
                    border: done ? '1px solid #86efac' : '1px solid #cbd5e1',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{col.short}:</span>
                  <span>{val}</span>
                  {hasReportForStage && (
                    <span
                      style={{
                        background: '#0284c7',
                        color: '#fff',
                        padding: '0 3.5px',
                        borderRadius: '3px',
                        fontSize: '9px',
                      }}
                      title="Live report attached for this stage"
                    >
                      {isStageImg ? 'IMG' : 'PDF'}
                    </span>
                  )}
                </span>
              );
            })}
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              padding: '2.5px',
              borderRadius: '8px',
              background: '#e2e8f0',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('view')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                background: activeTab === 'view' ? '#ffffff' : 'transparent',
                color: activeTab === 'view' ? '#0284c7' : '#475569',
                boxShadow: activeTab === 'view' ? '0 1px 2px rgba(15, 23, 42, 0.1)' : 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Eye size={12.5} />
              <span>Uploaded Reports ({parsedDoc.reports.length})</span>
            </button>

            {effectiveCanEdit && (
              <button
                type="button"
                onClick={() => setActiveTab('attach')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  background: activeTab === 'attach' ? '#059669' : 'transparent',
                  color: activeTab === 'attach' ? '#ffffff' : '#334155',
                  boxShadow: activeTab === 'attach' ? '0 1px 2px rgba(5, 150, 105, 0.25)' : 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <Upload size={12.5} />
                <span>+ Upload / Link</span>
              </button>
            )}
          </div>
        </div>

        {statusMsg && (
          <div
            style={{
              padding: '7px 18px',
              background: statusMsg.type === 'ok' ? '#dcfce7' : '#fee2e2',
              color: statusMsg.type === 'ok' ? '#166534' : '#991b1b',
              borderBottom: `1px solid ${statusMsg.type === 'ok' ? '#86efac' : '#fca5a5'}`,
              fontSize: '11.5px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{statusMsg.text}</span>
            <button
              type="button"
              onClick={() => setStatusMsg(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* MAIN BODY */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'view' ? (
            parsedDoc.reports.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '28px 20px',
                  textAlign: 'center',
                  background: '#f8fafc',
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: '#e0f2fe',
                    border: '1px solid #bae6fd',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '10px',
                  }}
                >
                  <FileText size={24} color="#0284c7" />
                </div>
                <h3 style={{ margin: '0 0 4px', fontSize: '14.5px', fontWeight: 700, color: '#0f172a' }}>
                  0 Inspection Reports Uploaded
                </h3>
                {parsedDoc.drawingRef && (
                  <p
                    style={{
                      margin: '0 0 8px',
                      fontSize: '11.5px',
                      color: '#0369a1',
                      background: '#e0f2fe',
                      padding: '3px 10px',
                      borderRadius: '6px',
                      fontWeight: 600,
                    }}
                  >
                    Drawing Ref: {parsedDoc.drawingRef}
                  </p>
                )}
                <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#64748b', maxWidth: '420px', lineHeight: 1.45 }}>
                  {effectiveCanEdit ? (
                    <>
                      Upload a signed <b>PDF / Inspection Photo</b> directly or paste a <b>Google Drive / OneDrive</b> share link.
                    </>
                  ) : (
                    <>
                      No inspection reports have been uploaded for <b>{currentItem.EquipmentTagNo}</b> yet.
                    </>
                  )}
                </p>
                {effectiveCanEdit && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('attach')}
                    style={{
                      padding: '8px 16px',
                      fontSize: '12px',
                      fontWeight: 700,
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                      color: '#ffffff',
                      border: 'none',
                      boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Upload size={14} />
                    <span>Upload PDF or Attach Cloud Link</span>
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateColumns: '230px 1fr',
                  overflow: 'hidden',
                }}
              >
                {/* Left Sidebar: Attached Reports List across Stages */}
                <div
                  style={{
                    borderRight: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    overflowY: 'auto',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: '#64748b',
                      padding: '0 2px 2px',
                    }}
                  >
                    Attached Reports ({parsedDoc.reports.length})
                  </div>

                  {parsedDoc.drawingRef && (
                    <div
                      style={{
                        padding: '6px 8px',
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontSize: '11px',
                        color: '#334155',
                      }}
                    >
                      <span style={{ color: '#64748b', display: 'block', fontSize: '9.5px', fontWeight: 700 }}>
                        DRAWING REF
                      </span>
                      <b style={{ fontFamily: 'monospace' }}>{parsedDoc.drawingRef}</b>
                    </div>
                  )}

                  {parsedDoc.reports.map((rep) => {
                    const isSelected = selectedReport?.id === rep.id;
                    const badge = getProviderBadgeMeta(rep.provider);
                    return (
                      <div
                        key={rep.id}
                        onClick={() => setSelectedReportId(rep.id)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: isSelected ? '#eff6ff' : '#ffffff',
                          border: isSelected ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                          <span
                            style={{
                              fontSize: '9.5px',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: '#0f172a',
                              color: '#ffffff',
                            }}
                          >
                            {rep.stageLabel}
                          </span>
                          <span
                            style={{
                              fontSize: '9.5px',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: badge.bg,
                              color: badge.color,
                              border: `1px solid ${badge.border}`,
                            }}
                          >
                            {badge.shortLabel}
                          </span>
                        </div>

                        <div
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: '#0f172a',
                            wordBreak: 'break-word',
                            lineHeight: 1.3,
                          }}
                        >
                          {rep.title}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '10px',
                            color: '#64748b',
                            marginTop: '1px',
                          }}
                        >
                          <span>
                            {rep.uploadedAt ? new Date(rep.uploadedAt).toLocaleDateString() : 'Live Synced'}
                          </span>
                          {effectiveCanEdit && (
                            <button
                              type="button"
                              disabled={deletingId === rep.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setReportPendingDelete(rep);
                              }}
                              style={{
                                background: '#fef2f2',
                                border: '1px solid #fecaca',
                                borderRadius: '4px',
                                color: '#dc2626',
                                cursor: 'pointer',
                                padding: '1.5px 5px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2px',
                                fontSize: '10px',
                                fontWeight: 700,
                              }}
                              title="Delete this report"
                            >
                              <Trash2 size={11} />
                              <span>{deletingId === rep.id ? '...' : 'Delete'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right Pane: Live Embedded Report Preview + Direct Open in Drive / OneDrive Actions */}
                {selectedReport && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                    {/* Preview Action Toolbar */}
                    <div
                      style={{
                        padding: '8px 14px',
                        background: '#ffffff',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <b style={{ fontSize: '12.5px', color: '#0f172a' }}>{selectedReport.title}</b>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '1.5px 6px',
                              borderRadius: '4px',
                              background: getProviderBadgeMeta(selectedReport.provider).bg,
                              color: getProviderBadgeMeta(selectedReport.provider).color,
                              border: `1px solid ${getProviderBadgeMeta(selectedReport.provider).border}`,
                            }}
                          >
                            {selectedReport.secondaryViewUrl
                              ? 'Google Drive + OneDrive'
                              : getProviderBadgeMeta(selectedReport.provider).label}
                          </span>
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '1px' }}>
                          Stage: <b>{selectedReport.stageLabel}</b>
                          {selectedReport.uploadedBy ? ` · Synced by ${selectedReport.uploadedBy}` : ''}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap' }}>
                        {effectiveCanEdit && (
                          <button
                            type="button"
                            disabled={deletingId === selectedReport.id}
                            onClick={() => setReportPendingDelete(selectedReport)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '5px 10px',
                              borderRadius: '6px',
                              background: '#fef2f2',
                              color: '#dc2626',
                              border: '1px solid #fecaca',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                            title="Delete this report from App & Cloud Drive"
                          >
                            <Trash2 size={12.5} />
                            <span>Delete</span>
                          </button>
                        )}
                        <a
                          href={selectedReport.viewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '5px 10px',
                            borderRadius: '6px',
                            background: '#0284c7',
                            color: '#ffffff',
                            textDecoration: 'none',
                            fontSize: '11px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <ExternalLink size={12.5} />
                          <span>
                            {selectedReport.provider === 'google_drive'
                              ? 'Open in Drive ↗'
                              : selectedReport.provider === 'onedrive'
                              ? 'Open in OneDrive ↗'
                              : 'Open Original ↗'}
                          </span>
                        </a>
                        {selectedReport.secondaryViewUrl && (
                          <a
                            href={selectedReport.secondaryViewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '5px 10px',
                              borderRadius: '6px',
                              background: '#4f46e5',
                              color: '#ffffff',
                              textDecoration: 'none',
                              fontSize: '11px',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <ExternalLink size={12.5} />
                            <span>OneDrive ↗</span>
                          </a>
                        )}

                        {selectedReport.provider === 'supabase_storage' && (
                          <a
                            href={selectedReport.viewUrl}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '5px 10px',
                              borderRadius: '6px',
                              background: '#f1f5f9',
                              color: '#0f172a',
                              border: '1px solid #cbd5e1',
                              textDecoration: 'none',
                              fontSize: '11px',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <Download size={12.5} />
                            <span>Download</span>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Live Embedded Frame / Image Container */}
                    <div
                      style={{
                        flex: 1,
                        background: '#0f172a',
                        position: 'relative',
                        overflow: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {(() => {
                        const directImgUrl = getDirectImagePreviewUrl(selectedReport);
                        if (directImgUrl) {
                          return (
                            <img
                              key={directImgUrl}
                              src={directImgUrl}
                              alt={selectedReport.title}
                              referrerPolicy="no-referrer"
                              onError={() => {
                                setFailedDirectImageIds((prev) => {
                                  const next = new Set(prev);
                                  next.add(selectedReport.id);
                                  return next;
                                });
                              }}
                              style={{
                                maxWidth: '100%',
                                maxHeight: '100%',
                                objectFit: 'contain',
                                display: 'block',
                              }}
                            />
                          );
                        }
                        if (isImageReport(selectedReport)) {
                          return (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '12px',
                                padding: '28px',
                                textAlign: 'center',
                                color: '#e2e8f0',
                                maxWidth: '400px',
                              }}
                            >
                              <FileText size={36} color="#38bdf8" />
                              <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>
                                {selectedReport.title}
                              </div>
                              <div style={{ fontSize: '11.5px', color: '#94a3b8', lineHeight: 1.45 }}>
                                Google Drive restricted direct embedded preview for this image in your browser. Click below to view the full-resolution image directly in Drive.
                              </div>
                              <a
                                href={selectedReport.viewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  padding: '8px 16px',
                                  borderRadius: '8px',
                                  background: '#0284c7',
                                  color: '#ffffff',
                                  textDecoration: 'none',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                }}
                              >
                                <ExternalLink size={14} />
                                <span>Open Image in Drive ↗</span>
                              </a>
                            </div>
                          );
                        }
                        return (
                          <iframe
                            key={selectedReport.embedUrl}
                            src={selectedReport.embedUrl}
                            title={selectedReport.title}
                            style={{
                              width: '100%',
                              height: '100%',
                              border: 'none',
                              background: '#ffffff',
                            }}
                            allow="autoplay; fullscreen"
                          />
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            /* TAB 2: COMPACT & PREMIUM ATTACH / UPLOAD FORM */
            <form
              onSubmit={handleAttachSubmit}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {/* Compact Destination Status Pill Bar */}
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background:
                    driveBridgeInfo?.activeProvider === 'both'
                      ? 'linear-gradient(90deg, #eef2ff 0%, #f5f3ff 100%)'
                      : driveBridgeInfo?.activeProvider === 'onedrive'
                      ? 'linear-gradient(90deg, #f0f9ff 0%, #e0f2fe 100%)'
                      : driveBridgeInfo?.enabled
                      ? 'linear-gradient(90deg, #eff6ff 0%, #e0f2fe 100%)'
                      : 'linear-gradient(90deg, #ecfdf5 0%, #f0fdf4 100%)',
                  border:
                    driveBridgeInfo?.activeProvider === 'both'
                      ? '1px solid #c7d2fe'
                      : driveBridgeInfo?.activeProvider === 'onedrive'
                      ? '1px solid #bae6fd'
                      : driveBridgeInfo?.enabled
                      ? '1px solid #bfdbfe'
                      : '1px solid #a7f3d0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  flexWrap: 'wrap',
                  fontSize: '11px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: '#1e3a8a', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      padding: '2px 7px',
                      borderRadius: '999px',
                      fontWeight: 800,
                      fontSize: '9.5px',
                      letterSpacing: '0.02em',
                      background:
                        driveBridgeInfo?.activeProvider === 'both'
                          ? '#4f46e5'
                          : driveBridgeInfo?.activeProvider === 'onedrive'
                          ? '#0284c7'
                          : driveBridgeInfo?.enabled
                          ? '#1d4ed8'
                          : '#059669',
                      color: '#ffffff',
                    }}
                  >
                    {driveBridgeInfo?.activeProvider === 'both' &&
                    driveBridgeInfo?.enabled &&
                    driveBridgeInfo?.onedriveEnabled
                      ? 'DUAL CLOUD SYNC'
                      : driveBridgeInfo?.activeProvider === 'onedrive' && driveBridgeInfo?.onedriveEnabled
                      ? 'ONEDRIVE SYNC'
                      : driveBridgeInfo?.enabled
                      ? 'GOOGLE DRIVE SYNC'
                      : 'CLOUD STORAGE'}
                  </span>
                  <span style={{ fontWeight: 600, color: '#334155' }}>
                    {driveBridgeInfo?.activeProvider === 'both' &&
                    driveBridgeInfo?.enabled &&
                    driveBridgeInfo?.onedriveEnabled
                      ? `Auto-saves to Google Drive & OneDrive (${currentItem.Unit})`
                      : driveBridgeInfo?.activeProvider === 'onedrive' && driveBridgeInfo?.onedriveEnabled
                      ? `Auto-saves to Microsoft OneDrive (${currentItem.Unit})`
                      : driveBridgeInfo?.enabled
                      ? `Auto-saves to Google Drive${
                          driveBridgeInfo.organizeByUnitSubfolder ? ` › ${currentItem.Unit}` : ''
                        }`
                      : 'Direct upload to live Cloud Storage (no login required)'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {driveBridgeInfo?.targetFolderUrl && (
                    <a
                      href={driveBridgeInfo.targetFolderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 700,
                        color: '#1d4ed8',
                        textDecoration: 'none',
                      }}
                    >
                      Drive Folder ↗
                    </a>
                  )}
                  {driveBridgeInfo?.onedriveTargetFolderUrl && (
                    <a
                      href={driveBridgeInfo.onedriveTargetFolderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 700,
                        color: '#0284c7',
                        textDecoration: 'none',
                      }}
                    >
                      OneDrive ↗
                    </a>
                  )}
                </div>
              </div>

              {/* Source Mode Selector — Compact Segmented Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setAttachMode('file_upload')}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '10px',
                    border:
                      attachMode === 'file_upload' ? '1.5px solid #059669' : '1px solid #cbd5e1',
                    background:
                      attachMode === 'file_upload'
                        ? 'linear-gradient(180deg, #ecfdf5 0%, #f0fdf4 100%)'
                        : '#ffffff',
                    boxShadow:
                      attachMode === 'file_upload'
                        ? '0 2px 8px rgba(5, 150, 105, 0.12)'
                        : 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12px', color: '#047857' }}>
                    <Upload size={14} />
                    <span>1. Direct PDF / Photo Upload</span>
                  </div>
                  <span style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.3 }}>
                    Upload from PC or phone directly to Cloud
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setAttachMode('cloud_link')}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '10px',
                    border:
                      attachMode === 'cloud_link' ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                    background:
                      attachMode === 'cloud_link'
                        ? 'linear-gradient(180deg, #f0f9ff 0%, #e0f2fe 100%)'
                        : '#ffffff',
                    boxShadow:
                      attachMode === 'cloud_link'
                        ? '0 2px 8px rgba(2, 132, 199, 0.12)'
                        : 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12px', color: '#0369a1' }}>
                    <Link2 size={14} />
                    <span>2. Paste Drive / OneDrive Link</span>
                  </div>
                  <span style={{ fontSize: '10.5px', color: '#64748b', lineHeight: 1.3 }}>
                    Link an existing cloud share URL live
                  </span>
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Inspection Stage *
                  </label>
                  <select
                    value={stage ?? 'FormatIStatus'}
                    onChange={(e) => setStage(e.target.value as ReportStageKey)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      fontWeight: 600,
                      color: '#0f172a',
                    }}
                  >
                    {REPORT_STAGE_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Report Title / Document Name
                  </label>
                  <input
                    type="text"
                    placeholder={`e.g. ${currentItem.EquipmentTagNo} Format-I Report`}
                    value={reportTitle ?? ''}
                    onChange={(e) => setReportTitle(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {attachMode === 'cloud_link' ? (
                <div key="cloud-link-input-container">
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Google Drive or OneDrive Share URL *
                  </label>
                  <input
                    key="cloud-url-input"
                    type="url"
                    required
                    placeholder="https://drive.google.com/file/d/.../view or https://1drv.ms/..."
                    value={cloudUrl ?? ''}
                    onChange={(e) => setCloudUrl(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 11px',
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1.5px solid #0284c7',
                      background: '#f0f9ff',
                      boxSizing: 'border-box',
                    }}
                  />
                  <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '3px' }}>
                    Tip: Set link access to &ldquo;Anyone with the link can view&rdquo; for embedded viewing.
                  </span>
                </div>
              ) : (
                <div
                  key="file-upload-input-container"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) {
                      setSelectedFile(dropped);
                    }
                  }}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: isDraggingFile ? '2px dashed #0284c7' : '1.5px dashed #10b981',
                    background: isDraggingFile
                      ? '#e0f2fe'
                      : 'linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#065f46', marginBottom: '5px' }}>
                    Drag &amp; Drop Report or Choose File (PDF, PNG, JPG — Max 20 MB) *
                  </label>
                  <input
                    key="file-upload-input"
                    type="file"
                    accept=".pdf,image/png,image/jpeg,image/webp"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: '11.5px',
                      borderRadius: '7px',
                      border: '1px solid #86efac',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                    }}
                  />
                  {selectedFile && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#047857', fontWeight: 700 }}>
                      ✓ Ready: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Reference Drawing No. (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. NRL-RPTU-GA-1001A"
                    value={drawingRef ?? ''}
                    onChange={(e) => setDrawingRef(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '7px 10px',
                    borderRadius: '8px',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(autoCompleteStage)}
                    onChange={(e) => setAutoCompleteStage(e.target.checked)}
                    style={{ width: '14px', height: '14px', accentColor: '#16a34a', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#166534', lineHeight: 1.25 }}>
                    Auto-mark stage Completed
                  </span>
                </label>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px',
                  paddingTop: '10px',
                  borderTop: '1px solid #e2e8f0',
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '7px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '7px 16px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)',
                    color: '#ffffff',
                    cursor: submitting ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <CheckCircle2 size={14} />
                  <span>{submitting ? 'Uploading...' : 'Save & Attach Report'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Real-Time Animated Upload Progress Popup */}
      <UploadProgressPopup
        open={submitting}
        title={
          attachMode === 'file_upload'
            ? 'Uploading Report to Cloud & Linking...'
            : 'Linking Cloud Report Live...'
        }
        fileName={
          attachMode === 'file_upload'
            ? selectedFile?.name || reportTitle
            : reportTitle || cloudUrl
        }
        equipmentTag={currentItem.EquipmentTagNo}
        stageLabel={getStageLabel(stage)}
        destinationLabel={
          driveBridgeInfo?.activeProvider === 'both' &&
          driveBridgeInfo?.enabled &&
          driveBridgeInfo?.onedriveEnabled
            ? `Google Drive + OneDrive (${currentItem.Unit})`
            : driveBridgeInfo?.activeProvider === 'onedrive' && driveBridgeInfo?.onedriveEnabled
            ? `Admin Microsoft OneDrive (${currentItem.Unit})`
            : driveBridgeInfo?.enabled
            ? `Admin Google Drive Folder (${currentItem.Unit})`
            : 'Supabase Cloud Storage'
        }
      />

      {/* SweetAlert-Style Warning Confirmation Popup for Deleting Report */}
      <SweetWarningDeletePopup
        open={Boolean(reportPendingDelete)}
        title="Warning: Delete Inspection Report?"
        targetType="Inspection Report"
        targetName={
          reportPendingDelete
            ? `${reportPendingDelete.title} (${reportPendingDelete.stageLabel})`
            : ''
        }
        description={
          reportPendingDelete?.secondaryViewUrl
            ? `Are you sure you want to delete this report from ${currentItem.EquipmentTagNo}? It will be removed from the NREP App AND deleted in both Google Drive and Microsoft OneDrive.`
            : reportPendingDelete?.provider === 'onedrive'
            ? `Are you sure you want to delete this report from ${currentItem.EquipmentTagNo}? It will be removed from the NREP App AND deleted in Microsoft OneDrive.`
            : reportPendingDelete?.provider === 'google_drive'
            ? `Are you sure you want to delete this report from ${currentItem.EquipmentTagNo}? It will be removed from the NREP App AND moved to Trash in Google Drive.`
            : `Are you sure you want to delete this report from ${currentItem.EquipmentTagNo}? It will be permanently removed from the equipment record and Cloud Storage.`
        }
        warningNote="Once deleted, this report link and file will no longer be visible to engineers."
        confirmLabel="Yes, Delete Report"
        cancelLabel="No, Keep Report"
        loading={Boolean(reportPendingDelete && deletingId === reportPendingDelete.id)}
        onCancel={() => setReportPendingDelete(null)}
        onConfirm={() => {
          if (reportPendingDelete) {
            handleDeleteAttachment(reportPendingDelete);
          }
        }}
      />

      {/* SweetAlert-Style Success Popup Window */}
      <SweetSuccessPopup
        open={Boolean(sweetSuccess)}
        title={sweetSuccess?.title || 'Success!'}
        message={sweetSuccess?.message || ''}
        subtitle={sweetSuccess?.subtitle}
        badgeText={sweetSuccess?.badgeText}
        metaItems={sweetSuccess?.metaItems}
        confirmLabel="OK, Great!"
        onClose={() => setSweetSuccess(null)}
      />
    </div>
  );
}

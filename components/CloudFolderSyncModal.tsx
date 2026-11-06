'use client';

import React, { useState, useEffect } from 'react';
import { EquipmentItem, ReportStageKey } from '@/lib/types';
import {
  REPORT_STAGE_OPTIONS,
  getProviderBadgeMeta,
  getStageLabel,
  matchFileToEquipment,
} from '@/lib/reportUtils';
import { buildAuthHeaders, useAuth } from '@/lib/auth-context';
import {
  ActiveCloudProviderMode,
  OneDriveConnectionMode,
} from '@/lib/driveBridge';
import {
  UploadProgressPopup,
  SweetSuccessPopup,
  SweetWarningDeletePopup,
  SweetSuccessMetaItem,
} from './SweetPopupModal';
import {
  FolderSync,
  CheckCircle2,
  Search,
  ExternalLink,
  X,
  FileSpreadsheet,
  Sparkles,
  Upload,
  Settings,
  Copy,
  Check,
  Trash2,
  HardDrive,
  Cloud,
  Layers,
  ArrowRight,
  AlertCircle,
  FileText,
} from 'lucide-react';

interface CloudFolderSyncModalProps {
  equipment: EquipmentItem[];
  scopeLabel: string;
  initialTab?: 'bulk_upload' | 'folder_sync' | 'drive_setup';
  onClose: () => void;
  onSynced: () => Promise<void>;
}

interface PreviewMatchItem {
  id: string;
  fileName: string;
  viewUrl: string;
  embedUrl: string;
  provider: 'google_drive' | 'onedrive' | 'supabase_storage' | 'external_link';
  matchedEquipmentId: string;
  matchedEquipmentTag: string;
  matchedUnit: string;
  matchedDescription: string;
  stage: ReportStageKey;
  stageLabel: string;
}

interface BulkFileQueueItem {
  id: string;
  file: File;
  fileName: string;
  sizeBytes: number;
  matchedEquipmentId: string;
  matchedEquipmentTag: string;
  matchedUnit: string;
  stage: ReportStageKey;
  status: 'ready' | 'uploading' | 'done' | 'error';
  resultDestination?: 'google_drive' | 'onedrive' | 'both' | 'supabase_storage';
  resultUrl?: string;
  errorMsg?: string;
}

export default function CloudFolderSyncModal({
  equipment,
  scopeLabel,
  initialTab = 'bulk_upload',
  onClose,
  onSynced,
}: CloudFolderSyncModalProps) {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'bulk_upload' | 'folder_sync' | 'drive_setup'>(
    initialTab
  );

  // Tab 1: Direct Bulk File Upload states
  const [bulkQueue, setBulkQueue] = useState<BulkFileQueueItem[]>([]);
  const [isDraggingBulk, setIsDraggingBulk] = useState(false);
  const [bulkDefaultStage, setBulkDefaultStage] = useState<ReportStageKey>('FormatIStatus');
  const [bulkAutoComplete, setBulkAutoComplete] = useState(true);
  const [uploadingBulk, setUploadingBulk] = useState(false);

  // Tab 2: Existing Folder Sync states
  const [folderUrl, setFolderUrl] = useState('');
  const [batchLinksText, setBatchLinksText] = useState('');
  const [defaultStage, setDefaultStage] = useState<ReportStageKey>('FormatIStatus');
  const [autoCompleteStage, setAutoCompleteStage] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewItems, setPreviewItems] = useState<PreviewMatchItem[]>([]);

  // Tab 3: Multi-Cloud Switcher + Google Drive + Microsoft OneDrive Setup states
  const [activeProvider, setActiveProvider] = useState<ActiveCloudProviderMode>('google_drive');
  const [setupSubTab, setSetupSubTab] = useState<'google_drive' | 'onedrive'>('google_drive');
  const [switchingProvider, setSwitchingProvider] = useState(false);

  // Google Drive states
  const [bridgeEnabled, setBridgeEnabled] = useState(false);
  const [bridgeScriptUrl, setBridgeScriptUrl] = useState('');
  const [targetFolderUrl, setTargetFolderUrl] = useState('');
  const [organizeByUnitSubfolder, setOrganizeByUnitSubfolder] = useState(true);
  const [scriptTemplate, setScriptTemplate] = useState('');
  const [savingBridge, setSavingBridge] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [lastTestMessage, setLastTestMessage] = useState('');

  // Microsoft OneDrive states
  const [onedriveEnabled, setOnedriveEnabled] = useState(false);
  const [onedriveMode, setOnedriveMode] = useState<OneDriveConnectionMode>('webhook_bridge');
  const [onedriveBridgeUrl, setOnedriveBridgeUrl] = useState('');
  const [onedriveAccessToken, setOnedriveAccessToken] = useState('');
  const [onedriveTargetFolderUrl, setOnedriveTargetFolderUrl] = useState('');
  const [onedriveFolderPath, setOnedriveFolderPath] = useState('/NREP_Inspection_Reports');
  const [onedriveOrganizeByUnitSubfolder, setOnedriveOrganizeByUnitSubfolder] = useState(true);
  const [onedriveTemplate, setOnedriveTemplate] = useState('');
  const [savingOneDrive, setSavingOneDrive] = useState(false);
  const [copiedOneDriveTemplate, setCopiedOneDriveTemplate] = useState(false);
  const [onedriveLastTestMessage, setOnedriveLastTestMessage] = useState('');

  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Real-time Upload Progress & SweetAlert-style Popup states
  const [activeUploadStep, setActiveUploadStep] = useState<{
    index: number;
    total: number;
    fileName: string;
    equipmentTag: string;
    stageLabel: string;
  } | null>(null);
  const [sweetSuccess, setSweetSuccess] = useState<{
    title: string;
    message: string;
    subtitle?: string;
    badgeText?: string;
    metaItems?: SweetSuccessMetaItem[];
  } | null>(null);
  const [pendingQueueDelete, setPendingQueueDelete] = useState<
    | { mode: 'single'; item: BulkFileQueueItem }
    | { mode: 'clear_all'; count: number }
    | null
  >(null);

  // Load current Multi-Cloud Bridge configuration on mount
  useEffect(() => {
    let active = true;
    fetch('/api/drive-bridge', {
      method: 'GET',
      headers: buildAuthHeaders(),
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        if (!active || !data?.ok) return;
        if (data.config) {
          const cfg = data.config;
          setActiveProvider(
            (cfg.activeProvider as ActiveCloudProviderMode) ||
              (cfg.enabled ? 'google_drive' : cfg.onedriveEnabled ? 'onedrive' : 'supabase_storage')
          );

          // Google Drive
          setBridgeEnabled(Boolean(cfg.enabled));
          setBridgeScriptUrl(String(cfg.bridgeScriptUrl || ''));
          setTargetFolderUrl(String(cfg.targetFolderUrl || ''));
          setOrganizeByUnitSubfolder(cfg.organizeByUnitSubfolder !== false);
          setLastTestMessage(String(cfg.lastTestMessage || ''));

          // Microsoft OneDrive
          setOnedriveEnabled(Boolean(cfg.onedriveEnabled));
          setOnedriveMode(cfg.onedriveMode === 'graph_token' ? 'graph_token' : 'webhook_bridge');
          setOnedriveBridgeUrl(String(cfg.onedriveBridgeUrl || ''));
          setOnedriveAccessToken(String(cfg.onedriveAccessToken || ''));
          setOnedriveTargetFolderUrl(String(cfg.onedriveTargetFolderUrl || ''));
          setOnedriveFolderPath(String(cfg.onedriveFolderPath || '/NREP_Inspection_Reports'));
          setOnedriveOrganizeByUnitSubfolder(cfg.onedriveOrganizeByUnitSubfolder !== false);
          setOnedriveLastTestMessage(String(cfg.onedriveLastTestMessage || ''));

          if (cfg.activeProvider === 'onedrive') {
            setSetupSubTab('onedrive');
          }
        }
        if (data.scriptTemplate) {
          setScriptTemplate(String(data.scriptTemplate));
        }
        if (data.onedriveTemplate) {
          setOnedriveTemplate(String(data.onedriveTemplate));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const getActiveDestinationLabel = () => {
    if (activeProvider === 'both' && bridgeEnabled && onedriveEnabled) {
      return 'Dual-Cloud (Google Drive + OneDrive)';
    }
    if ((activeProvider === 'onedrive' || activeProvider === 'both') && onedriveEnabled) {
      return 'Microsoft OneDrive Folder';
    }
    if ((activeProvider === 'google_drive' || activeProvider === 'both') && bridgeEnabled) {
      return 'Google Drive Folder';
    }
    return 'Cloud Storage';
  };

  // Switch active cloud provider with 1 click
  const handleSwitchActiveProvider = async (nextMode: ActiveCloudProviderMode) => {
    setSwitchingProvider(true);
    setNotice(null);
    try {
      const res = await fetch('/api/drive-bridge', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'switch_provider',
          activeProvider: nextMode,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to switch active cloud drive');
      }

      setActiveProvider(nextMode);
      if (nextMode === 'onedrive') {
        setSetupSubTab('onedrive');
      } else if (nextMode === 'google_drive') {
        setSetupSubTab('google_drive');
      }

      const modeTitle =
        nextMode === 'google_drive'
          ? 'Google Drive'
          : nextMode === 'onedrive'
          ? 'Microsoft OneDrive'
          : nextMode === 'both'
          ? 'Both (Dual-Cloud)'
          : 'Cloud Storage';

      setNotice({
        type: 'ok',
        text: json.message || `Switched active cloud drive to ${modeTitle}!`,
      });

      setSweetSuccess({
        title: 'Active Cloud Drive Switched!',
        badgeText: modeTitle,
        message:
          json.message ||
          `Active report upload destination shifted to ${modeTitle}. Existing reports remain 100% intact.`,
        subtitle:
          nextMode === 'onedrive' && !onedriveEnabled
            ? 'Next step: Paste your OneDrive Bridge URL below and click "Test & Activate".'
            : nextMode === 'google_drive' && !bridgeEnabled
            ? 'Next step: Paste your Google Drive Bridge URL below and click "Test & Activate".'
            : undefined,
        metaItems: [
          { label: 'Active Upload Mode', value: modeTitle, highlight: 'blue' },
          {
            label: 'Google Drive Status',
            value: bridgeEnabled ? 'Connected & Ready' : 'Not Connected',
            highlight: bridgeEnabled ? 'green' : 'amber',
          },
          {
            label: 'Microsoft OneDrive Status',
            value: onedriveEnabled ? 'Connected & Ready' : 'Not Connected',
            highlight: onedriveEnabled ? 'green' : 'amber',
          },
        ],
      });
    } catch (err: any) {
      setNotice({
        type: 'err',
        text: err?.message || 'Could not switch active cloud drive',
      });
    } finally {
      setSwitchingProvider(false);
    }
  };

  // Add files to Bulk Upload Queue
  const handleAddFilesToBulkQueue = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    const newItems: BulkFileQueueItem[] = incoming.map((file, idx) => {
      const { matchedEquipment, detectedStage } = matchFileToEquipment(file.name, equipment);
      const resolvedStage =
        detectedStage !== 'General' ? detectedStage : bulkDefaultStage;

      return {
        id: `bulk_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        file,
        fileName: file.name,
        sizeBytes: file.size,
        matchedEquipmentId: matchedEquipment?.id || '',
        matchedEquipmentTag: matchedEquipment?.EquipmentTagNo || '',
        matchedUnit: matchedEquipment?.Unit || '',
        stage: resolvedStage,
        status: 'ready',
      };
    });

    setBulkQueue((prev) => [...prev, ...newItems]);
    const matchedCount = newItems.filter((i) => Boolean(i.matchedEquipmentId)).length;
    setNotice({
      type: 'ok',
      text: `Added ${newItems.length} file(s) — ${matchedCount} matched to Equipment Tags!`,
    });
  };

  // Run batch upload
  const handleRunBulkDirectUpload = async () => {
    const actionable = bulkQueue.filter(
      (item) => item.matchedEquipmentId && item.status !== 'done'
    );
    if (actionable.length === 0) {
      setNotice({
        type: 'err',
        text: 'Please select an Equipment Tag No. for at least one file before uploading.',
      });
      return;
    }

    setUploadingBulk(true);
    setNotice(null);

    let successCount = 0;
    let driveCount = 0;
    let onedriveCount = 0;
    let bothCount = 0;
    let errorCount = 0;

    for (let idx = 0; idx < actionable.length; idx++) {
      const item = actionable[idx];
      setActiveUploadStep({
        index: idx + 1,
        total: actionable.length,
        fileName: item.fileName,
        equipmentTag: item.matchedEquipmentTag || 'Equipment',
        stageLabel: getStageLabel(item.stage),
      });
      setBulkQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'uploading', errorMsg: undefined } : q))
      );

      try {
        const fd = new FormData();
        fd.append('equipmentId', item.matchedEquipmentId);
        fd.append('stage', item.stage);
        fd.append('title', item.fileName);
        fd.append('autoCompleteStage', String(bulkAutoComplete));
        fd.append('file', item.file);

        const res = await fetch('/api/reports', {
          method: 'POST',
          headers: buildAuthHeaders(),
          body: fd,
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || 'Upload failed');
        }

        successCount++;
        if (json.storageDestination === 'both') {
          bothCount++;
        } else if (json.storageDestination === 'google_drive') {
          driveCount++;
        } else if (json.storageDestination === 'onedrive') {
          onedriveCount++;
        }

        setBulkQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'done',
                  resultDestination: json.storageDestination || 'supabase_storage',
                  resultUrl: json.attachment?.viewUrl || '',
                }
              : q
          )
        );
      } catch (err: any) {
        errorCount++;
        setBulkQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'error',
                  errorMsg: err?.message || 'Upload failed',
                }
              : q
          )
        );
      }
    }

    await onSynced();
    setUploadingBulk(false);
    setActiveUploadStep(null);

    const destSummary =
      bothCount > 0
        ? 'Google Drive + OneDrive (Dual Sync)'
        : onedriveCount > 0
        ? 'Microsoft OneDrive'
        : driveCount > 0
        ? 'Google Drive'
        : 'Cloud Storage';

    if (errorCount === 0) {
      const okText = `Successfully uploaded ${successCount} report(s) directly to ${destSummary}!`;
      setNotice({
        type: 'ok',
        text: okText,
      });
      setSweetSuccess({
        title: 'Bulk Reports Uploaded!',
        badgeText: `Saved to ${destSummary}`,
        message: okText,
        subtitle: bulkAutoComplete
          ? 'All matched inspection stages were automatically marked as Completed!'
          : undefined,
        metaItems: [
          { label: 'Uploaded Reports', value: `${successCount} File(s)`, highlight: 'green' },
          { label: 'Storage Target', value: destSummary, highlight: 'blue' },
          { label: 'Scope', value: scopeLabel },
        ],
      });
    } else {
      setNotice({
        type: 'err',
        text: `Uploaded ${successCount} report(s) with ${errorCount} error(s). Please review failed files in the table.`,
      });
    }
  };

  // Tab 2: Scan preview
  const handleScanPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasFolder = Boolean(folderUrl.trim());
    const hasBatch = Boolean(batchLinksText.trim());

    if (!hasFolder && !hasBatch) {
      setNotice({
        type: 'err',
        text: 'Please paste a Shared Folder URL or at least one batch report link.',
      });
      return;
    }

    setScanning(true);
    setNotice(null);
    setPreviewItems([]);

    try {
      const res = await fetch('/api/cloud-sync', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'scan',
          folderUrl: folderUrl.trim(),
          batchLinksText: batchLinksText.trim(),
          defaultStage,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to scan cloud folder');
      }

      const items: PreviewMatchItem[] = json.items || [];
      setPreviewItems(items);

      if (items.length === 0) {
        setNotice({
          type: 'err',
          text: 'No public files were discovered in that folder URL. Ensure folder is shared as "Anyone with link can view".',
        });
      } else {
        setNotice({
          type: 'ok',
          text: `Discovered ${items.length} cloud report(s) — ${json.matchedCount} matched to Equipment Tags!`,
        });
      }
    } catch (err: any) {
      setNotice({
        type: 'err',
        text: err?.message || 'Could not scan cloud folder',
      });
    } finally {
      setScanning(false);
    }
  };

  // Tab 2: Apply sync
  const handleApplySync = async () => {
    const validItems = previewItems.filter((i) => i.matchedEquipmentId && i.viewUrl);
    if (validItems.length === 0) {
      setNotice({
        type: 'err',
        text: 'Please assign at least one report to an Equipment Tag No. before syncing.',
      });
      return;
    }

    setApplying(true);
    setNotice(null);
    try {
      const res = await fetch('/api/cloud-sync', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'apply',
          autoCompleteStage,
          items: validItems.map((item) => ({
            equipmentId: item.matchedEquipmentId,
            fileName: item.fileName,
            viewUrl: item.viewUrl,
            stage: item.stage,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to apply cloud report synchronization');
      }

      await onSynced();
      const syncMsg = `Successfully synchronized ${json.syncedReportCount} live cloud report(s) across ${json.updatedEquipmentCount} equipment record(s)!`;
      setNotice({
        type: 'ok',
        text: syncMsg,
      });
      setSweetSuccess({
        title: 'Cloud Reports Synchronized!',
        badgeText: 'Folder Sync Complete',
        message: syncMsg,
        metaItems: [
          {
            label: 'Reports Linked',
            value: `${json.syncedReportCount} Report(s)`,
            highlight: 'green',
          },
          {
            label: 'Equipment Updated',
            value: `${json.updatedEquipmentCount} Tag(s)`,
            highlight: 'blue',
          },
        ],
      });
    } catch (err: any) {
      setNotice({
        type: 'err',
        text: err?.message || 'Synchronization failed',
      });
    } finally {
      setApplying(false);
    }
  };

  // Tab 3: Google Drive Bridge
  const handleSaveDriveBridge = async (testConnection: boolean, makePrimary?: boolean) => {
    setSavingBridge(true);
    setNotice(null);
    try {
      const nextActive: ActiveCloudProviderMode = makePrimary
        ? 'google_drive'
        : activeProvider;
      const res = await fetch('/api/drive-bridge', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          providerTarget: 'google_drive',
          action: testConnection ? 'test' : 'save',
          testConnection,
          activeProvider: nextActive,
          enabled: Boolean(bridgeScriptUrl.trim()),
          bridgeScriptUrl: bridgeScriptUrl.trim(),
          targetFolderUrl: targetFolderUrl.trim(),
          organizeByUnitSubfolder,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to save or test Google Drive Bridge');
      }

      setBridgeEnabled(Boolean(json.config?.enabled));
      if (json.config?.activeProvider) {
        setActiveProvider(json.config.activeProvider);
      }
      setLastTestMessage(String(json.message || 'Connected'));
      const bridgeMsg =
        json.message ||
        'Google Drive Bridge connected! Uploads will be saved in your Google Drive folder.';
      setNotice({
        type: 'ok',
        text: bridgeMsg,
      });
      setSweetSuccess({
        title: testConnection
          ? 'Google Drive Bridge Connected!'
          : 'Google Drive Settings Saved!',
        badgeText: 'Google Drive Ready',
        message: bridgeMsg,
        metaItems: [
          {
            label: 'Google Drive Status',
            value: json.config?.enabled ? 'Connected & Active' : 'Disabled',
            highlight: json.config?.enabled ? 'green' : 'amber',
          },
          {
            label: 'Active Cloud Mode',
            value: String(json.config?.activeProvider || activeProvider).toUpperCase(),
            highlight: 'blue',
          },
        ],
      });
    } catch (err: any) {
      setNotice({
        type: 'err',
        text: err?.message || 'Failed to test Google Drive Bridge',
      });
    } finally {
      setSavingBridge(false);
    }
  };

  // Tab 3: OneDrive Bridge
  const handleSaveOneDriveBridge = async (testConnection: boolean, makePrimary?: boolean) => {
    setSavingOneDrive(true);
    setNotice(null);
    try {
      const nextActive: ActiveCloudProviderMode = makePrimary
        ? 'onedrive'
        : activeProvider === 'supabase_storage'
        ? 'onedrive'
        : activeProvider;

      const res = await fetch('/api/drive-bridge', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          providerTarget: 'onedrive',
          action: testConnection ? 'test' : 'save',
          testConnection,
          activeProvider: nextActive,
          onedriveEnabled: true,
          onedriveMode,
          onedriveBridgeUrl: onedriveBridgeUrl.trim(),
          onedriveAccessToken: onedriveAccessToken.trim(),
          onedriveTargetFolderUrl: onedriveTargetFolderUrl.trim(),
          onedriveFolderPath: onedriveFolderPath.trim() || '/NREP_Inspection_Reports',
          onedriveOrganizeByUnitSubfolder,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Failed to save or test Microsoft OneDrive Bridge');
      }

      setOnedriveEnabled(Boolean(json.config?.onedriveEnabled));
      if (json.config?.activeProvider) {
        setActiveProvider(json.config.activeProvider);
      }
      setOnedriveLastTestMessage(String(json.message || 'Connected to Microsoft OneDrive'));
      const odMsg =
        json.message ||
        'Microsoft OneDrive Bridge connected! Switch between Google Drive, OneDrive, or Both anytime.';
      setNotice({
        type: 'ok',
        text: odMsg,
      });
      setSweetSuccess({
        title: testConnection
          ? 'Microsoft OneDrive Connected!'
          : 'OneDrive Settings Saved!',
        badgeText: 'OneDrive Ready',
        message: odMsg,
        metaItems: [
          {
            label: 'OneDrive Status',
            value: json.config?.onedriveEnabled ? 'Connected & Active' : 'Not Configured',
            highlight: json.config?.onedriveEnabled ? 'green' : 'amber',
          },
          {
            label: 'Connection Mode',
            value:
              onedriveMode === 'graph_token'
                ? 'Microsoft Graph API Token'
                : 'Power Automate Webhook Bridge',
            highlight: 'blue',
          },
        ],
      });
    } catch (err: any) {
      setNotice({
        type: 'err',
        text: err?.message || 'Failed to test Microsoft OneDrive Bridge',
      });
    } finally {
      setSavingOneDrive(false);
    }
  };

  const handleCopyAppsScript = async () => {
    if (!scriptTemplate) return;
    try {
      await navigator.clipboard.writeText(scriptTemplate);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 3000);
    } catch {}
  };

  const handleCopyOneDriveTemplate = async () => {
    if (!onedriveTemplate) return;
    try {
      await navigator.clipboard.writeText(onedriveTemplate);
      setCopiedOneDriveTemplate(true);
      setTimeout(() => setCopiedOneDriveTemplate(false), 3000);
    } catch {}
  };

  const handleFillSampleFormat = () => {
    const sampleEquip = equipment.slice(0, 3);
    if (sampleEquip.length === 0) return;
    const lines = sampleEquip.map(
      (eq, idx) =>
        `${eq.EquipmentTagNo}_${idx === 0 ? 'Format-I' : idx === 1 ? 'Format-II' : 'BaseLine_UTG'}.pdf | https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view`
    );
    setBatchLinksText(lines.join('\n'));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* OPTIMIZED COMPACT CONTAINER (max-w-4xl instead of 1080px oversized box) */}
      <div className="w-full max-w-4xl max-h-[88vh] bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* COMPACT EXECUTIVE HEADER */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-400/25 flex items-center justify-center text-sky-400 shrink-0">
              <Upload className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold tracking-tight text-white truncate">
                  Cloud Report Sync &amp; Drive Switcher
                </h2>
                <span
                  className={`font-mono text-[10.5px] font-bold px-2 py-0.2 rounded-md border ${
                    activeProvider === 'both'
                      ? 'bg-purple-950/80 text-purple-300 border-purple-500/40'
                      : activeProvider === 'onedrive'
                      ? 'bg-sky-950/80 text-sky-300 border-sky-500/40'
                      : bridgeEnabled
                      ? 'bg-blue-950/80 text-blue-300 border-blue-500/40'
                      : 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                  }`}
                >
                  ● Active: {getActiveDestinationLabel()}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                Direct uploads without login · Switch between Google Drive, OneDrive, or Both · Scope: <b className="text-slate-300">{scopeLabel}</b>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 ml-2"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* STREAMLINED NAVIGATION DOCK */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-200/70 p-1 rounded-xl flex-wrap">
            <button
              type="button"
              onClick={() => {
                setActiveTab('bulk_upload');
                setNotice(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'bulk_upload'
                  ? 'bg-emerald-700 text-white shadow-2xs font-bold'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Direct Bulk Upload</span>
              {bulkQueue.length > 0 && (
                <span className="font-mono text-[10.5px] px-1.5 py-0.2 rounded-md bg-white/20 font-bold tabular-nums">
                  {bulkQueue.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('folder_sync');
                setNotice(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'folder_sync'
                  ? 'bg-sky-700 text-white shadow-2xs font-bold'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <FolderSync className="w-3.5 h-3.5" />
              <span>Folder Links Sync</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('drive_setup');
                  setNotice(null);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'drive_setup'
                    ? 'bg-slate-900 text-white shadow-2xs font-bold'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Drive Switcher &amp; Setup</span>
              </button>
            )}
          </div>

          {/* Quick External Folder Links */}
          <div className="flex items-center gap-2">
            {targetFolderUrl && (
              <a
                href={targetFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-md bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                title="Open Google Drive folder in new tab"
              >
                <HardDrive className="w-3 h-3 text-blue-600" />
                <span>Google Drive ↗</span>
              </a>
            )}
            {onedriveTargetFolderUrl && (
              <a
                href={onedriveTargetFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-md bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                title="Open OneDrive folder in new tab"
              >
                <Cloud className="w-3 h-3 text-sky-600" />
                <span>OneDrive ↗</span>
              </a>
            )}
          </div>
        </div>

        {/* SCROLLABLE MODAL BODY */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 text-xs flex-1">
          {notice && (
            <div
              className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 shadow-2xs ${
                notice.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                  : 'bg-rose-50 text-rose-900 border border-rose-200'
              }`}
            >
              {notice.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
          )}

          {/* =========================================================================
              TAB 1: DIRECT BULK UPLOAD (DRAG & DROP)
             ========================================================================= */}
          {activeTab === 'bulk_upload' && (
            <div className="space-y-3.5">
              {/* Compact Drag & Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingBulk(true);
                }}
                onDragLeave={() => setIsDraggingBulk(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingBulk(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleAddFilesToBulkQueue(e.dataTransfer.files);
                  }
                }}
                className={`p-5 rounded-xl border-2 border-dashed text-center transition-all ${
                  isDraggingBulk
                    ? 'border-sky-500 bg-sky-50/80 scale-[0.99]'
                    : 'border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50/80'
                }`}
              >
                <Upload className="w-6 h-6 text-emerald-700 mx-auto mb-1.5" />
                <div className="text-xs font-bold text-emerald-950">
                  Drag &amp; Drop PDF / Photo Reports Here (or Select Below)
                </div>
                <p className="text-[11px] text-emerald-800/80 mt-0.5 mb-2.5">
                  Target: <strong className="text-emerald-900">{getActiveDestinationLabel()}</strong> · Auto-matches Tag No. from filename (e.g. <code>101-V-01_Format-I.pdf</code>).
                </p>

                <div className="flex items-center justify-center gap-2.5 flex-wrap">
                  <label className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shadow-2xs transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Select Files from Device</span>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        if (e.target.files) {
                          handleAddFilesToBulkQueue(e.target.files);
                          e.target.value = '';
                        }
                      }}
                      className="hidden"
                    />
                  </label>

                  <div className="inline-flex items-center gap-1.5 text-xs text-slate-700 font-semibold bg-white px-2.5 py-1 rounded-lg border border-slate-300">
                    <span className="text-slate-500">Default Stage:</span>
                    <select
                      value={bulkDefaultStage ?? 'FormatIStatus'}
                      onChange={(e) => setBulkDefaultStage(e.target.value as ReportStageKey)}
                      className="text-xs font-bold bg-transparent border-none focus:outline-none cursor-pointer"
                    >
                      {REPORT_STAGE_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.short}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Queued Files Table */}
              {bulkQueue.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs space-y-0">
                  {/* Queue Control Bar */}
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-bold text-slate-900">
                        Queued Files ({bulkQueue.filter((i) => i.matchedEquipmentId).length} of {bulkQueue.length} matched)
                      </span>
                      <label className="inline-flex items-center gap-1.5 font-semibold text-emerald-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(bulkAutoComplete)}
                          onChange={(e) => setBulkAutoComplete(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <span>Auto-mark stage Completed</span>
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={uploadingBulk}
                        onClick={() =>
                          setPendingQueueDelete({ mode: 'clear_all', count: bulkQueue.length })
                        }
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer transition-colors"
                      >
                        Clear Queue
                      </button>
                      <button
                        type="button"
                        disabled={uploadingBulk}
                        onClick={handleRunBulkDirectUpload}
                        className="px-3.5 py-1 text-[11px] font-bold rounded-md bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {uploadingBulk
                            ? 'Uploading...'
                            : `Upload ${bulkQueue.filter((i) => i.matchedEquipmentId && i.status !== 'done').length} Matched Files`}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* High-Density Queue Rows */}
                  <div className="max-h-[260px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-100/90 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">File Name</th>
                          <th className="py-2 px-2.5 text-right">Size</th>
                          <th className="py-2 px-3">Target Equipment Tag *</th>
                          <th className="py-2 px-3">Stage</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-2 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bulkQueue.map((row, idx) => (
                          <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2 px-3 font-medium text-slate-900 truncate max-w-[200px]" title={row.fileName}>
                              {row.fileName}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                              {(row.sizeBytes / 1024).toFixed(1)} KB
                            </td>
                            <td className="py-2 px-3">
                              <select
                                value={row.matchedEquipmentId ?? ''}
                                disabled={row.status === 'uploading' || row.status === 'done'}
                                onChange={(e) => {
                                  const nextId = e.target.value;
                                  const foundEq = equipment.find((eq) => eq.id === nextId);
                                  setBulkQueue((prev) =>
                                    prev.map((p, i) =>
                                      i === idx
                                        ? {
                                            ...p,
                                            matchedEquipmentId: nextId,
                                            matchedEquipmentTag: foundEq?.EquipmentTagNo || '',
                                            matchedUnit: foundEq?.Unit || '',
                                          }
                                        : p
                                    )
                                  );
                                }}
                                className={`w-full max-w-[190px] px-2 py-1 text-xs font-bold rounded-md border cursor-pointer ${
                                  row.matchedEquipmentId
                                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                                    : 'bg-amber-50 text-amber-900 border-amber-300'
                                }`}
                              >
                                <option value="">-- Select Tag No --</option>
                                {equipment.map((eq) => (
                                  <option key={eq.id} value={eq.id}>
                                    {eq.EquipmentTagNo} ({eq.Unit})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 px-3">
                              <select
                                value={row.stage ?? 'FormatIStatus'}
                                disabled={row.status === 'uploading' || row.status === 'done'}
                                onChange={(e) => {
                                  const nextStage = e.target.value as ReportStageKey;
                                  setBulkQueue((prev) =>
                                    prev.map((p, i) =>
                                      i === idx ? { ...p, stage: nextStage } : p
                                    )
                                  );
                                }}
                                className="px-2 py-1 text-xs rounded-md border border-slate-300 bg-white font-medium cursor-pointer"
                              >
                                {REPORT_STAGE_OPTIONS.map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.short}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {row.status === 'ready' && (
                                <span className={`text-[11px] font-semibold ${row.matchedEquipmentId ? 'text-slate-600' : 'text-amber-700'}`}>
                                  {row.matchedEquipmentId ? 'Ready' : 'Tag Required'}
                                </span>
                              )}
                              {row.status === 'uploading' && (
                                <span className="text-[11px] font-bold text-sky-700 animate-pulse">
                                  Uploading...
                                </span>
                              )}
                              {row.status === 'done' && (
                                <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                                  <Check className="w-3 h-3" />
                                  <span>Saved</span>
                                </span>
                              )}
                              {row.status === 'error' && (
                                <span className="text-[11px] font-bold text-rose-700" title={row.errorMsg}>
                                  Failed
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center whitespace-nowrap">
                              {row.status === 'done' && row.resultUrl ? (
                                <a
                                  href={row.resultUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-700 hover:text-sky-900 font-bold text-[11px] inline-flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>View</span>
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  disabled={row.status === 'uploading'}
                                  onClick={() =>
                                    setPendingQueueDelete({ mode: 'single', item: row })
                                  }
                                  className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Remove from queue"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =========================================================================
              TAB 2: SYNC EXISTING FOLDER LINKS
             ========================================================================= */}
          {activeTab === 'folder_sync' && (
            <div className="space-y-3.5">
              <form onSubmit={handleScanPreview} className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/90 space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Shared Google Drive / OneDrive Folder URL
                    </label>
                    <input
                      type="text"
                      placeholder="https://drive.google.com/drive/folders/... (Shared as 'Anyone with link')"
                      value={folderUrl ?? ''}
                      onChange={(e) => setFolderUrl(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Default Stage
                    </label>
                    <select
                      value={defaultStage ?? 'FormatIStatus'}
                      onChange={(e) => setDefaultStage(e.target.value as ReportStageKey)}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600 cursor-pointer"
                    >
                      {REPORT_STAGE_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.short}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-700">
                      Or Batch Report Links (<code>Tag_Stage.pdf | URL</code>)
                    </label>
                    <button
                      type="button"
                      onClick={handleFillSampleFormat}
                      className="text-[10.5px] font-semibold text-sky-700 hover:text-sky-900 flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Insert Sample</span>
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    placeholder={`e.g.\nRPTU-R-1001A_Format-I.pdf | https://drive.google.com/file/d/...\n1U59-TT-4831_BaseLine_UTG.pdf | https://1drv.ms/b/...`}
                    value={batchLinksText ?? ''}
                    onChange={(e) => setBatchLinksText(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                  />
                </div>

                <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-slate-200">
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(autoCompleteStage)}
                      onChange={(e) => setAutoCompleteStage(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span>Auto-mark matched inspection stage as Completed</span>
                  </label>

                  <button
                    type="submit"
                    disabled={scanning}
                    className="px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold text-xs shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{scanning ? 'Scanning...' : 'Scan & Auto-Match Tags'}</span>
                  </button>
                </div>
              </form>

              {/* Preview Table */}
              {previewItems.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 text-xs">
                      Discovered Reports ({previewItems.filter((i) => i.matchedEquipmentId).length} of {previewItems.length} matched)
                    </span>
                    <button
                      type="button"
                      disabled={applying}
                      onClick={handleApplySync}
                      className="px-3 py-1 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-2xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{applying ? 'Applying...' : `Sync ${previewItems.filter((i) => i.matchedEquipmentId).length} Reports Live`}</span>
                    </button>
                  </div>

                  <div className="max-h-[240px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">File Name</th>
                          <th className="py-2 px-2.5">Provider</th>
                          <th className="py-2 px-3">Matched Equipment Tag</th>
                          <th className="py-2 px-3">Stage</th>
                          <th className="py-2 px-2.5 text-center">Verify</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previewItems.map((row, idx) => {
                          const badge = getProviderBadgeMeta(row.provider);
                          return (
                            <tr key={row.id} className="hover:bg-slate-50/70">
                              <td className="py-2 px-3 font-medium text-slate-900 truncate max-w-[190px]" title={row.fileName}>
                                {row.fileName}
                              </td>
                              <td className="py-2 px-2.5">
                                <span
                                  className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border"
                                  style={{
                                    background: badge.bg,
                                    color: badge.color,
                                    borderColor: badge.border,
                                  }}
                                >
                                  {badge.shortLabel}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <select
                                  value={row.matchedEquipmentId ?? ''}
                                  onChange={(e) => {
                                    const nextId = e.target.value;
                                    const foundEq = equipment.find((eq) => eq.id === nextId);
                                    setPreviewItems((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? {
                                              ...p,
                                              matchedEquipmentId: nextId,
                                              matchedEquipmentTag: foundEq?.EquipmentTagNo || '',
                                              matchedUnit: foundEq?.Unit || '',
                                            }
                                          : p
                                      )
                                    );
                                  }}
                                  className={`w-full max-w-[180px] px-2 py-1 text-xs font-bold rounded border cursor-pointer ${
                                    row.matchedEquipmentId
                                      ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                                      : 'bg-amber-50 text-amber-900 border-amber-300'
                                  }`}
                                >
                                  <option value="">-- Select Tag --</option>
                                  {equipment.map((eq) => (
                                    <option key={eq.id} value={eq.id}>
                                      {eq.EquipmentTagNo} ({eq.Unit})
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 px-3">
                                <select
                                  value={row.stage ?? 'FormatIStatus'}
                                  onChange={(e) => {
                                    const nextStage = e.target.value as ReportStageKey;
                                    setPreviewItems((prev) =>
                                      prev.map((p, i) =>
                                        i === idx ? { ...p, stage: nextStage } : p
                                      )
                                    );
                                  }}
                                  className="px-2 py-1 text-xs rounded border border-slate-300 bg-white font-medium cursor-pointer"
                                >
                                  {REPORT_STAGE_OPTIONS.map((opt) => (
                                    <option key={opt.key} value={opt.key}>
                                      {opt.short}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 px-2.5 text-center">
                                <a
                                  href={row.viewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-700 hover:text-sky-900 font-bold text-[11px] inline-flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>View</span>
                                </a>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =========================================================================
              TAB 3: ADMIN MULTI-CLOUD SWITCHER & DRIVE SETUP
             ========================================================================= */}
          {activeTab === 'drive_setup' && isAdmin && (
            <div className="space-y-3.5">
              {/* 3 Cloud Switcher Cards (Compact 3-Column Grid) */}
              <div className="p-3.5 rounded-xl bg-slate-50/90 border border-slate-200/90 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-sky-700" />
                    <span>Active Cloud Drive Switcher (1-Click Shift)</span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Existing uploads are never lost when switching
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {/* Option 1: Google Drive */}
                  <button
                    type="button"
                    disabled={switchingProvider}
                    onClick={() => handleSwitchActiveProvider('google_drive')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      activeProvider === 'google_drive'
                        ? 'border-blue-600 bg-blue-50/80 shadow-2xs'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-blue-900 flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5 text-blue-600" />
                        <span>Google Drive</span>
                      </span>
                      <span
                        className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded ${
                          activeProvider === 'google_drive'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {activeProvider === 'google_drive' ? 'ACTIVE' : 'Select'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug">
                      Save uploads to your central Google Drive folder.
                    </p>
                    <div className="text-[10.5px] font-semibold mt-1 text-slate-500">
                      {bridgeEnabled ? (
                        <span className="text-emerald-700 font-bold">● Connected</span>
                      ) : (
                        <span className="text-amber-700">○ Needs Setup</span>
                      )}
                    </div>
                  </button>

                  {/* Option 2: Microsoft OneDrive */}
                  <button
                    type="button"
                    disabled={switchingProvider}
                    onClick={() => handleSwitchActiveProvider('onedrive')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      activeProvider === 'onedrive'
                        ? 'border-sky-600 bg-sky-50/80 shadow-2xs'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-sky-950 flex items-center gap-1.5">
                        <Cloud className="w-3.5 h-3.5 text-sky-600" />
                        <span>Microsoft OneDrive</span>
                      </span>
                      <span
                        className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded ${
                          activeProvider === 'onedrive'
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {activeProvider === 'onedrive' ? 'ACTIVE' : 'Select'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug">
                      Save uploads to your Microsoft OneDrive folder.
                    </p>
                    <div className="text-[10.5px] font-semibold mt-1 text-slate-500">
                      {onedriveEnabled ? (
                        <span className="text-emerald-700 font-bold">● Connected</span>
                      ) : (
                        <span className="text-amber-700">○ Needs Setup</span>
                      )}
                    </div>
                  </button>

                  {/* Option 3: Both (Dual-Cloud) */}
                  <button
                    type="button"
                    disabled={switchingProvider}
                    onClick={() => handleSwitchActiveProvider('both')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      activeProvider === 'both'
                        ? 'border-indigo-600 bg-indigo-50/80 shadow-2xs'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-indigo-950 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Dual-Cloud Backup</span>
                      </span>
                      <span
                        className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded ${
                          activeProvider === 'both'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {activeProvider === 'both' ? 'ACTIVE' : 'Select'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug">
                      Save uploads simultaneously to BOTH Google Drive &amp; OneDrive.
                    </p>
                    <div className="text-[10.5px] font-semibold mt-1 text-slate-500">
                      {bridgeEnabled && onedriveEnabled ? (
                        <span className="text-emerald-700 font-bold">● Both Ready</span>
                      ) : (
                        <span className="text-indigo-700">● Dual Target</span>
                      )}
                    </div>
                  </button>
                </div>
              </div>

              {/* Sub-Tab Navigation for Bridge Configuration */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <button
                  type="button"
                  onClick={() => setSetupSubTab('google_drive')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                    setupSubTab === 'google_drive'
                      ? 'bg-blue-700 text-white shadow-2xs font-bold'
                      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Google Drive Bridge {bridgeEnabled ? '(✓)' : ''}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSetupSubTab('onedrive')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                    setupSubTab === 'onedrive'
                      ? 'bg-sky-700 text-white shadow-2xs font-bold'
                      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>OneDrive Bridge {onedriveEnabled ? '(✓)' : ''}</span>
                </button>
              </div>

              {/* SUB-TAB A: GOOGLE DRIVE BRIDGE */}
              {setupSubTab === 'google_drive' && (
                <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200/90 space-y-3 text-xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 font-bold text-blue-950">
                      <HardDrive className="w-4 h-4 text-blue-700" />
                      <span>Google Drive Web App Bridge</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyAppsScript}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {copiedScript ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedScript ? 'Copied Script!' : 'Copy Apps Script Code'}</span>
                    </button>
                  </div>

                  <div className="p-2.5 rounded-lg bg-white border border-blue-100 text-[11.5px] text-slate-600 space-y-1">
                    <div>
                      <strong>Step 1:</strong> Create a folder in Google Drive and paste its link in <b>Target Folder URL</b>.
                    </div>
                    <div>
                      <strong>Step 2:</strong> Paste script in <a href="https://script.google.com/home/start" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline font-semibold">script.google.com ↗</a> and deploy as Web App (<i>Execute as: Me</i>, <i>Who has access: Anyone</i>).
                    </div>
                    <div>
                      <strong>Step 3:</strong> Paste the <code>/exec</code> Web App URL below and click <b>Test &amp; Activate</b>.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        1. Target Google Drive Folder URL
                      </label>
                      <input
                        type="text"
                        placeholder="https://drive.google.com/drive/folders/..."
                        value={targetFolderUrl ?? ''}
                        onChange={(e) => setTargetFolderUrl(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        2. Apps Script Web App Bridge URL (<code>https://script.google.com/macros/s/.../exec</code>)
                      </label>
                      <input
                        type="url"
                        placeholder="https://script.google.com/macros/s/AKfy.../exec"
                        value={bridgeScriptUrl ?? ''}
                        onChange={(e) => setBridgeScriptUrl(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                    <label className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(organizeByUnitSubfolder)}
                        onChange={(e) => setOrganizeByUnitSubfolder(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <span>Auto-create Unit Subfolders (RPTU, MSP, UTILITY, etc.)</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={savingBridge}
                        onClick={() => handleSaveDriveBridge(false, false)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={savingBridge}
                        onClick={() => handleSaveDriveBridge(true, true)}
                        className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-blue-700 hover:bg-blue-800 text-white shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{savingBridge ? 'Testing...' : 'Test & Activate Google Drive'}</span>
                      </button>
                    </div>
                  </div>

                  {lastTestMessage && (
                    <div className="text-[11px] text-slate-600 font-mono">
                      Status: {lastTestMessage}
                    </div>
                  )}
                </div>
              )}

              {/* SUB-TAB B: MICROSOFT ONEDRIVE BRIDGE */}
              {setupSubTab === 'onedrive' && (
                <div className="p-3.5 rounded-xl bg-sky-50/50 border border-sky-200/90 space-y-3 text-xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 font-bold text-sky-950">
                      <Cloud className="w-4 h-4 text-sky-700" />
                      <span>Microsoft OneDrive / SharePoint Bridge</span>
                    </div>

                    {onedriveMode === 'webhook_bridge' && (
                      <button
                        type="button"
                        onClick={handleCopyOneDriveTemplate}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {copiedOneDriveTemplate ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedOneDriveTemplate ? 'Copied Schema!' : 'Copy OneDrive Schema'}</span>
                      </button>
                    )}
                  </div>

                  {/* Mode Selector */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setOnedriveMode('webhook_bridge')}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        onedriveMode === 'webhook_bridge'
                          ? 'border-sky-600 bg-white shadow-2xs'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="font-bold text-xs text-sky-950">
                        Method A: Webhook Bridge (Recommended)
                      </div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        Power Automate HTTP URL (No expiry)
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setOnedriveMode('graph_token')}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        onedriveMode === 'graph_token'
                          ? 'border-sky-600 bg-white shadow-2xs'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="font-bold text-xs text-sky-950">
                        Method B: Graph API Token
                      </div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        Direct token (<code>Files.ReadWrite</code>)
                      </div>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        1. Target Folder Path
                      </label>
                      <input
                        type="text"
                        placeholder="/NREP_Inspection_Reports"
                        value={onedriveFolderPath ?? '/NREP_Inspection_Reports'}
                        onChange={(e) => setOnedriveFolderPath(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        2. Web Folder Link (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="https://1drv.ms/f/s!..."
                        value={onedriveTargetFolderUrl ?? ''}
                        onChange={(e) => setOnedriveTargetFolderUrl(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {onedriveMode === 'webhook_bridge'
                        ? '3. Power Automate Webhook URL *'
                        : '3. Microsoft Graph Access Token *'}
                    </label>
                    {onedriveMode === 'webhook_bridge' ? (
                      <input
                        type="url"
                        placeholder="https://prod-xx.logic.azure.com:443/workflows/.../invoke?..."
                        value={onedriveBridgeUrl ?? ''}
                        onChange={(e) => setOnedriveBridgeUrl(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                      />
                    ) : (
                      <input
                        type="password"
                        placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIs..."
                        value={onedriveAccessToken ?? ''}
                        onChange={(e) => setOnedriveAccessToken(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-sky-600"
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                    <label className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(onedriveOrganizeByUnitSubfolder)}
                        onChange={(e) => setOnedriveOrganizeByUnitSubfolder(e.target.checked)}
                        className="rounded text-sky-600 focus:ring-sky-500 cursor-pointer"
                      />
                      <span>Auto-create Unit Subfolders (e.g. /NREP_Inspection_Reports/RPTU)</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={savingOneDrive}
                        onClick={() => handleSaveOneDriveBridge(false, false)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={savingOneDrive}
                        onClick={() => handleSaveOneDriveBridge(true, true)}
                        className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-sky-700 hover:bg-sky-800 text-white shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{savingOneDrive ? 'Testing...' : 'Test & Activate OneDrive'}</span>
                      </button>
                    </div>
                  </div>

                  {onedriveLastTestMessage && (
                    <div className="text-[11px] text-slate-600 font-mono">
                      Status: {onedriveLastTestMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* COMPACT FOOTER */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200/90 flex items-center justify-between text-[11.5px] text-slate-500 shrink-0">
          <span>
            Tip: Switch between <strong>Google Drive</strong>, <strong>OneDrive</strong>, or <strong>Both</strong> anytime in Tab 3.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>

      {/* Real-Time Upload Progress Popup */}
      <UploadProgressPopup
        open={uploadingBulk || applying}
        title={
          uploadingBulk
            ? `Uploading Bulk Reports to ${getActiveDestinationLabel()}...`
            : 'Synchronizing Cloud Folder Reports...'
        }
        fileName={activeUploadStep?.fileName}
        equipmentTag={activeUploadStep?.equipmentTag}
        stageLabel={activeUploadStep?.stageLabel}
        batchCurrent={activeUploadStep?.index}
        batchTotal={activeUploadStep?.total}
        destinationLabel={getActiveDestinationLabel()}
      />

      {/* Warning Confirmation for Queue Deletion */}
      <SweetWarningDeletePopup
        open={Boolean(pendingQueueDelete)}
        title={
          pendingQueueDelete?.mode === 'clear_all'
            ? 'Warning: Clear Entire Upload Queue?'
            : 'Warning: Remove File from Upload Queue?'
        }
        targetType={pendingQueueDelete?.mode === 'clear_all' ? 'Upload Queue' : 'Queued Report'}
        targetName={
          pendingQueueDelete?.mode === 'clear_all'
            ? `${pendingQueueDelete.count} Queued Report File(s)`
            : pendingQueueDelete?.item.fileName || ''
        }
        description={
          pendingQueueDelete?.mode === 'clear_all'
            ? `Are you sure you want to remove all ${pendingQueueDelete.count} file(s) from the bulk upload queue?`
            : `Are you sure you want to remove "${pendingQueueDelete?.item.fileName}" from the upload queue?`
        }
        warningNote="You can re-select the file from your computer/phone anytime."
        confirmLabel={
          pendingQueueDelete?.mode === 'clear_all' ? 'Yes, Clear Queue' : 'Yes, Remove File'
        }
        cancelLabel="Cancel, Keep"
        onCancel={() => setPendingQueueDelete(null)}
        onConfirm={() => {
          if (!pendingQueueDelete) return;
          if (pendingQueueDelete.mode === 'clear_all') {
            setBulkQueue([]);
          } else {
            const targetId = pendingQueueDelete.item.id;
            setBulkQueue((prev) => prev.filter((q) => q.id !== targetId));
          }
          setPendingQueueDelete(null);
        }}
      />

      {/* Success Popup */}
      <SweetSuccessPopup
        open={Boolean(sweetSuccess)}
        title={sweetSuccess?.title || 'Success!'}
        message={sweetSuccess?.message || ''}
        subtitle={sweetSuccess?.subtitle}
        badgeText={sweetSuccess?.badgeText}
        metaItems={sweetSuccess?.metaItems}
        confirmLabel="OK, Done!"
        onClose={() => setSweetSuccess(null)}
      />
    </div>
  );
}

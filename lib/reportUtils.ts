import {
  EquipmentItem,
  InspectionReportAttachment,
  ReportProvider,
  ReportStageKey,
  STATUS_COLUMNS,
} from './types';

export const REPORT_STAGE_OPTIONS: {
  key: ReportStageKey;
  label: string;
  short: string;
}[] = [
  { key: 'FormatIStatus', label: 'Format-I Inspection Report', short: 'Format-I' },
  { key: 'FormatIIStatus', label: 'Format-II Inspection Report', short: 'Format-II' },
  { key: 'FormatIIIStatus', label: 'Format-III Inspection Report', short: 'Format-III' },
  { key: 'FormatIVStatus', label: 'Format-IV Inspection Report', short: 'Format-IV' },
  { key: 'FormatVStatus', label: 'Format-V Inspection Report', short: 'Format-V' },
  {
    key: 'InternalInspectionStatus',
    label: 'Internal Inspection Report',
    short: 'Internal Insp.',
  },
  { key: 'BaseLineUTG', label: 'Base Line UTG Report', short: 'Base Line UTG' },
  { key: 'PMI', label: 'PMI Inspection Report', short: 'PMI' },
  {
    key: 'FinalSystemAcceptance',
    label: 'Final System Acceptance Certificate',
    short: 'Final Accept.',
  },
  { key: 'General', label: 'General Drawing / QCP / Dossier', short: 'Drawing / General' },
];

export function getStageLabel(stage: ReportStageKey): string {
  const found = REPORT_STAGE_OPTIONS.find((s) => s.key === stage);
  return found ? found.short : 'General';
}

/**
 * Detects the cloud provider ('google_drive' | 'onedrive' | 'supabase_storage' | 'external_link')
 * from a URL and normalizes it into both a direct viewUrl and an in-app iframe-safe embedUrl.
 */
export function normalizeReportUrl(rawUrl: string): {
  provider: ReportProvider;
  viewUrl: string;
  embedUrl: string;
  fileId?: string;
} {
  const url = (rawUrl || '').trim();
  if (!url) {
    return { provider: 'external_link', viewUrl: '', embedUrl: '' };
  }

  // 1. Google Drive file or Docs/Sheets/Slides URL
  if (/drive\.google\.com|docs\.google\.com/i.test(url)) {
    // Match /file/d/{ID} or /document/d/{ID} or /spreadsheets/d/{ID} or ?id={ID}
    const dMatch = url.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/i);
    const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
    const fileId = dMatch?.[1] || idParamMatch?.[1];

    if (fileId) {
      const viewUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
      const embedUrl = `https://drive.google.com/file/d/${fileId}/preview`;
      return {
        provider: 'google_drive',
        viewUrl,
        embedUrl,
        fileId,
      };
    }

    return {
      provider: 'google_drive',
      viewUrl: url,
      embedUrl: url.replace(/\/view(\?.*)?$/i, '/preview'),
    };
  }

  // 2. Microsoft OneDrive / SharePoint URL
  if (/1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(url)) {
    let embedUrl = url;
    if (/onedrive\.live\.com\/edit/i.test(url)) {
      embedUrl = url.replace(/\/edit/i, '/embed');
    } else if (/onedrive\.live\.com\/view/i.test(url)) {
      embedUrl = url.replace(/\/view/i, '/embed');
    } else if (/sharepoint\.com/i.test(url) && !url.includes('action=embedview')) {
      embedUrl = url.includes('?') ? `${url}&action=embedview` : `${url}?action=embedview`;
    }
    return {
      provider: 'onedrive',
      viewUrl: url,
      embedUrl,
    };
  }

  // 3. Supabase Object Storage URL
  if (/supabase\.co\/storage\/v1\/object/i.test(url) || url.includes('/inspection-reports/')) {
    return {
      provider: 'supabase_storage',
      viewUrl: url,
      embedUrl: url,
    };
  }

  // 4. Generic external URL (PDF / Image / Drawing link)
  return {
    provider: 'external_link',
    viewUrl: url,
    embedUrl: url,
  };
}

/**
 * Extracts a Google Drive Folder ID from a folder link or raw ID string.
 */
export function extractGoogleDriveFolderId(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/i);
  if (folderMatch?.[1]) return folderMatch[1];
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (idMatch?.[1]) return idMatch[1];
  if (/^[a-zA-Z0-9_-]{15,60}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Parses `EquipmentItem.DocumentDrawing` into:
 * - `drawingRef`: Optional drawing number/code (e.g., "NRL-RPTU-GA-1001A Rev.2")
 * - `reports`: Array of live `InspectionReportAttachment` items
 *
 * Fully backward-compatible with:
 * - Plain drawing number strings ("DWG-101")
 * - Plain URLs ("https://drive.google.com/...")
 * - Structured JSON payload (`{"drawingRef":"...","reports":[...]}`)
 */
export function parseEquipmentDocumentField(rawDoc?: string | null): {
  drawingRef: string;
  reports: InspectionReportAttachment[];
} {
  const val = (rawDoc || '').trim();
  if (!val) {
    return { drawingRef: '', reports: [] };
  }

  // 1. Check if structured JSON payload
  if (val.startsWith('{') && val.endsWith('}')) {
    try {
      const parsed = JSON.parse(val);
      if (parsed && (Array.isArray(parsed.reports) || typeof parsed.drawingRef === 'string')) {
        const reports: InspectionReportAttachment[] = (parsed.reports || [])
          .filter((r: any) => r && r.viewUrl)
          .map((r: any, idx: number) => {
            const norm = normalizeReportUrl(r.viewUrl);
            const stage: ReportStageKey = r.stage || 'General';
            return {
              id: r.id || `rep_${idx}_${Date.now()}`,
              title: r.title || `${getStageLabel(stage)} Report`,
              stage,
              stageLabel: r.stageLabel || getStageLabel(stage),
              provider: r.provider || norm.provider,
              viewUrl: norm.viewUrl || r.viewUrl,
              embedUrl: r.embedUrl || norm.embedUrl,
              fileId: r.fileId || norm.fileId,
              onedriveItemId: r.onedriveItemId,
              secondaryProvider: r.secondaryProvider,
              secondaryViewUrl: r.secondaryViewUrl,
              secondaryEmbedUrl: r.secondaryEmbedUrl,
              storagePath: r.storagePath,
              mimeType: r.mimeType,
              sizeBytes: r.sizeBytes,
              uploadedBy: r.uploadedBy || 'Authorized Engineer',
              uploadedAt: r.uploadedAt || new Date().toISOString(),
            };
          });
        return {
          drawingRef: typeof parsed.drawingRef === 'string' ? parsed.drawingRef : '',
          reports,
        };
      }
    } catch {
      // Fall through if not valid JSON
    }
  }

  // 2. Check if it's a single direct URL
  if (/^https?:\/\//i.test(val)) {
    const norm = normalizeReportUrl(val);
    const inferredStage = inferStageFromText(val);
    return {
      drawingRef: '',
      reports: [
        {
          id: 'rep_primary_link',
          title:
            norm.provider === 'google_drive'
              ? 'Google Drive Inspection Report'
              : norm.provider === 'onedrive'
              ? 'OneDrive Inspection Report'
              : norm.provider === 'supabase_storage'
              ? 'Uploaded Cloud Inspection Report'
              : 'Attached Document / Drawing',
          stage: inferredStage,
          stageLabel: getStageLabel(inferredStage),
          provider: norm.provider,
          viewUrl: norm.viewUrl,
          embedUrl: norm.embedUrl,
          uploadedBy: 'System',
          uploadedAt: '',
        },
      ],
    };
  }

  // 3. Otherwise it is a plain drawing reference number/code
  return {
    drawingRef: val,
    reports: [],
  };
}

/**
 * Serializes `drawingRef` and `reports` back into the `DocumentDrawing` string column.
 * - If there are no reports, returns `drawingRef` as a plain string.
 * - If there are reports (or both drawingRef and reports), serializes cleanly as JSON.
 */
export function serializeEquipmentDocumentField(
  drawingRef: string,
  reports: InspectionReportAttachment[]
): string {
  const cleanDrawing = (drawingRef || '').trim();
  if (!reports || reports.length === 0) {
    return cleanDrawing;
  }
  return JSON.stringify({
    drawingRef: cleanDrawing,
    reports,
  });
}

/**
 * Formats `DocumentDrawing` for clean human-readable Excel export.
 */
export function formatDocumentDrawingForExcel(rawDoc?: string | null): string {
  const { drawingRef, reports } = parseEquipmentDocumentField(rawDoc);
  const parts: string[] = [];
  if (drawingRef) parts.push(drawingRef);
  reports.forEach((r) => {
    parts.push(`${r.stageLabel}: ${r.viewUrl}`);
  });
  return parts.join(' | ');
}

/**
 * Infers which inspection stage a filename or URL corresponds to.
 * Supports patterns like:
 * - "Format-III", "Format_3", "FMT3", "F3" -> FormatIIIStatus
 * - "Format-II", "Format_2", "FMT2", "F2" -> FormatIIStatus
 * - "Format-I", "Format_1", "FMT1", "F1" -> FormatIStatus
 * - "Internal", "BoxUp", "Internal_Insp" -> InternalInspectionStatus
 * - "UTG", "Baseline", "Thickness" -> BaseLineUTG
 * - "Final", "Acceptance", "Handover", "FSA" -> FinalSystemAcceptance
 */
export function inferStageFromText(text: string): ReportStageKey {
  const s = (text || '').toLowerCase();
  if (/format[\s_-]*v\b|format[\s_-]*5|\bfmt[\s_-]*5\b|\bf5\b/i.test(s)) {
    return 'FormatVStatus';
  }
  if (/format[\s_-]*iv\b|format[\s_-]*4|\bfmt[\s_-]*4\b|\bf4\b/i.test(s)) {
    return 'FormatIVStatus';
  }
  if (/format[\s_-]*iii|format[\s_-]*3|\bfmt[\s_-]*3\b|\bf3\b/i.test(s)) {
    return 'FormatIIIStatus';
  }
  if (/format[\s_-]*ii\b|format[\s_-]*2|\bfmt[\s_-]*2\b|\bf2\b/i.test(s)) {
    return 'FormatIIStatus';
  }
  if (/format[\s_-]*i\b|format[\s_-]*1|\bfmt[\s_-]*1\b|\bf1\b/i.test(s)) {
    return 'FormatIStatus';
  }
  if (/internal|box[\s_-]*up|vessel[\s_-]*entry/i.test(s)) {
    return 'InternalInspectionStatus';
  }
  if (/\butg\b|base[\s_-]*line|ultrasonic|thickness/i.test(s)) {
    return 'BaseLineUTG';
  }
  if (/\bpmi\b|positive[\s_-]*material/i.test(s)) {
    return 'PMI';
  }
  if (/final[\s_-]*accept|handover|\bfsa\b|acceptance[\s_-]*cert/i.test(s)) {
    return 'FinalSystemAcceptance';
  }
  return 'General';
}

/**
 * Matches a file name or title (e.g., "101-V-01_Format-I.pdf" or "RPTU-R-1001A Final Acceptance.pdf")
 * against a list of `EquipmentItem` records.
 */
export function matchFileToEquipment(
  fileNameOrLine: string,
  equipmentList: EquipmentItem[]
): {
  matchedEquipment: EquipmentItem | null;
  detectedStage: ReportStageKey;
} {
  const cleanText = (fileNameOrLine || '').trim();
  const upperText = cleanText.toUpperCase();
  const normalizedAlphaNum = upperText.replace(/[^A-Z0-9]/g, '');

  let bestMatch: EquipmentItem | null = null;
  let longestTagLen = 0;

  for (const item of equipmentList) {
    const tag = (item.EquipmentTagNo || '').trim().toUpperCase();
    if (!tag || tag.length < 3) continue;

    // Direct substring match
    if (upperText.includes(tag) && tag.length > longestTagLen) {
      bestMatch = item;
      longestTagLen = tag.length;
      continue;
    }

    // Normalized alphanumeric match (ignoring hyphens/spaces/underscores)
    const normTag = tag.replace(/[^A-Z0-9]/g, '');
    if (normTag.length >= 4 && normalizedAlphaNum.includes(normTag) && tag.length > longestTagLen) {
      bestMatch = item;
      longestTagLen = tag.length;
    }
  }

  return {
    matchedEquipment: bestMatch,
    detectedStage: inferStageFromText(cleanText),
  };
}

export function getProviderBadgeMeta(provider: ReportProvider): {
  label: string;
  shortLabel: string;
  bg: string;
  color: string;
  border: string;
} {
  switch (provider) {
    case 'google_drive':
      return {
        label: 'Google Drive Live',
        shortLabel: 'Google Drive',
        bg: '#eff6ff',
        color: '#1d4ed8',
        border: '#bfdbfe',
      };
    case 'onedrive':
      return {
        label: 'Microsoft OneDrive Live',
        shortLabel: 'OneDrive',
        bg: '#f0f9ff',
        color: '#0369a1',
        border: '#bae6fd',
      };
    case 'supabase_storage':
      return {
        label: 'Supabase Cloud Storage',
        shortLabel: 'Supabase PDF/Img',
        bg: '#ecfdf5',
        color: '#047857',
        border: '#a7f3d0',
      };
    default:
      return {
        label: 'Cloud Document Link',
        shortLabel: 'Cloud Link',
        bg: '#f8fafc',
        color: '#334155',
        border: '#cbd5e1',
      };
  }
}

export function getStageDoneValue(stage: ReportStageKey): {
  isStageColumn: boolean;
  doneValue?: string;
} {
  const col = STATUS_COLUMNS.find((c) => c.key === stage);
  if (!col) return { isStageColumn: false };
  return { isStageColumn: true, doneValue: col.doneValue };
}

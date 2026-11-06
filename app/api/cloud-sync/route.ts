import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseAdminClient,
  verifyAuthenticatedCaller,
  fetchAllEquipmentFromSupabase,
} from '@/lib/server-auth';
import {
  canUserAccessUnit,
  EquipmentItem,
  filterEquipmentByUserScope,
  InspectionReportAttachment,
  normalizeEquipmentRecord,
  ReportStageKey,
} from '@/lib/types';
import {
  extractGoogleDriveFolderId,
  getStageDoneValue,
  getStageLabel,
  matchFileToEquipment,
  normalizeReportUrl,
  parseEquipmentDocumentField,
  serializeEquipmentDocumentField,
} from '@/lib/reportUtils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface DiscoveredCloudFile {
  name: string;
  url: string;
  provider: 'google_drive' | 'onedrive' | 'external_link';
}

/**
 * Scans a shared Google Drive folder using either:
 * 1. Optional Google Drive OAuth accessToken (if provided)
 * 2. Google Drive's public embeddedfolderview HTML endpoint (works for any "Anyone with link" shared Drive folder without requiring API keys)
 */
async function scanGoogleDriveFolder(
  folderId: string,
  accessToken?: string
): Promise<DiscoveredCloudFile[]> {
  const discovered: DiscoveredCloudFile[] = [];

  // 1. Try Google Drive v3 API if access token is provided
  if (accessToken) {
    try {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const apiRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink)&pageSize=500`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        }
      );
      if (apiRes.ok) {
        const json = await apiRes.json();
        if (Array.isArray(json.files)) {
          for (const f of json.files) {
            if (f.mimeType === 'application/vnd.google-apps.folder') continue;
            discovered.push({
              name: String(f.name || f.id),
              url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view?usp=sharing`,
              provider: 'google_drive',
            });
          }
          if (discovered.length > 0) return discovered;
        }
      }
    } catch (err) {
      console.warn('Drive API token scan fallback note:', err);
    }
  }

  // 2. Fetch public/link-shared Google Drive Embedded Folder View HTML
  try {
    const embedRes = await fetch(
      `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        cache: 'no-store',
      }
    );

    if (embedRes.ok) {
      const html = await embedRes.text();
      // Match <a href="https://drive.google.com/file/d/{ID}/..." ...>...<div class="flip-entry-title">{TITLE}</div>
      const entryRegex =
        /<a[^>]+href="([^"]*\/file\/d\/([a-zA-Z0-9_-]+)[^"]*)"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/gi;
      let match: RegExpExecArray | null;
      const seenIds = new Set<string>();

      while ((match = entryRegex.exec(html)) !== null) {
        const fileId = match[2];
        const rawTitle = match[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .trim();

        if (fileId && rawTitle && !seenIds.has(fileId)) {
          seenIds.add(fileId);
          discovered.push({
            name: rawTitle,
            url: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
            provider: 'google_drive',
          });
        }
      }
    }
  } catch (err) {
    console.warn('Embedded folder scan warning:', err);
  }

  return discovered;
}

export async function POST(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Unauthorized' },
      { status: caller.statusCode || 401 }
    );
  }

  if (!caller.canWriteEquipment) {
    return NextResponse.json(
      {
        ok: false,
        error: `Forbidden: Role "${caller.profile.role}" does not have permission to synchronize inspection reports.`,
      },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const action = String(body.action || 'preview');

    // Fetch equipment scoped to the caller's allowed units
    const rows = await fetchAllEquipmentFromSupabase(sbAdmin);

    const allEquipment = (rows || []).map((r) => normalizeEquipmentRecord(r));
    const scopedEquipment = !caller.isAdmin
      ? filterEquipmentByUserScope(allEquipment, caller.profile)
      : allEquipment;

    // ACTION 1: Preview / Scan a Google Drive Folder or Batch of Google Drive / OneDrive Links
    if (action === 'preview') {
      const folderInput = String(body.folderUrl || '').trim();
      const batchText = String(body.batchLinksText || '').trim();
      const googleAccessToken = String(body.googleAccessToken || '').trim() || undefined;
      const defaultStage: ReportStageKey =
        (body.defaultStage as ReportStageKey) || 'FormatIStatus';

      const candidateFiles: DiscoveredCloudFile[] = [];

      if (folderInput) {
        const folderId = extractGoogleDriveFolderId(folderInput);
        if (folderId) {
          const scanned = await scanGoogleDriveFolder(folderId, googleAccessToken);
          candidateFiles.push(...scanned);
        }
      }

      if (batchText) {
        // Parse lines of format:
        // "101-V-01_Format-I.pdf | https://drive.google.com/..."
        // or "101-V-01 https://1drv.ms/..."
        // or direct URLs
        const lines = batchText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);

        for (const line of lines) {
          const urlMatch = line.match(/https?:\/\/[^\s|,;]+/i);
          if (!urlMatch) continue;
          const url = urlMatch[0];
          const remainingText = line
            .replace(url, '')
            .replace(/^[|\-,:;]+|[|\-,:;]+$/g, '')
            .trim();
          const norm = normalizeReportUrl(url);
          candidateFiles.push({
            name: remainingText || url,
            url: norm.viewUrl,
            provider:
              norm.provider === 'google_drive'
                ? 'google_drive'
                : norm.provider === 'onedrive'
                ? 'onedrive'
                : 'external_link',
          });
        }
      }

      const matchedPreview = candidateFiles.map((file, idx) => {
        const { matchedEquipment, detectedStage } = matchFileToEquipment(
          file.name,
          scopedEquipment
        );
        const resolvedStage =
          detectedStage !== 'General' ? detectedStage : defaultStage;
        const norm = normalizeReportUrl(file.url);

        return {
          id: `sync_${idx}_${Date.now()}`,
          fileName: file.name,
          viewUrl: norm.viewUrl,
          embedUrl: norm.embedUrl,
          provider: norm.provider,
          matchedEquipmentId: matchedEquipment?.id || '',
          matchedEquipmentTag: matchedEquipment?.EquipmentTagNo || '',
          matchedUnit: matchedEquipment?.Unit || '',
          matchedDescription: matchedEquipment?.EquipmentDescription || '',
          stage: resolvedStage,
          stageLabel: getStageLabel(resolvedStage),
        };
      });

      return NextResponse.json({
        ok: true,
        discoveredCount: candidateFiles.length,
        matchedCount: matchedPreview.filter((m) => Boolean(m.matchedEquipmentId)).length,
        items: matchedPreview,
      });
    }

    // ACTION 2: Apply / Commit Synchronized Cloud Reports to Live Supabase Equipment Records
    if (action === 'apply') {
      const syncItems: {
        equipmentId: string;
        fileName: string;
        viewUrl: string;
        stage: ReportStageKey;
      }[] = Array.isArray(body.items) ? body.items : [];
      const autoCompleteStage = body.autoCompleteStage !== false;

      if (syncItems.length === 0) {
        return NextResponse.json(
          { ok: false, error: 'No matched report items provided to synchronize.' },
          { status: 400 }
        );
      }

      const equipMap = new Map<string, EquipmentItem>();
      scopedEquipment.forEach((eq) => {
        equipMap.set(eq.id, eq);
        equipMap.set(eq.EquipmentTagNo.toUpperCase(), eq);
      });

      const nowIso = new Date().toISOString();
      const todayDate = nowIso.slice(0, 10);
      const actorEmail = caller.profile.email;
      const updatedMap = new Map<string, EquipmentItem>();
      let syncedReportCount = 0;

      for (const entry of syncItems) {
        if (!entry.equipmentId || !entry.viewUrl) continue;
        const target =
          updatedMap.get(entry.equipmentId) ||
          equipMap.get(entry.equipmentId) ||
          equipMap.get(entry.equipmentId.toUpperCase());

        if (!target) continue;
        if (!canUserAccessUnit(caller.profile, target.Unit)) continue;

        const norm = normalizeReportUrl(entry.viewUrl);
        const stage: ReportStageKey = entry.stage || 'FormatIStatus';
        const parsedDoc = parseEquipmentDocumentField(target.DocumentDrawing);

        // Deduplicate by viewUrl + stage so repeated syncs update cleanly instead of duplicating
        const filteredExisting = parsedDoc.reports.filter(
          (r) => !(r.viewUrl === norm.viewUrl && r.stage === stage)
        );

        const newAttachment: InspectionReportAttachment = {
          id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: entry.fileName || `${getStageLabel(stage)} Report`,
          stage,
          stageLabel: getStageLabel(stage),
          provider: norm.provider,
          viewUrl: norm.viewUrl,
          embedUrl: norm.embedUrl,
          uploadedBy: actorEmail,
          uploadedAt: nowIso,
        };

        const nextReports = [newAttachment, ...filteredExisting];
        const serializedDoc = serializeEquipmentDocumentField(
          parsedDoc.drawingRef,
          nextReports
        );

        const stageUpdates: Partial<EquipmentItem> = {};
        if (autoCompleteStage) {
          const doneMeta = getStageDoneValue(stage);
          if (doneMeta.isStageColumn && doneMeta.doneValue) {
            (stageUpdates as any)[stage] = doneMeta.doneValue;
            if (stage === 'FormatIStatus' && !target.FormatIDate) {
              stageUpdates.FormatIDate = todayDate;
            } else if (stage === 'FormatIIStatus' && !target.FormatIIDate) {
              stageUpdates.FormatIIDate = todayDate;
            } else if (stage === 'FormatIIIStatus' && !target.FormatIIIDate) {
              stageUpdates.FormatIIIDate = todayDate;
            }
          }
        }

        const nextRecord = normalizeEquipmentRecord({
          ...target,
          ...stageUpdates,
          DocumentDrawing: serializedDoc,
          updatedBy: actorEmail,
          updatedAt: nowIso,
        });

        updatedMap.set(nextRecord.id, nextRecord);
        syncedReportCount++;
      }

      const recordsToUpsert = Array.from(updatedMap.values());
      if (recordsToUpsert.length > 0) {
        const { error: upsertErr } = await sbAdmin
          .from('equipment')
          .upsert(recordsToUpsert, { onConflict: 'id' });

        if (upsertErr) {
          return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
        }

        try {
          await sbAdmin.from('audit_logs').insert({
            id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            action: 'SYNC_CLOUD_REPORTS',
            target: `${recordsToUpsert.length} Equipment Tags`,
            userEmail: actorEmail,
            timestamp: nowIso,
            details: `Synchronized ${syncedReportCount} live cloud inspection reports (Google Drive / OneDrive) across ${recordsToUpsert.length} equipment tags`,
          });
        } catch {}
      }

      return NextResponse.json({
        ok: true,
        syncedReportCount,
        updatedEquipmentCount: recordsToUpsert.length,
        updatedEquipment: recordsToUpsert,
      });
    }

    return NextResponse.json({ ok: false, error: 'Unsupported action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Cloud synchronization failed' },
      { status: 500 }
    );
  }
}

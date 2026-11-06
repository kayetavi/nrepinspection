import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient, verifyAuthenticatedCaller } from '@/lib/server-auth';
import {
  canUserAccessUnit,
  InspectionReportAttachment,
  normalizeEquipmentRecord,
  toDatabaseEquipmentRow,
  ReportStageKey,
} from '@/lib/types';
import {
  getStageDoneValue,
  getStageLabel,
  normalizeReportUrl,
  parseEquipmentDocumentField,
  serializeEquipmentDocumentField,
} from '@/lib/reportUtils';
import {
  loadDriveBridgeConfig,
  uploadFileViaDriveBridge,
  uploadFileViaOneDriveBridge,
  deleteFileViaDriveBridge,
  deleteFileViaOneDriveBridge,
  extractGoogleDriveFileId,
  resolveEffectiveActiveProvider,
} from '@/lib/driveBridge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BUCKET_NAME = 'inspection-reports';

function inferMimeTypeFromFile(fileName: string, rawType?: string): string {
  const cleanType = (rawType || '').trim().toLowerCase();
  if (cleanType.startsWith('image/') || cleanType === 'application/pdf') {
    return cleanType;
  }
  const lowerName = (fileName || '').trim().toLowerCase();
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  return 'application/pdf';
}

async function ensureInspectionReportsBucket(sbAdmin: any) {
  try {
    const { data: buckets } = await sbAdmin.storage.listBuckets();
    const exists = (buckets || []).some((b: any) => b.name === BUCKET_NAME || b.id === BUCKET_NAME);
    if (!exists) {
      await sbAdmin.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: 20 * 1024 * 1024, // 20 MB per file
      });
    }
  } catch (err) {
    console.warn('Bucket check warning:', err);
  }
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
        error: `Forbidden: Role "${caller.profile.role}" cannot upload or attach inspection reports.`,
      },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);
    const actorEmail = caller.profile.email;

    let equipmentId = '';
    let stage: ReportStageKey = 'FormatIStatus';
    let title = '';
    let autoCompleteStage = true;
    let drawingRefOverride: string | undefined = undefined;
    let newAttachment: InspectionReportAttachment | null = null;
    let storageDestination:
      | 'google_drive'
      | 'onedrive'
      | 'both'
      | 'supabase_storage'
      | 'cloud_link' = 'cloud_link';
    let driveBridgeWarning: string | undefined = undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      equipmentId = String(formData.get('equipmentId') || '').trim();
      stage = (String(formData.get('stage') || 'FormatIStatus').trim() as ReportStageKey) || 'FormatIStatus';
      title = String(formData.get('title') || '').trim();
      autoCompleteStage = String(formData.get('autoCompleteStage') ?? 'true') !== 'false';
      if (formData.has('drawingRef')) {
        drawingRefOverride = String(formData.get('drawingRef') || '').trim();
      }

      if (!file || !equipmentId) {
        return NextResponse.json(
          { ok: false, error: 'Both equipmentId and file are required for upload.' },
          { status: 400 }
        );
      }

      if (file.size > 20 * 1024 * 1024) {
        return NextResponse.json(
          { ok: false, error: 'File size exceeds the 20 MB limit.' },
          { status: 400 }
        );
      }

      // Fetch target equipment to verify unit scope before uploading
      const { data: existingRow, error: fetchErr } = await sbAdmin
        .from('equipment')
        .select('*')
        .eq('id', equipmentId)
        .maybeSingle();

      if (fetchErr || !existingRow) {
        return NextResponse.json(
          { ok: false, error: 'Target equipment record not found in database.' },
          { status: 404 }
        );
      }

      const currentEquip = normalizeEquipmentRecord(existingRow);
      if (!canUserAccessUnit(caller.profile, currentEquip.Unit)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Forbidden: Your account is scoped to "${caller.profile.assignedUnits}" and cannot upload reports to unit "${currentEquip.Unit}".`,
          },
          { status: 403 }
        );
      }

      const safeUnit = currentEquip.Unit.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeTag = currentEquip.EquipmentTagNo.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const stageShort = getStageLabel(stage).replace(/[^a-zA-Z0-9_-]/g, '_');
      const standardizedDriveFileName = safeFileName
        .toUpperCase()
        .includes(safeTag.toUpperCase())
        ? safeFileName
        : `${currentEquip.EquipmentTagNo}_${stageShort}_${safeFileName}`;

      const resolvedMimeType = inferMimeTypeFromFile(file.name, file.type);
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      // Load Admin's Central Multi-Cloud Bridge Configuration
      const bridgeConfig = await loadDriveBridgeConfig(sbAdmin);
      const effectiveMode = resolveEffectiveActiveProvider(bridgeConfig);
      const warnings: string[] = [];

      const shouldUploadGoogle =
        (effectiveMode === 'google_drive' || effectiveMode === 'both') &&
        bridgeConfig.enabled &&
        Boolean(bridgeConfig.bridgeScriptUrl);

      const shouldUploadOneDrive =
        (effectiveMode === 'onedrive' || effectiveMode === 'both') &&
        bridgeConfig.onedriveEnabled &&
        Boolean(
          bridgeConfig.onedriveMode === 'graph_token'
            ? bridgeConfig.onedriveAccessToken
            : bridgeConfig.onedriveBridgeUrl
        );

      if ((effectiveMode === 'google_drive' || effectiveMode === 'both') && !shouldUploadGoogle) {
        warnings.push('Google Drive Bridge is not yet configured.');
      }
      if ((effectiveMode === 'onedrive' || effectiveMode === 'both') && !shouldUploadOneDrive) {
        warnings.push('Microsoft OneDrive Bridge is not yet configured.');
      }

      const [googleRes, onedriveRes] = await Promise.all([
        shouldUploadGoogle
          ? uploadFileViaDriveBridge({
              bridgeConfig,
              fileBuffer,
              fileName: standardizedDriveFileName,
              mimeType: resolvedMimeType,
              unitName: currentEquip.Unit,
              equipmentTag: currentEquip.EquipmentTagNo,
              stageLabel: getStageLabel(stage),
            })
          : Promise.resolve(null),
        shouldUploadOneDrive
          ? uploadFileViaOneDriveBridge({
              bridgeConfig,
              fileBuffer,
              fileName: standardizedDriveFileName,
              mimeType: resolvedMimeType,
              unitName: currentEquip.Unit,
              equipmentTag: currentEquip.EquipmentTagNo,
              stageLabel: getStageLabel(stage),
            })
          : Promise.resolve(null),
      ]);

      if (googleRes && !googleRes.ok && googleRes.error) {
        warnings.push(`Google Drive: ${googleRes.error}`);
      }
      if (onedriveRes && !onedriveRes.ok && onedriveRes.error) {
        warnings.push(`OneDrive: ${onedriveRes.error}`);
      }

      const googleOk = Boolean(googleRes?.ok && googleRes.viewUrl);
      const onedriveOk = Boolean(onedriveRes?.ok && onedriveRes.viewUrl);

      if (googleOk && onedriveOk && googleRes && onedriveRes) {
        storageDestination = 'both';
        newAttachment = {
          id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: title || googleRes.fileName || standardizedDriveFileName,
          stage,
          stageLabel: getStageLabel(stage),
          provider: 'google_drive',
          viewUrl: googleRes.viewUrl!,
          embedUrl: googleRes.embedUrl || googleRes.viewUrl!,
          fileId: googleRes.fileId,
          onedriveItemId: onedriveRes.fileId,
          secondaryProvider: 'onedrive',
          secondaryViewUrl: onedriveRes.viewUrl!,
          secondaryEmbedUrl: onedriveRes.embedUrl || onedriveRes.viewUrl!,
          mimeType: resolvedMimeType,
          sizeBytes: file.size,
          uploadedBy: actorEmail,
          uploadedAt: nowIso,
        };
      } else if (googleOk && googleRes) {
        storageDestination = 'google_drive';
        newAttachment = {
          id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: title || googleRes.fileName || standardizedDriveFileName,
          stage,
          stageLabel: getStageLabel(stage),
          provider: 'google_drive',
          viewUrl: googleRes.viewUrl!,
          embedUrl: googleRes.embedUrl || googleRes.viewUrl!,
          fileId: googleRes.fileId,
          mimeType: resolvedMimeType,
          sizeBytes: file.size,
          uploadedBy: actorEmail,
          uploadedAt: nowIso,
        };
      } else if (onedriveOk && onedriveRes) {
        storageDestination = 'onedrive';
        newAttachment = {
          id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: title || onedriveRes.fileName || standardizedDriveFileName,
          stage,
          stageLabel: getStageLabel(stage),
          provider: 'onedrive',
          viewUrl: onedriveRes.viewUrl!,
          embedUrl: onedriveRes.embedUrl || onedriveRes.viewUrl!,
          onedriveItemId: onedriveRes.fileId,
          mimeType: resolvedMimeType,
          sizeBytes: file.size,
          uploadedBy: actorEmail,
          uploadedAt: nowIso,
        };
      }

      if (warnings.length > 0) {
        driveBridgeWarning = warnings.join(' | ');
      }

      // 2. Fallback (or primary if activeProvider === 'supabase_storage'): Upload to Supabase Cloud Storage bucket
      if (!newAttachment) {
        await ensureInspectionReportsBucket(sbAdmin);
        const storagePath = `${safeUnit}/${safeTag}/${stage}_${Date.now()}_${safeFileName}`;

        const { error: uploadErr } = await sbAdmin.storage
          .from(BUCKET_NAME)
          .upload(storagePath, fileBuffer, {
            contentType: resolvedMimeType,
            upsert: true,
          });

        if (uploadErr) {
          return NextResponse.json(
            {
              ok: false,
              error: driveBridgeWarning
                ? `Cloud Bridge error (${driveBridgeWarning}) and fallback storage failed: ${uploadErr.message}`
                : `Storage upload failed: ${uploadErr.message}`,
            },
            { status: 500 }
          );
        }

        const { data: pubData } = sbAdmin.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
        const publicUrl = pubData?.publicUrl || '';
        storageDestination = 'supabase_storage';

        newAttachment = {
          id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: title || file.name || `${getStageLabel(stage)} Report`,
          stage,
          stageLabel: getStageLabel(stage),
          provider: 'supabase_storage',
          viewUrl: publicUrl,
          embedUrl: publicUrl,
          storagePath,
          mimeType: resolvedMimeType,
          sizeBytes: file.size,
          uploadedBy: actorEmail,
          uploadedAt: nowIso,
        };
      } else if (resolvedMimeType.startsWith('image/')) {
        // Also mirror image files to Supabase Storage so direct in-app image rendering works instantaneously alongside Google Drive / OneDrive
        try {
          await ensureInspectionReportsBucket(sbAdmin);
          const mirrorPath = `${safeUnit}/${safeTag}/${stage}_${Date.now()}_${safeFileName}`;
          const { error: mirrorErr } = await sbAdmin.storage
            .from(BUCKET_NAME)
            .upload(mirrorPath, fileBuffer, {
              contentType: resolvedMimeType,
              upsert: true,
            });
          if (!mirrorErr) {
            const { data: pubData } = sbAdmin.storage.from(BUCKET_NAME).getPublicUrl(mirrorPath);
            if (pubData?.publicUrl) {
              newAttachment.storagePath = mirrorPath;
              if (!newAttachment.secondaryViewUrl) {
                newAttachment.secondaryProvider = 'supabase_storage';
                newAttachment.secondaryViewUrl = pubData.publicUrl;
                newAttachment.secondaryEmbedUrl = pubData.publicUrl;
              }
            }
          }
        } catch {}
      }
    } else {
      const body = await req.json();
      equipmentId = String(body.equipmentId || '').trim();
      stage = (String(body.stage || 'FormatIStatus').trim() as ReportStageKey) || 'FormatIStatus';
      title = String(body.title || '').trim();
      const rawUrl = String(body.url || body.viewUrl || '').trim();
      autoCompleteStage = body.autoCompleteStage !== false;
      if (typeof body.drawingRef === 'string') {
        drawingRefOverride = body.drawingRef.trim();
      }

      if (!equipmentId || !rawUrl) {
        return NextResponse.json(
          { ok: false, error: 'equipmentId and report URL (Google Drive / OneDrive / Link) are required.' },
          { status: 400 }
        );
      }

      const norm = normalizeReportUrl(rawUrl);
      newAttachment = {
        id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title:
          title ||
          `${getStageLabel(stage)} (${
            norm.provider === 'google_drive'
              ? 'Google Drive'
              : norm.provider === 'onedrive'
              ? 'OneDrive'
              : 'Cloud Link'
          })`,
        stage,
        stageLabel: getStageLabel(stage),
        provider: norm.provider,
        viewUrl: norm.viewUrl,
        embedUrl: norm.embedUrl,
        fileId: norm.fileId,
        uploadedBy: actorEmail,
        uploadedAt: nowIso,
      };
    }

    // Fetch equipment row and update DocumentDrawing + optional stage status
    const { data: existingRow, error: rowErr } = await sbAdmin
      .from('equipment')
      .select('*')
      .eq('id', equipmentId)
      .maybeSingle();

    if (rowErr || !existingRow) {
      return NextResponse.json(
        { ok: false, error: 'Equipment record not found.' },
        { status: 404 }
      );
    }

    const currentEquip = normalizeEquipmentRecord(existingRow);
    if (!canUserAccessUnit(caller.profile, currentEquip.Unit)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Forbidden: Your account is scoped to "${caller.profile.assignedUnits}" and cannot modify equipment in "${currentEquip.Unit}".`,
        },
        { status: 403 }
      );
    }

    const parsedDoc = parseEquipmentDocumentField(currentEquip.DocumentDrawing);
    const updatedDrawingRef =
      drawingRefOverride !== undefined ? drawingRefOverride : parsedDoc.drawingRef;

    const updatedReports = [newAttachment!, ...parsedDoc.reports];
    const serializedDoc = serializeEquipmentDocumentField(updatedDrawingRef, updatedReports);

    const stageUpdates: Partial<typeof currentEquip> = {};
    if (autoCompleteStage) {
      const doneMeta = getStageDoneValue(stage);
      if (doneMeta.isStageColumn && doneMeta.doneValue) {
        (stageUpdates as any)[stage] = doneMeta.doneValue;
        if (stage === 'FormatIStatus' && !currentEquip.FormatIDate) {
          stageUpdates.FormatIDate = todayDate;
        } else if (stage === 'FormatIIStatus' && !currentEquip.FormatIIDate) {
          stageUpdates.FormatIIDate = todayDate;
        } else if (stage === 'FormatIIIStatus' && !currentEquip.FormatIIIDate) {
          stageUpdates.FormatIIIDate = todayDate;
        } else if (stage === 'FormatIVStatus' && !currentEquip.FormatIVDate) {
          stageUpdates.FormatIVDate = todayDate;
        } else if (stage === 'FormatVStatus' && !currentEquip.FormatVDate) {
          stageUpdates.FormatVDate = todayDate;
        }
      }
    }

    const updatedRecord = normalizeEquipmentRecord({
      ...currentEquip,
      ...stageUpdates,
      DocumentDrawing: serializedDoc,
      updatedBy: actorEmail,
      updatedAt: nowIso,
    });

    const { error: saveErr } = await sbAdmin
      .from('equipment')
      .upsert(toDatabaseEquipmentRow(updatedRecord), { onConflict: 'id' });

    if (saveErr) {
      return NextResponse.json({ ok: false, error: saveErr.message }, { status: 500 });
    }

    // Record audit log
    try {
      await sbAdmin.from('audit_logs').insert({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        action:
          newAttachment!.provider === 'supabase_storage'
            ? 'UPLOAD_REPORT'
            : 'ATTACH_CLOUD_REPORT',
        target: currentEquip.EquipmentTagNo,
        userEmail: actorEmail,
        timestamp: nowIso,
        details: `Attached ${newAttachment!.stageLabel} report "${newAttachment!.title}" (${storageDestination}) to ${currentEquip.EquipmentTagNo} (${currentEquip.Unit})`,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      attachment: newAttachment,
      equipment: updatedRecord,
      storageDestination,
      driveBridgeWarning,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to upload or attach inspection report' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Unauthorized' },
      { status: caller.statusCode || 401 }
    );
  }

  if (!caller.canWriteEquipment) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Insufficient permissions to remove inspection reports.' },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const equipmentId = String(body.equipmentId || '').trim();
    const attachmentId = String(body.attachmentId || '').trim();

    if (!equipmentId || !attachmentId) {
      return NextResponse.json(
        { ok: false, error: 'equipmentId and attachmentId are required.' },
        { status: 400 }
      );
    }

    const { data: existingRow, error: rowErr } = await sbAdmin
      .from('equipment')
      .select('*')
      .eq('id', equipmentId)
      .maybeSingle();

    if (rowErr || !existingRow) {
      return NextResponse.json(
        { ok: false, error: 'Equipment record not found.' },
        { status: 404 }
      );
    }

    const currentEquip = normalizeEquipmentRecord(existingRow);
    if (!canUserAccessUnit(caller.profile, currentEquip.Unit)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Forbidden: Cannot modify reports for unit "${currentEquip.Unit}".`,
        },
        { status: 403 }
      );
    }

    const parsedDoc = parseEquipmentDocumentField(currentEquip.DocumentDrawing);
    const targetAttachment = parsedDoc.reports.find((r) => r.id === attachmentId);
    const remainingReports = parsedDoc.reports.filter((r) => r.id !== attachmentId);

    // 1. If stored in Supabase Storage bucket, delete the underlying file object
    if (targetAttachment?.storagePath) {
      try {
        await sbAdmin.storage.from(BUCKET_NAME).remove([targetAttachment.storagePath]);
      } catch (rmErr) {
        console.warn('Storage object removal note:', rmErr);
      }
    }

    const bridgeConfig = await loadDriveBridgeConfig(sbAdmin);

    // 2. If stored in Google Drive (primary or secondary), move the file to Google Drive Trash via the Bridge
    let driveDeleteStatus: { attempted: boolean; trashedInDrive: boolean; note?: string } = {
      attempted: false,
      trashedInDrive: false,
    };
    if (
      targetAttachment &&
      (targetAttachment.provider === 'google_drive' ||
        targetAttachment.secondaryProvider === 'google_drive' ||
        /drive\.google\.com/i.test(targetAttachment.viewUrl || '') ||
        /drive\.google\.com/i.test(targetAttachment.secondaryViewUrl || ''))
    ) {
      const driveFileId =
        targetAttachment.fileId ||
        extractGoogleDriveFileId(targetAttachment.viewUrl) ||
        extractGoogleDriveFileId(targetAttachment.secondaryViewUrl);
      if (driveFileId) {
        driveDeleteStatus.attempted = true;
        try {
          if (bridgeConfig.enabled && bridgeConfig.bridgeScriptUrl) {
            const delRes = await deleteFileViaDriveBridge({
              bridgeConfig,
              fileId: driveFileId,
            });
            driveDeleteStatus.trashedInDrive = Boolean(delRes.ok && delRes.trashedInDrive);
            if (!delRes.ok) {
              driveDeleteStatus.note = delRes.error;
            }
          }
        } catch (driveDelErr: any) {
          driveDeleteStatus.note = driveDelErr?.message;
        }
      }
    }

    // 3. If stored in Microsoft OneDrive (primary or secondary), delete the file via OneDrive Bridge
    let onedriveDeleteStatus: { attempted: boolean; deletedInOneDrive: boolean; note?: string } = {
      attempted: false,
      deletedInOneDrive: false,
    };
    if (
      targetAttachment &&
      (targetAttachment.provider === 'onedrive' ||
        targetAttachment.secondaryProvider === 'onedrive' ||
        Boolean(targetAttachment.onedriveItemId) ||
        /1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(targetAttachment.viewUrl || '') ||
        /1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(targetAttachment.secondaryViewUrl || ''))
    ) {
      if (bridgeConfig.onedriveEnabled) {
        onedriveDeleteStatus.attempted = true;
        try {
          const odRes = await deleteFileViaOneDriveBridge({
            bridgeConfig,
            itemId: targetAttachment.onedriveItemId,
            viewUrl:
              targetAttachment.provider === 'onedrive'
                ? targetAttachment.viewUrl
                : targetAttachment.secondaryViewUrl || targetAttachment.viewUrl,
          });
          onedriveDeleteStatus.deletedInOneDrive = Boolean(odRes.ok && odRes.deletedInOneDrive);
          if (!odRes.ok) {
            onedriveDeleteStatus.note = odRes.error;
          }
        } catch (odErr: any) {
          onedriveDeleteStatus.note = odErr?.message;
        }
      }
    }

    const serializedDoc = serializeEquipmentDocumentField(parsedDoc.drawingRef, remainingReports);
    const nowIso = new Date().toISOString();
    const actorEmail = caller.profile.email;

    const updatedRecord = normalizeEquipmentRecord({
      ...currentEquip,
      DocumentDrawing: serializedDoc,
      updatedBy: actorEmail,
      updatedAt: nowIso,
    });

    const { error: saveErr } = await sbAdmin
      .from('equipment')
      .upsert(toDatabaseEquipmentRow(updatedRecord), { onConflict: 'id' });

    if (saveErr) {
      return NextResponse.json({ ok: false, error: saveErr.message }, { status: 500 });
    }

    try {
      await sbAdmin.from('audit_logs').insert({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        action: 'DELETE_REPORT',
        target: currentEquip.EquipmentTagNo,
        userEmail: actorEmail,
        timestamp: nowIso,
        details: `Removed inspection report "${targetAttachment?.title || attachmentId}" from ${currentEquip.EquipmentTagNo}${
          driveDeleteStatus.trashedInDrive ? ' (Deleted in Google Drive)' : ''
        }${onedriveDeleteStatus.deletedInOneDrive ? ' (Deleted in Microsoft OneDrive)' : ''}`,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      equipment: updatedRecord,
      driveDeleteStatus,
      onedriveDeleteStatus,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to delete inspection report' },
      { status: 500 }
    );
  }
}

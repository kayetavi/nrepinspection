import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient, verifyAuthenticatedCaller } from '@/lib/server-auth';
import {
  EquipmentItem,
  InspectionReportAttachment,
  normalizeEquipmentRecord,
  toDatabaseEquipmentRow,
} from '@/lib/types';
import {
  parseEquipmentDocumentField,
  serializeEquipmentDocumentField,
} from '@/lib/reportUtils';
import { checkCloudReportExists } from '@/lib/driveBridge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function runCloudReportReconciliation(params: {
  sbAdmin: any;
  equipmentId?: string;
  actorEmail?: string;
}) {
  const { sbAdmin, equipmentId, actorEmail = 'Google Drive Sync' } = params;

  let query = sbAdmin.from('equipment').select('*');
  if (equipmentId) {
    query = query.eq('id', equipmentId);
  } else {
    query = query.neq('DocumentDrawing', '');
  }

  const { data: rows, error } = await query;
  if (error || !rows) {
    throw new Error(error?.message || 'Failed to query equipment for report reconciliation');
  }

  const candidates = (rows as any[])
    .map((r) => normalizeEquipmentRecord(r))
    .filter((eq) => {
      const parsed = parseEquipmentDocumentField(eq.DocumentDrawing);
      return parsed.reports.length > 0;
    });

  let checkedCount = 0;
  let removedCount = 0;
  const removedReports: {
    equipmentId: string;
    equipmentTag: string;
    unit: string;
    reportTitle: string;
    stageLabel: string;
    reason?: string;
  }[] = [];
  const updatedEquipment: EquipmentItem[] = [];
  const nowIso = new Date().toISOString();

  for (const eq of candidates) {
    const parsed = parseEquipmentDocumentField(eq.DocumentDrawing);
    if (parsed.reports.length === 0) continue;

    const keptReports: InspectionReportAttachment[] = [];
    let modified = false;

    for (const rep of parsed.reports) {
      checkedCount++;
      const status = await checkCloudReportExists({
        provider: rep.provider,
        viewUrl: rep.viewUrl,
      });

      if (!status.exists) {
        modified = true;
        removedCount++;
        removedReports.push({
          equipmentId: eq.id,
          equipmentTag: eq.EquipmentTagNo,
          unit: eq.Unit,
          reportTitle: rep.title,
          stageLabel: rep.stageLabel,
          reason: status.reason,
        });
      } else {
        keptReports.push(rep);
      }
    }

    if (modified) {
      const nextDoc = serializeEquipmentDocumentField(parsed.drawingRef, keptReports);
      const nextRecord = normalizeEquipmentRecord({
        ...eq,
        DocumentDrawing: nextDoc,
        updatedBy: actorEmail,
        updatedAt: nowIso,
      });

      const { error: upErr } = await sbAdmin
        .from('equipment')
        .upsert(toDatabaseEquipmentRow(nextRecord), { onConflict: 'id' });

      if (!upErr) {
        updatedEquipment.push(nextRecord);
        try {
          await sbAdmin.from('audit_logs').insert({
            id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            action: 'DRIVE_SYNC_REMOVE_DELETED_REPORT',
            target: eq.EquipmentTagNo,
            userEmail: actorEmail,
            timestamp: nowIso,
            details: `Auto-removed report(s) from ${eq.EquipmentTagNo} (${eq.Unit}) because file was deleted in Google Drive / Cloud Storage`,
          });
        } catch {}
      }
    }
  }

  return {
    ok: true,
    checkedCount,
    removedCount,
    removedReports,
    updatedEquipment,
  };
}

export async function GET(req: NextRequest) {
  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    const url = new URL(req.url);
    const equipmentId = (url.searchParams.get('equipmentId') || '').trim() || undefined;
    const caller = await verifyAuthenticatedCaller(req);
    const actorEmail = caller.profile?.email || 'Google Drive Auto-Sync';

    const result = await runCloudReportReconciliation({
      sbAdmin,
      equipmentId,
      actorEmail,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to reconcile Google Drive reports' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    let equipmentId: string | undefined = undefined;
    try {
      const body = await req.json();
      if (body?.equipmentId) {
        equipmentId = String(body.equipmentId).trim();
      }
    } catch {}

    const caller = await verifyAuthenticatedCaller(req);
    const actorEmail = caller.profile?.email || 'Google Drive Auto-Sync';

    const result = await runCloudReportReconciliation({
      sbAdmin,
      equipmentId,
      actorEmail,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to reconcile Google Drive reports' },
      { status: 500 }
    );
  }
}

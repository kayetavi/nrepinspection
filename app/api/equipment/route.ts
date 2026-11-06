import { NextRequest, NextResponse } from 'next/server';
import {
  EquipmentItem,
  normalizeEquipmentRecord,
  toDatabaseEquipmentRow,
  isAllUnitsScope,
  getUserAllowedUnits,
  filterEquipmentByUserScope,
} from '@/lib/types';
import {
  getSupabaseAdminClient,
  verifyAuthenticatedCaller,
  fetchAllEquipmentFromSupabase,
  loadServerUnitsConfig,
} from '@/lib/server-auth';
import { getDefaultEquipmentDataset } from '@/lib/equipment-context';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    const unitsConfig = await loadServerUnitsConfig(sbAdmin);
    const rawData = await fetchAllEquipmentFromSupabase(sbAdmin);
    const allItems = rawData.map((row) => normalizeEquipmentRecord(row));
    // Users with an assigned unit scope receive only their assigned unit's equipment
    const items =
      caller.authenticated && caller.profile && !isAllUnitsScope(caller.profile.assignedUnits)
        ? filterEquipmentByUserScope(allItems, caller.profile)
        : allItems;

    return NextResponse.json(
      {
        ok: true,
        equipment: items,
        unitsConfig,
        authenticated: Boolean(caller.authenticated),
        role: caller.profile?.role || 'viewer',
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
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
        error: `Forbidden: Role "${caller.profile.role}" does not have permission to create or modify equipment.`,
      },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    await loadServerUnitsConfig(sbAdmin).catch(() => {});
    const body = await req.json();
    const nowIso = new Date().toISOString();
    const actorEmail = caller.profile.email;
    const isUnitScoped = !isAllUnitsScope(caller.profile.assignedUnits);
    const allowedUnits = getUserAllowedUnits(caller.profile);
    const allowedUnitsSet = new Set(
      allowedUnits.map((u) => u.toUpperCase())
    );

    // Support bulk upsert (e.g. Excel import)
    if (Array.isArray(body.items)) {
      const dedupedMap = new Map<string, EquipmentItem>();
      const unauthorizedUnits = new Set<string>();
      body.items.forEach((raw: any) => {
        const normalized = normalizeEquipmentRecord({
          ...raw,
          updatedBy: actorEmail,
          updatedAt: nowIso,
        });
        if (isUnitScoped && !allowedUnitsSet.has(normalized.Unit.toUpperCase())) {
          unauthorizedUnits.add(normalized.Unit.toUpperCase());
          return;
        }
        dedupedMap.set(normalized.id, normalized);
      });

      if (isUnitScoped && unauthorizedUnits.size > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: `Permission Denied: Your Assigned Scope is restricted to "${allowedUnits.join(', ')}". You do not have permission to upload Excel data for unit(s): ${Array.from(unauthorizedUnits).join(', ')}.`,
          },
          { status: 403 }
        );
      }

      const records: EquipmentItem[] = Array.from(dedupedMap.values());

      const BATCH_SIZE = 400;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const slice = records.slice(i, i + BATCH_SIZE).map((r) => toDatabaseEquipmentRow(r));
        const { error } = await sbAdmin.from('equipment').upsert(slice, { onConflict: 'id' });
        if (error) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }
      }

      return NextResponse.json({ ok: true, count: records.length });
    }

    // Support single item save (body.item) or inline field update (body.record)
    let item = body.item || body.record || body;
    if (body.id && body.field && !body.item && !body.record) {
      const { data: existingRow } = await sbAdmin
        .from('equipment')
        .select('*')
        .eq('id', String(body.id))
        .maybeSingle();
      const baseNormalized = existingRow
        ? normalizeEquipmentRecord(existingRow)
        : normalizeEquipmentRecord({ id: String(body.id), EquipmentTagNo: String(body.id) });
      item = {
        ...baseNormalized,
        [body.field]: body.value,
      };
    }

    if (!item || (!item.EquipmentTagNo && !item.id)) {
      return NextResponse.json(
        { ok: false, error: 'EquipmentTagNo is required.' },
        { status: 400 }
      );
    }

    const normalized = normalizeEquipmentRecord({
      ...item,
      updatedBy: actorEmail,
      updatedAt: nowIso,
    });

    if (isUnitScoped && !allowedUnitsSet.has(normalized.Unit.toUpperCase())) {
      return NextResponse.json(
        {
          ok: false,
          error: `Permission Denied: Your Assigned Scope is restricted to "${allowedUnits.join(', ')}" and cannot modify equipment in "${normalized.Unit}".`,
        },
        { status: 403 }
      );
    }

    const { error } = await sbAdmin
      .from('equipment')
      .upsert(toDatabaseEquipmentRow(normalized), { onConflict: 'id' });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, equipment: normalized });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to save equipment' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  return POST(req);
}

export async function DELETE(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Unauthorized' },
      { status: caller.statusCode || 401 }
    );
  }

  const canManageLiveDatabase =
    caller.isAdmin || caller.profile.role === 'lead_engineer';

  if (!canManageLiveDatabase) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Forbidden: Only authorized Administrators and Lead Engineers can delete or reset equipment records.',
      },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const queryId = searchParams.get('id')?.trim();
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    // Reset to baseline dataset (only when explicitly requested by Admin)
    if (body.action === 'reset-sample') {
      await sbAdmin.from('equipment').delete().neq('id', '');
      const seededItems = getDefaultEquipmentDataset().map((item) => ({
        ...item,
        updatedAt: new Date().toISOString(),
        updatedBy: caller.profile!.email,
      }));
      const BATCH_SIZE = 400;
      for (let i = 0; i < seededItems.length; i += BATCH_SIZE) {
        const slice = seededItems.slice(i, i + BATCH_SIZE);
        await sbAdmin.from('equipment').upsert(slice, { onConflict: 'id' });
      }
      return NextResponse.json({ ok: true, count: seededItems.length });
    }

    // Clear all equipment
    if (body.action === 'clear-all' || body.clearAll === true) {
      const { error } = await sbAdmin.from('equipment').delete().neq('id', '');
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, deletedAll: true });
    }

    // Bulk delete or single delete
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids
      : queryId
      ? [queryId]
      : body.id
      ? [String(body.id)]
      : [];

    if (!ids.length) {
      return NextResponse.json(
        { ok: false, error: 'Equipment id or ids required for deletion.' },
        { status: 400 }
      );
    }

    const normalizedIds = Array.from(
      new Set(ids.flatMap((raw) => [raw, raw.replace(/[^a-zA-Z0-9_-]/g, '_')]))
    );
    const { error } = await sbAdmin.from('equipment').delete().in('id', normalizedIds);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deletedCount: normalizedIds.length });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to delete equipment' },
      { status: 500 }
    );
  }
}

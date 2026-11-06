import { NextRequest, NextResponse } from 'next/server';
import {
  getSupabaseAdminClient,
  verifyAuthenticatedCaller,
  loadServerUnitsConfig,
  saveServerUnitsConfig,
} from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const sbAdmin = getSupabaseAdminClient();
  try {
    const unitsConfig = await loadServerUnitsConfig(sbAdmin);
    return NextResponse.json(
      { ok: true, unitsConfig },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to load units config' },
      { status: 500 }
    );
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

  const canManageStructure =
    caller.isAdmin || caller.profile.role === 'lead_engineer';
  if (!canManageStructure) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Forbidden: Only Administrators and Lead Engineers can update server unit structure.',
      },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Database unavailable' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const current = await loadServerUnitsConfig(sbAdmin);

    const nextUnits = Array.isArray(body.units) ? body.units : current.units;
    const nextUtilSub = Array.isArray(body.utilitySubUnits)
      ? body.utilitySubUnits
      : current.utilitySubUnits;
    const nextMspSub = Array.isArray(body.mspSubUnits)
      ? body.mspSubUnits
      : current.mspSubUnits;

    const saved = await saveServerUnitsConfig(
      {
        units: nextUnits,
        utilitySubUnits: nextUtilSub,
        mspSubUnits: nextMspSub,
        updatedBy: caller.profile.email || caller.profile.displayName || 'Admin',
        updatedAt: new Date().toISOString(),
      },
      sbAdmin
    );

    return NextResponse.json({
      ok: true,
      unitsConfig: saved,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to save units config' },
      { status: 500 }
    );
  }
}

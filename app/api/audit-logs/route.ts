import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient, verifyAuthenticatedCaller } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Unauthorized: Authentication required.' },
      { status: caller.statusCode || 401 }
    );
  }

  // Requirement 6: Audit logs must not be publicly readable; restrict to admin & lead_engineer
  if (!caller.canReadAuditLogs) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Forbidden: Audit logs are restricted to authorized administrators and lead engineers.',
      },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  const { data, error } = await sbAdmin
    .from('audit_logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, logs: data || [] });
}

export async function POST(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Unauthorized' },
      { status: caller.statusCode || 401 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const action = String(body.action || '').trim();
    const target = String(body.target || '').trim();
    const details = String(body.details || '').trim();

    if (!action || !target) {
      return NextResponse.json(
        { ok: false, error: 'action and target are required for audit log entry.' },
        { status: 400 }
      );
    }

    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      action,
      target,
      userEmail: caller.profile.email, // Strictly stamped from verified server identity
      timestamp: new Date().toISOString(),
      details,
    };

    const { error } = await sbAdmin.from('audit_logs').insert(entry);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, log: entry });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to write audit log' },
      { status: 500 }
    );
  }
}

export async function PUT() {
  return NextResponse.json(
    { ok: false, error: 'Forbidden: Audit logs are immutable and cannot be modified.' },
    { status: 403 }
  );
}

export async function PATCH() {
  return NextResponse.json(
    { ok: false, error: 'Forbidden: Audit logs are immutable and cannot be modified.' },
    { status: 403 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { ok: false, error: 'Forbidden: Audit logs are immutable and cannot be deleted.' },
    { status: 403 }
  );
}

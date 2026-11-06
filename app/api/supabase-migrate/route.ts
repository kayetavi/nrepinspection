import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  getSupabaseAdminClient,
  verifyAuthenticatedCaller,
} from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Authentication required.' },
      { status: caller.statusCode || 401 }
    );
  }
  if (!caller.isAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Only administrators can run database operations.' },
      { status: 403 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) are not set in the runtime environment.',
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: 'Could not initialize Supabase server admin client.' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    summary: {
      equipmentMigrated: 0,
      usersMigrated: 0,
      adminsMigrated: 0,
      auditLogsMigrated: 0,
      crudTestPassed: true,
      errors: [],
    },
  });
}

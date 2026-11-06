import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getSupabaseAdminClient } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const envCheck = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
  };

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        envCheck,
        message:
          'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY) are not configured in the runtime environment yet.',
      },
      { status: 200 }
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        envCheck,
        message: 'Failed to initialize Supabase server admin client.',
      },
      { status: 200 }
    );
  }

  const tablesStatus: Record<string, { accessible: boolean; count?: number; error?: string }> = {};

  for (const table of ['equipment', 'users', 'admins', 'audit_logs']) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        tablesStatus[table] = { accessible: false, error: error.message };
      } else {
        tablesStatus[table] = { accessible: true, count: count ?? 0 };
      }
    } catch (err: any) {
      tablesStatus[table] = { accessible: false, error: err?.message || 'Query failed' };
    }
  }

  let authUsersCount = 0;
  try {
    const { data: authList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
    authUsersCount = authList?.users?.length ?? 0;
  } catch {}

  const allTablesAccessible = Object.values(tablesStatus).every((t) => t.accessible);

  return NextResponse.json({
    ok: allTablesAccessible,
    configured: true,
    envCheck,
    authUsersCount,
    tablesStatus,
  });
}

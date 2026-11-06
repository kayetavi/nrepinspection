import { NextRequest, NextResponse } from 'next/server';
import { UserProfile, UserRole, UserStatus } from '@/lib/types';
import {
  deriveSupabaseAuthPassword,
  encodePasswordWithRole,
  extractRoleFromStoredPassword,
  getSupabaseAdminClient,
  hashPasswordWithSalt,
  normalizeRole,
  resolveAuthoritativeUserRole,
  sanitizeProfileForClient,
  stripRolePrefixFromPassword,
  upsertPublicUserSafe,
  verifyAuthenticatedCaller,
} from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Unauthorized' },
      { status: caller.statusCode || 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  if (searchParams.get('self') === 'true') {
    return NextResponse.json({
      ok: true,
      users: [caller.profile],
    });
  }

  // Only authorized administrators can list the user/admin directory
  if (!caller.isAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Only authorized administrators can view user and admin registries.' },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Database client not configured' },
      { status: 500 }
    );
  }

  const [{ data: publicUsers, error }, { data: authListData }] = await Promise.all([
    sbAdmin.from('users').select('*'),
    sbAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const authRoleByUid = new Map<string, UserRole>();
  const authRoleByEmail = new Map<string, UserRole>();
  const authUnitsByUid = new Map<string, string>();
  const authUnitsByEmail = new Map<string, string>();
  const authUuidByEmail = new Map<string, string>();

  authListData?.users?.forEach((au) => {
    if (au.email) {
      authUuidByEmail.set(au.email.toLowerCase(), au.id);
    }
    const rawMetaRole = au.app_metadata?.role ? String(au.app_metadata.role).trim().toLowerCase() : null;
    const metaRole: UserRole | null =
      rawMetaRole === 'admin' ||
      rawMetaRole === 'lead_engineer' ||
      rawMetaRole === 'inspector' ||
      rawMetaRole === 'viewer'
        ? (rawMetaRole as UserRole)
        : null;
    if (metaRole) {
      authRoleByUid.set(au.id, metaRole);
      if (au.email) authRoleByEmail.set(au.email.toLowerCase(), metaRole);
    }
    const metaUnits = au.app_metadata?.assignedUnits
      ? String(au.app_metadata.assignedUnits).trim()
      : null;
    if (metaUnits) {
      authUnitsByUid.set(au.id, metaUnits);
      if (au.email) authUnitsByEmail.set(au.email.toLowerCase(), metaUnits);
    }
  });

  let anyConstraintBlocked = false;
  const syncPromises: Promise<void>[] = [];

  const rawSanitizedList = (publicUsers || []).map((row: any) => {
    const strippedPass = stripRolePrefixFromPassword(row.password);
    const hasPass = Boolean(strippedPass && strippedPass.trim() !== '');
    const granularFromAuth =
      authRoleByUid.get(row.uid) ||
      (row.email ? authRoleByEmail.get(String(row.email).toLowerCase()) : undefined);

    const authoritativeRole = resolveAuthoritativeUserRole({
      dbRole: row.role,
      storedPassword: row.password,
      appMetaRole: granularFromAuth,
    });

    const expectedPrefix = `role:${authoritativeRole}|`;
    const currentPassStr = String(row.password || '');
    const needsDbSync =
      row.role !== authoritativeRole || !currentPassStr.startsWith(expectedPrefix);

    if (needsDbSync) {
      syncPromises.push(
        (async () => {
          const updatedRecord: UserProfile = {
            ...(row as UserProfile),
            role: authoritativeRole,
            password: encodePasswordWithRole(row.password, authoritativeRole),
          };
          const { constraintBlocked } = await upsertPublicUserSafe(sbAdmin, updatedRecord);
          if (constraintBlocked) {
            anyConstraintBlocked = true;
          }
          // Also ensure auth.users app_metadata has the authoritative role
          const targetAuthId =
            authRoleByUid.has(row.uid)
              ? row.uid
              : row.email
              ? authUuidByEmail.get(String(row.email).toLowerCase())
              : undefined;
          if (targetAuthId && granularFromAuth !== authoritativeRole) {
            try {
              await sbAdmin.auth.admin.updateUserById(targetAuthId, {
                app_metadata: {
                  role: authoritativeRole,
                  status: row.status || 'approved',
                  assignedUnits: row.assignedUnits || 'All',
                },
              });
            } catch {}
          }
        })()
      );
    }

    const clean = sanitizeProfileForClient({
      ...(row as UserProfile),
      role: authoritativeRole,
    }) as UserProfile & {
      hasPassword?: boolean;
    };
    clean.role = authoritativeRole;

    const metaUnits =
      authUnitsByUid.get(clean.uid) ||
      (clean.email ? authUnitsByEmail.get(clean.email.toLowerCase()) : undefined);
    if (
      (!clean.assignedUnits || clean.assignedUnits.trim().toLowerCase() === 'all') &&
      metaUnits &&
      metaUnits.toLowerCase() !== 'all'
    ) {
      clean.assignedUnits = metaUnits;
    }
    clean.hasPassword = hasPass;
    return clean;
  });

  if (syncPromises.length > 0) {
    await Promise.allSettled(syncPromises);
  }

  // Deduplicate rows that share the same email (preferring the auth UUID row while preserving specific assignedUnits)
  const dedupedByEmail = new Map<string, UserProfile & { hasPassword?: boolean }>();
  rawSanitizedList.forEach((u) => {
    const key = (u.email || u.uid).toLowerCase();
    const existing = dedupedByEmail.get(key);
    if (!existing) {
      dedupedByEmail.set(key, u);
      return;
    }
    const authUuid = authUuidByEmail.get(key);
    const preferCurrent = authUuid && u.uid === authUuid && existing.uid !== authUuid;
    const mergedUnits =
      u.assignedUnits && u.assignedUnits.trim().toLowerCase() !== 'all'
        ? u.assignedUnits
        : existing.assignedUnits && existing.assignedUnits.trim().toLowerCase() !== 'all'
        ? existing.assignedUnits
        : u.assignedUnits || existing.assignedUnits || 'All';

    const mergedRole: UserRole =
      u.role === 'lead_engineer' || existing.role === 'lead_engineer'
        ? 'lead_engineer'
        : preferCurrent
        ? u.role
        : existing.role;

    const winner = preferCurrent ? { ...u } : { ...existing };
    winner.role = mergedRole;
    winner.assignedUnits = mergedUnits;
    winner.hasPassword = Boolean(u.hasPassword || existing.hasPassword);
    dedupedByEmail.set(key, winner);
  });

  const sortedUsers = Array.from(dedupedByEmail.values()).sort((a, b) => {
    const nameA = (a.displayName || a.email || a.uid).toLowerCase();
    const nameB = (b.displayName || b.email || b.uid).toLowerCase();
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return (a.email || a.uid).toLowerCase().localeCompare((b.email || b.uid).toLowerCase());
  });

  return NextResponse.json({
    ok: true,
    users: sortedUsers,
    constraintBlocked: anyConstraintBlocked,
  });
}

export async function POST(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Unauthorized' },
      { status: caller.statusCode || 401 }
    );
  }
  if (!caller.isAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Only authorized administrators can create or manage users.' },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Server database unavailable' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const rawEmailOrId = String(body.email || body.uid || body.emailOrUid || '').trim();
    if (!rawEmailOrId) {
      return NextResponse.json(
        { ok: false, error: 'Email or User ID is required.' },
        { status: 400 }
      );
    }

    const email = rawEmailOrId.includes('@')
      ? rawEmailOrId.toLowerCase()
      : `${rawEmailOrId.toLowerCase()}@nrl.co.in`;
    const displayName = String(body.displayName || rawEmailOrId.split('@')[0]).trim();
    const role: UserRole = normalizeRole(body.role);
    const status: UserStatus = ['approved', 'pending', 'suspended'].includes(body.status)
      ? body.status
      : 'approved';
    const assignedUnits = String(body.assignedUnits || 'All').trim();
    const rawPassword = String(body.password || '').trim();

    // Prevent self-role modification via POST upsert
    if (
      email === caller.profile.email.toLowerCase() &&
      role !== caller.profile.role
    ) {
      return NextResponse.json(
        { ok: false, error: 'Forbidden: Users must never modify their own administrative role.' },
        { status: 403 }
      );
    }

    const internalAuthPassword = deriveSupabaseAuthPassword(email);
    const { data: listData } = await sbAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existingAuth = listData?.users?.find((u) => u.email?.toLowerCase() === email);

    let authUid: string;
    if (!existingAuth) {
      const { data: created, error: createErr } = await sbAdmin.auth.admin.createUser({
        email,
        password: internalAuthPassword,
        email_confirm: true,
        user_metadata: { displayName },
        app_metadata: { role, status, assignedUnits },
      });
      if (createErr || !created?.user) {
        return NextResponse.json(
          { ok: false, error: createErr?.message || 'Failed to create Supabase Auth user' },
          { status: 400 }
        );
      }
      authUid = created.user.id;
    } else {
      authUid = existingAuth.id;
      await sbAdmin.auth.admin.updateUserById(authUid, {
        user_metadata: { ...existingAuth.user_metadata, displayName },
        app_metadata: { ...existingAuth.app_metadata, role, status, assignedUnits },
      });
    }

    const nowIso = new Date().toISOString();
    const hashedPassword = rawPassword
      ? hashPasswordWithSalt(rawPassword)
      : hashPasswordWithSalt(internalAuthPassword);

    const newRecord: UserProfile = {
      uid: authUid,
      email,
      displayName,
      role,
      status,
      password: hashedPassword,
      assignedUnits,
      createdAt: nowIso,
      lastLoginAt: 'Not logged in yet',
    };

    const { error: upsertErr } = await upsertPublicUserSafe(sbAdmin, newRecord);
    if (upsertErr) {
      return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
    }

    if (role === 'admin') {
      await sbAdmin.from('admins').upsert(
        { uid: authUid, email, assignedAt: nowIso },
        { onConflict: 'uid' }
      );
    } else {
      await sbAdmin.from('admins').delete().eq('uid', authUid);
    }

    return NextResponse.json({
      ok: true,
      user: { ...sanitizeProfileForClient(newRecord), role, hasPassword: true },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to create user' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json(
      { ok: false, error: caller.error || 'Unauthorized' },
      { status: caller.statusCode || 401 }
    );
  }
  if (!caller.isAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Only authorized administrators can modify users or roles.' },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Server database unavailable' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const targetUid = String(body.uid || body.targetUid || '').trim();
    if (!targetUid) {
      return NextResponse.json({ ok: false, error: 'Target uid is required.' }, { status: 400 });
    }

    // Requirement 5: Users must never modify their own administrative role or status
    const isSelf =
      targetUid === caller.profile.uid ||
      targetUid.toLowerCase() === caller.profile.email.toLowerCase();
    if (isSelf && (body.role !== undefined || body.status !== undefined)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Forbidden: Users must never modify their own administrative role or status.',
        },
        { status: 403 }
      );
    }

    const { data: existingByUid } = await sbAdmin
      .from('users')
      .select('*')
      .eq('uid', targetUid)
      .maybeSingle();

    let existingRow = existingByUid;
    if (!existingRow && body.email) {
      const { data: byEmail } = await sbAdmin
        .from('users')
        .select('*')
        .ilike('email', String(body.email).trim())
        .limit(1);
      if (byEmail && byEmail.length > 0) {
        existingRow = byEmail[0];
      }
    }

    if (!existingRow) {
      return NextResponse.json({ ok: false, error: 'Target user not found.' }, { status: 404 });
    }

    const existingRoleResolved = resolveAuthoritativeUserRole({
      dbRole: existingRow.role,
      storedPassword: existingRow.password,
    });

    const updatedRole: UserRole =
      body.role !== undefined ? normalizeRole(body.role) : existingRoleResolved;
    const updatedStatus: UserStatus =
      body.status !== undefined ? body.status : existingRow.status;
    const updatedUnits: string =
      body.assignedUnits !== undefined ? String(body.assignedUnits).trim() || 'All' : existingRow.assignedUnits || 'All';
    const basePasswordHash: string = body.password
      ? hashPasswordWithSalt(String(body.password).trim())
      : stripRolePrefixFromPassword(existingRow.password);
    const updatedPassword = encodePasswordWithRole(basePasswordHash, updatedRole);

    const updatedRecord: UserProfile = {
      ...(existingRow as UserProfile),
      role: updatedRole,
      status: updatedStatus,
      assignedUnits: updatedUnits,
      password: updatedPassword,
    };

    const { error: upErr, constraintBlocked } = await upsertPublicUserSafe(sbAdmin, updatedRecord);
    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    // Also synchronize any duplicate/legacy rows sharing the same email address so login never reads a stale role or assignedUnits
    if (existingRow.email) {
      const roleToWriteOnDuplicates = constraintBlocked
        ? updatedRole === 'admin'
          ? 'admin'
          : updatedRole === 'viewer'
          ? 'viewer'
          : 'editor'
        : updatedRole;
      await sbAdmin
        .from('users')
        .update({
          role: roleToWriteOnDuplicates,
          assignedUnits: updatedUnits,
          status: updatedStatus,
          password: updatedPassword,
        })
        .ilike('email', existingRow.email);
    }

    // Sync admins table if role changed
    if (body.role !== undefined) {
      if (updatedRole === 'admin') {
        await sbAdmin.from('admins').upsert(
          {
            uid: existingRow.uid,
            email: existingRow.email,
            assignedAt: new Date().toISOString(),
          },
          { onConflict: 'uid' }
        );
      } else {
        await sbAdmin.from('admins').delete().eq('uid', existingRow.uid);
      }
    }

    // Sync auth.users app_metadata by targetUid OR matching email in auth.users (or create if not yet in auth.users)
    try {
      const { data: listData } = await sbAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const matchingAuthUser = listData?.users?.find(
        (au) =>
          au.id === targetUid ||
          au.id === existingRow.uid ||
          (existingRow.email && au.email?.toLowerCase() === existingRow.email.toLowerCase())
      );
      if (matchingAuthUser) {
        await sbAdmin.auth.admin.updateUserById(matchingAuthUser.id, {
          app_metadata: {
            ...(matchingAuthUser.app_metadata || {}),
            role: updatedRole,
            status: updatedStatus,
            assignedUnits: updatedUnits,
          },
        });
      } else if (existingRow.email) {
        const cleanEmail = existingRow.email.trim().toLowerCase();
        await sbAdmin.auth.admin.createUser({
          email: cleanEmail,
          password: deriveSupabaseAuthPassword(cleanEmail),
          email_confirm: true,
          user_metadata: { displayName: existingRow.displayName || cleanEmail.split('@')[0] },
          app_metadata: {
            role: updatedRole,
            status: updatedStatus,
            assignedUnits: updatedUnits,
          },
        });
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      constraintBlocked: Boolean(constraintBlocked),
      user: { ...sanitizeProfileForClient(updatedRecord), role: updatedRole, assignedUnits: updatedUnits },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to update user' },
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
  if (!caller.isAdmin) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Only authorized administrators can delete users.' },
      { status: 403 }
    );
  }

  const sbAdmin = getSupabaseAdminClient();
  if (!sbAdmin) {
    return NextResponse.json({ ok: false, error: 'Server database unavailable' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  let targetUid = searchParams.get('uid')?.trim() || '';
  if (!targetUid) {
    try {
      const body = await req.json();
      targetUid = String(body.uid || body.targetUid || '').trim();
    } catch {}
  }

  if (!targetUid) {
    return NextResponse.json({ ok: false, error: 'Target uid is required.' }, { status: 400 });
  }

  if (targetUid === caller.profile.uid) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden: Administrators cannot delete their own account.' },
      { status: 403 }
    );
  }

  await sbAdmin.from('users').delete().eq('uid', targetUid);
  await sbAdmin.from('admins').delete().eq('uid', targetUid);
  try {
    await sbAdmin.auth.admin.deleteUser(targetUid);
  } catch {}

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { UserProfile, UserRole, UserStatus } from '@/lib/types';
import {
  SESSION_COOKIE_NAME,
  deriveSupabaseAuthPassword,
  encodePasswordWithRole,
  extractRoleFromStoredPassword,
  getSupabaseAdminClient,
  getSupabaseAnonServerClient,
  hashPasswordWithSalt,
  normalizeRole,
  provisionAndSignInSupabaseUser,
  resolveAuthoritativeUserRole,
  sanitizeProfileForClient,
  sha256Hex,
  signSessionToken,
  stripRolePrefixFromPassword,
  upsertPublicUserSafe,
  verifyAuthenticatedCaller,
  verifySessionCookieToken,
} from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

function verifyPasswordOnServer(
  inputPassword: string,
  storedPassword: string | undefined
): boolean {
  const cleanInput = inputPassword.trim();
  const strippedStored = stripRolePrefixFromPassword(storedPassword).trim();
  if (!cleanInput || !strippedStored) {
    return false;
  }

  const cleanStored = strippedStored;

  // 1. Check server HMAC-hashed password format (sha256:<hex>)
  if (cleanStored.startsWith('sha256:')) {
    const expected = hashPasswordWithSalt(cleanInput);
    if (
      expected.length === cleanStored.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleanStored))
    ) {
      return true;
    }
    return false;
  }

  // 2. Check if stored password matches raw 64-char SHA-256 hex
  if (cleanStored.length === 64 && /^[0-9a-f]+$/i.test(cleanStored)) {
    const inputSha = sha256Hex(cleanInput);
    return inputSha.toLowerCase() === cleanStored.toLowerCase();
  }

  // 3. Exact match against stored database password
  return cleanInput === cleanStored;
}

function attachSessionCookie(
  res: NextResponse,
  profile: UserProfile,
  supabaseSession?: { access_token: string; refresh_token: string } | null
) {
  const token = signSessionToken(profile, supabaseSession);
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function GET(req: NextRequest) {
  const caller = await verifyAuthenticatedCaller(req);
  if (!caller.authenticated || !caller.profile) {
    return NextResponse.json({ authenticated: false, profile: null });
  }

  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const decodedCookie = cookieToken ? verifySessionCookieToken(cookieToken) : null;

  return NextResponse.json({
    authenticated: true,
    profile: caller.profile,
    isAdmin: caller.isAdmin,
    supabaseSession: decodedCookie?.supabaseSession || null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const sbAdmin = getSupabaseAdminClient();

    // 1. Verify User ID / Email & Password strictly against the Server Database (public.users & public.admins)
    if (action === 'verify-credentials') {
      const rawInput = String(body.usernameOrEmail || '').trim();
      const u = rawInput.toLowerCase();
      const p = String(body.password || '').trim();

      if (!u) {
        return NextResponse.json(
          { ok: false, error: 'Please enter User ID or Email.' },
          { status: 400 }
        );
      }
      if (!p) {
        return NextResponse.json(
          { ok: false, error: 'Please enter your password.' },
          { status: 400 }
        );
      }

      if (!sbAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Server database connection is unavailable.' },
          { status: 500 }
        );
      }

      const sanitizedId = u.replace(/[^a-zA-Z0-9_-]/g, '_');
      const candidateEmail = u.includes('@') ? u : `${u}@nrl.co.in`;

      const [{ data: byUid }, { data: byEmail }, { data: byName }] = await Promise.all([
        sbAdmin.from('users').select('*').in('uid', [sanitizedId, rawInput, u]),
        sbAdmin.from('users').select('*').in('email', [u, candidateEmail]),
        sbAdmin.from('users').select('*').ilike('displayName', rawInput),
      ]);

      const allMatchedRows = [
        ...(byUid || []),
        ...(byEmail || []),
        ...(byName || []),
      ] as UserProfile[];

      let dbUser: UserProfile | null = null;
      if (allMatchedRows.length > 0) {
        // Prefer a row that matches the entered password or has a stored password hash, and preserve assignedUnits scope
        const rowMatchingPass = allMatchedRows.find((r) =>
          verifyPasswordOnServer(p, r.password)
        );
        const rowWithPass =
          rowMatchingPass ||
          allMatchedRows.find((r) => r.password && r.password.trim() !== '');
        const rowWithScope = allMatchedRows.find(
          (r) =>
            r.assignedUnits &&
            r.assignedUnits.trim() !== '' &&
            r.assignedUnits.trim().toLowerCase() !== 'all'
        );
        const rowWithGranularRole = allMatchedRows.find((r) =>
          Boolean(extractRoleFromStoredPassword(r.password))
        );
        const baseRow = rowWithPass || allMatchedRows[0];
        dbUser = {
          ...baseRow,
          password: rowWithGranularRole?.password || baseRow.password,
          assignedUnits: rowWithScope?.assignedUnits || baseRow.assignedUnits || 'All',
        };
      }

      if (!dbUser) {
        return NextResponse.json(
          {
            ok: false,
            error: `User "${rawInput}" is not registered on the server. Please contact an Administrator.`,
          },
          { status: 404 }
        );
      }

      if (dbUser.status === 'suspended') {
        return NextResponse.json(
          { ok: false, error: 'Your account has been suspended by the administrator.' },
          { status: 403 }
        );
      }

      if (dbUser.status === 'pending') {
        return NextResponse.json(
          { ok: false, error: 'Your account is pending approval by an administrator.' },
          { status: 403 }
        );
      }

      const valid = verifyPasswordOnServer(p, dbUser.password);
      if (!valid) {
        return NextResponse.json(
          { ok: false, error: 'Invalid user ID or password.' },
          { status: 401 }
        );
      }

      const authEmail = dbUser.email.includes('@')
        ? dbUser.email.toLowerCase()
        : `${u}@nrl.co.in`;

      // Check server admins table, stored password role prefix, and auth.users.app_metadata for authoritative role
      const [{ data: adminRow }, { data: authListData }] = await Promise.all([
        sbAdmin.from('admins').select('uid').eq('uid', dbUser.uid).maybeSingle(),
        sbAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
      ]);

      const matchingAuthUser = authListData?.users?.find(
        (au) => au.id === dbUser!.uid || au.email?.toLowerCase() === authEmail
      );

      const resolvedRole: UserRole = resolveAuthoritativeUserRole({
        dbRole: dbUser.role,
        storedPassword: dbUser.password,
        appMetaRole: matchingAuthUser?.app_metadata?.role,
        inAdminsTable: Boolean(adminRow),
      });
      const resolvedStatus: UserStatus = dbUser.status || 'approved';

      const hashedPassword = hashPasswordWithSalt(p);
      const provisioned = await provisionAndSignInSupabaseUser({
        email: authEmail,
        displayName: dbUser.displayName || rawInput,
        role: resolvedRole,
        status: resolvedStatus,
        assignedUnits: dbUser.assignedUnits || 'All',
        hashedPassword,
        legacyUid: dbUser.uid,
      });

      // Keep legacy row synchronized if legacyUid differs from authUid
      if (dbUser.uid !== provisioned.authUid) {
        await sbAdmin
          .from('users')
          .update({
            password: encodePasswordWithRole(hashedPassword, resolvedRole),
            lastLoginAt: new Date().toISOString(),
          })
          .eq('uid', dbUser.uid);
      }

      const res = NextResponse.json({
        ok: true,
        profile: provisioned.profile,
        supabaseSession: provisioned.session,
        isAdmin: resolvedRole === 'admin',
      });
      attachSessionCookie(res, provisioned.profile, provisioned.session);
      return res;
    }

    // 2. Sync Supabase OAuth Authenticated User on Backend (verifies JWT with Supabase Auth)
    if (action === 'sync-google-user') {
      const authHeader = req.headers.get('authorization');
      const token =
        authHeader && authHeader.startsWith('Bearer ')
          ? authHeader.slice('Bearer '.length).trim()
          : String(body.accessToken || '').trim();

      if (!token || !sbAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Unauthorized: Valid Supabase Auth token required.' },
          { status: 401 }
        );
      }

      const { data: authUserData, error: authErr } = await sbAdmin.auth.getUser(token);
      if (authErr || !authUserData?.user) {
        return NextResponse.json(
          { ok: false, error: 'Unauthorized: Invalid Supabase Auth token.' },
          { status: 401 }
        );
      }

      const verifiedUser = authUserData.user;
      const uid = verifiedUser.id;
      const email = (verifiedUser.email || '').trim().toLowerCase();
      const displayName =
        verifiedUser.user_metadata?.full_name ||
        verifiedUser.user_metadata?.name ||
        verifiedUser.user_metadata?.displayName ||
        email.split('@')[0] ||
        'Engineer';

      const nowIso = new Date().toISOString();

      // Authoritative lookup in public.users and public.admins on server
      const [{ data: existingByUid }, { data: adminRow }] = await Promise.all([
        sbAdmin.from('users').select('*').eq('uid', uid).maybeSingle(),
        sbAdmin.from('admins').select('uid').eq('uid', uid).maybeSingle(),
      ]);

      let existingProfile = existingByUid as UserProfile | null;
      if (!existingProfile && email) {
        const { data: existingByEmail } = await sbAdmin
          .from('users')
          .select('*')
          .ilike('email', email)
          .limit(1);
        if (existingByEmail && existingByEmail.length > 0) {
          existingProfile = existingByEmail[0] as UserProfile;
        }
      }

      if (!existingProfile && !adminRow) {
        return NextResponse.json(
          {
            ok: false,
            error: `Account "${email}" is not registered on the server. Please contact an Administrator.`,
          },
          { status: 403 }
        );
      }

      const resolvedRole: UserRole = resolveAuthoritativeUserRole({
        dbRole: existingProfile?.role,
        storedPassword: existingProfile?.password,
        appMetaRole: verifiedUser.app_metadata?.role,
        inAdminsTable: Boolean(adminRow),
      });
      const resolvedStatus: UserStatus = existingProfile?.status || 'approved';

      const recordToSave: UserProfile = {
        uid,
        email,
        displayName: existingProfile?.displayName || displayName,
        role: resolvedRole,
        status: resolvedStatus,
        password: existingProfile?.password,
        assignedUnits: existingProfile?.assignedUnits || 'All',
        createdAt: existingProfile?.createdAt || nowIso,
        lastLoginAt: nowIso,
      };

      await upsertPublicUserSafe(sbAdmin, recordToSave);
      if (resolvedRole === 'admin') {
        await sbAdmin.from('admins').upsert(
          { uid, email, assignedAt: nowIso },
          { onConflict: 'uid' }
        );
      }

      const clientProfile = sanitizeProfileForClient(recordToSave);
      const res = NextResponse.json({
        ok: true,
        profile: clientProfile,
        isAdmin: resolvedRole === 'admin',
      });
      attachSessionCookie(res, clientProfile);
      return res;
    }

    // 3. Hash a password on Backend (Restricted to Authenticated Administrators)
    if (action === 'hash-password') {
      const caller = await verifyAuthenticatedCaller(req);
      if (!caller.authenticated || !caller.isAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Forbidden: Only administrators can hash user passwords.' },
          { status: 403 }
        );
      }
      const rawPassword = String(body.password || '').trim();
      if (!rawPassword) {
        return NextResponse.json(
          { ok: false, error: 'Password cannot be empty.' },
          { status: 400 }
        );
      }
      return NextResponse.json({
        ok: true,
        hashedPassword: hashPasswordWithSalt(rawPassword),
      });
    }

    // 4. Request Password Reset Email (Triggers Supabase Auth Recovery Email to Registered Inbox)
    if (action === 'request-password-reset') {
      const rawInput = String(body.usernameOrEmail || '').trim();
      const u = rawInput.toLowerCase();
      const redirectTo = String(body.redirectTo || '').trim();

      if (!u) {
        return NextResponse.json(
          { ok: false, error: 'Please enter your Username or Email.' },
          { status: 400 }
        );
      }

      if (!sbAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Server database connection is unavailable.' },
          { status: 500 }
        );
      }

      const sanitizedId = u.replace(/[^a-zA-Z0-9_-]/g, '_');
      const candidateEmail = u.includes('@') ? u : `${u}@nrl.co.in`;

      const [{ data: byUid }, { data: byEmail }, { data: byName }] = await Promise.all([
        sbAdmin.from('users').select('*').in('uid', [sanitizedId, rawInput, u]),
        sbAdmin.from('users').select('*').in('email', [u, candidateEmail]),
        sbAdmin.from('users').select('*').ilike('displayName', rawInput),
      ]);

      const allMatchedRows = [
        ...(byUid || []),
        ...(byEmail || []),
        ...(byName || []),
      ] as UserProfile[];

      if (!allMatchedRows || allMatchedRows.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: `User "${rawInput}" is not registered on the server. Please check your Username or Email.`,
          },
          { status: 404 }
        );
      }

      const baseUser = allMatchedRows.find((r) => r.email && r.email.includes('@')) || allMatchedRows[0];
      if (baseUser.status === 'suspended') {
        return NextResponse.json(
          { ok: false, error: 'This account has been suspended. Please contact an Administrator.' },
          { status: 403 }
        );
      }

      const targetEmail = baseUser.email && baseUser.email.includes('@')
        ? baseUser.email.trim().toLowerCase()
        : candidateEmail;

      // Ensure user exists in Supabase auth.users so Supabase can send the recovery email
      const { data: authListData } = await sbAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const matchingAuthUser = authListData?.users?.find(
        (au) => au.email?.toLowerCase() === targetEmail
      );

      if (!matchingAuthUser) {
        const internalAuthPassword = deriveSupabaseAuthPassword(targetEmail);
        await sbAdmin.auth.admin.createUser({
          email: targetEmail,
          password: internalAuthPassword,
          email_confirm: true,
          user_metadata: {
            displayName: baseUser.displayName || rawInput,
            legacyUid: baseUser.uid,
          },
          app_metadata: {
            role: normalizeRole(baseUser.role),
            status: baseUser.status || 'approved',
            assignedUnits: baseUser.assignedUnits || 'All',
          },
        }).catch(() => {});
      }

      const sbAnon = getSupabaseAnonServerClient();
      if (!sbAnon) {
        return NextResponse.json(
          { ok: false, error: 'Supabase Auth client is not configured.' },
          { status: 500 }
        );
      }

      const { error: resetMailErr } = await sbAnon.auth.resetPasswordForEmail(
        targetEmail,
        redirectTo ? { redirectTo } : undefined
      );

      if (resetMailErr) {
        return NextResponse.json(
          {
            ok: false,
            error: `Failed to send recovery email via Supabase: ${resetMailErr.message}`,
          },
          { status: 400 }
        );
      }

      try {
        await sbAdmin.from('audit_logs').insert({
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          action: 'PASSWORD_RESET_REQUESTED',
          target: targetEmail,
          userEmail: targetEmail,
          details: `Password reset recovery email triggered for "${baseUser.displayName || rawInput}" (${targetEmail})`,
          timestamp: new Date().toISOString(),
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        email: targetEmail,
        message: `Password reset email has been sent to ${targetEmail}. Please click the link in your email (or enter the recovery code below) to set your new password.`,
      });
    }

    // 5. Complete Password Reset (Directly by Username/Email with Supabase Cloud Sync)
    if (action === 'reset-password') {
      const rawInput = String(body.usernameOrEmail || '').trim();
      const u = rawInput.toLowerCase();
      const newPassword = String(body.newPassword || '').trim();
      const recoveryAccessToken = String(body.recoveryAccessToken || '').trim();
      const recoveryOtp = String(body.recoveryOtp || '').trim();

      if (!rawInput) {
        return NextResponse.json(
          { ok: false, error: 'Please enter your Username or Email.' },
          { status: 400 }
        );
      }

      if (!newPassword || newPassword.length < 4) {
        return NextResponse.json(
          { ok: false, error: 'New password must be at least 4 characters.' },
          { status: 400 }
        );
      }

      if (!sbAdmin) {
        return NextResponse.json(
          { ok: false, error: 'Server database connection is unavailable.' },
          { status: 500 }
        );
      }

      const sbAnon = getSupabaseAnonServerClient();

      let targetEmail = '';
      let matchedUserProfile: UserProfile | null = null;

      // If recovery access token or OTP is present, verify via Supabase Auth
      if (recoveryAccessToken && sbAnon) {
        const { data: userData } = await sbAnon.auth.getUser(recoveryAccessToken);
        if (userData?.user?.email) {
          targetEmail = userData.user.email.trim().toLowerCase();
        }
      }

      if (!targetEmail) {
        const sanitizedLookup = u.replace(/[^a-zA-Z0-9_-]/g, '_');
        const candidateLookupEmail = u.includes('@') ? u : `${u}@nrl.co.in`;
        const [{ data: uByUid }, { data: uByEmail }, { data: uByName }] = await Promise.all([
          sbAdmin.from('users').select('*').in('uid', [sanitizedLookup, rawInput, u]),
          sbAdmin.from('users').select('*').in('email', [u, candidateLookupEmail]),
          sbAdmin.from('users').select('*').ilike('displayName', rawInput),
        ]);
        const matched = [...(uByUid || []), ...(uByEmail || []), ...(uByName || [])] as UserProfile[];
        matchedUserProfile = matched[0] || null;
        if (matchedUserProfile?.email && matchedUserProfile.email.includes('@')) {
          targetEmail = matchedUserProfile.email.trim().toLowerCase();
        } else {
          targetEmail = candidateLookupEmail;
        }
      }

      const [{ data: byEmailRows }, { data: byUidRows }] = await Promise.all([
        sbAdmin.from('users').select('*').ilike('email', targetEmail),
        sbAdmin.from('users').select('*').eq('uid', rawInput),
      ]);

      const allMatchedRows = [
        ...(byEmailRows || []),
        ...(byUidRows || []),
        ...(matchedUserProfile ? [matchedUserProfile] : []),
      ] as UserProfile[];

      if (!allMatchedRows || allMatchedRows.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: `User "${rawInput}" is not registered on the server. Please check your Username or Email.`,
          },
          { status: 404 }
        );
      }

      const baseUser = allMatchedRows[0];
      if (baseUser.status === 'suspended') {
        return NextResponse.json(
          { ok: false, error: 'This account has been suspended. Please contact an Administrator.' },
          { status: 403 }
        );
      }

      // Check server admins table and auth.users for authoritative role
      const [{ data: adminRow }, { data: authListData }] = await Promise.all([
        sbAdmin.from('admins').select('uid').eq('uid', baseUser.uid).maybeSingle(),
        sbAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
      ]);

      const matchingAuthUser = authListData?.users?.find(
        (au) => au.id === baseUser.uid || au.email?.toLowerCase() === targetEmail
      );

      const resolvedRole: UserRole = resolveAuthoritativeUserRole({
        dbRole: baseUser.role,
        storedPassword: baseUser.password,
        appMetaRole: matchingAuthUser?.app_metadata?.role,
        inAdminsTable: Boolean(adminRow),
      });

      const hashedPassword = hashPasswordWithSalt(newPassword);
      const encodedPassword = encodePasswordWithRole(hashedPassword, resolvedRole);

      // 1. Update in public.users via upsertPublicUserSafe
      const { error: updateErr } = await upsertPublicUserSafe(sbAdmin, {
        ...baseUser,
        role: resolvedRole,
        password: encodedPassword,
      });

      if (updateErr) {
        return NextResponse.json(
          { ok: false, error: `Failed to update password in Supabase: ${updateErr.message}` },
          { status: 500 }
        );
      }

      // Also sync all duplicate/legacy rows with matching email
      if (baseUser.email) {
        await sbAdmin
          .from('users')
          .update({
            password: encodedPassword,
          })
          .ilike('email', baseUser.email);
      }

      // 2. If user exists in auth.users, update their app_metadata as well
      if (matchingAuthUser) {
        await sbAdmin.auth.admin.updateUserById(matchingAuthUser.id, {
          app_metadata: {
            ...matchingAuthUser.app_metadata,
            role: resolvedRole,
          },
        }).catch(() => {});
      }

      // 3. Record audit log entry in Supabase public.audit_logs
      try {
        await sbAdmin.from('audit_logs').insert({
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          action: 'PASSWORD_RESET',
          target: targetEmail,
          userEmail: targetEmail,
          details: `Password was securely reset via verified email recovery for user "${baseUser.displayName || targetEmail}"`,
          timestamp: new Date().toISOString(),
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        message: 'Password successfully updated in Supabase Cloud! You can now sign in with your new password.',
        email: targetEmail,
      });
    }

    return NextResponse.json({ ok: false, error: 'Unsupported action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}

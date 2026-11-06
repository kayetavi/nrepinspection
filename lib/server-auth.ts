import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  UserProfile,
  UserRole,
  UserStatus,
  VALID_USER_ROLES,
  ProjectUnitsConfig,
  UNITS,
  UTILITY_SUB_UNITS,
  MSP_SUB_UNITS,
  applyDynamicUnitsConfig,
} from './types';

// Server-only session signing secret
export const SERVER_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET || 'nrep-nrl-server-hmac-secret-key-2026-secure';

export const SESSION_COOKIE_NAME = 'nrep_session';

/**
 * Server-only Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * Must NEVER be imported in client components.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey || !url.startsWith('https://')) {
    return null;
  }
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * PostgREST / Supabase default response limit is 1,000 rows.
 * This helper guarantees fetching ALL rows across multiple pages (chunks of 1,000)
 * so that large equipment datasets (e.g. 1,000+ or 10,000+ records) are never truncated.
 */
export async function fetchAllEquipmentFromSupabase(sbAdmin: SupabaseClient): Promise<any[]> {
  await loadServerUnitsConfig(sbAdmin).catch(() => {});
  const allRows: any[] = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sbAdmin
      .from('equipment')
      .select('*')
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw error;
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows;
}

const UNITS_CONFIG_BUCKET = 'inspection-reports';
const UNITS_CONFIG_PATH = '_system/units_config.json';

/**
 * Loads the authoritative Project Units & Sub-Units configuration from Supabase Storage
 * (_system/units_config.json). If not yet stored on the server, automatically seeds it
 * so the server is the single source of truth.
 */
export async function loadServerUnitsConfig(
  sbAdmin?: SupabaseClient | null
): Promise<ProjectUnitsConfig> {
  const client = sbAdmin || getSupabaseAdminClient();
  const fallback: ProjectUnitsConfig = {
    units: [...UNITS],
    utilitySubUnits: [...UTILITY_SUB_UNITS],
    mspSubUnits: [...MSP_SUB_UNITS],
  };

  if (!client) {
    return fallback;
  }

  try {
    const { data, error } = await client.storage
      .from(UNITS_CONFIG_BUCKET)
      .download(UNITS_CONFIG_PATH);

    if (!error && data) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.units) && parsed.units.length > 0) {
        const config: ProjectUnitsConfig = {
          units: Array.from(
            new Set(parsed.units.map((u: any) => String(u || '').trim()).filter(Boolean))
          ),
          utilitySubUnits: Array.isArray(parsed.utilitySubUnits) && parsed.utilitySubUnits.length > 0
            ? Array.from(
                new Set(parsed.utilitySubUnits.map((u: any) => String(u || '').trim()).filter(Boolean))
              )
            : [...UTILITY_SUB_UNITS],
          mspSubUnits: Array.isArray(parsed.mspSubUnits) && parsed.mspSubUnits.length > 0
            ? Array.from(
                new Set(parsed.mspSubUnits.map((u: any) => String(u || '').trim()).filter(Boolean))
              )
            : [...MSP_SUB_UNITS],
          updatedBy: parsed.updatedBy,
          updatedAt: parsed.updatedAt,
        };
        applyDynamicUnitsConfig(config);
        return config;
      }
    }

    // Seed initial config to Supabase server if it does not exist yet
    const seeded: ProjectUnitsConfig = {
      ...fallback,
      updatedBy: 'System Auto-Seed',
      updatedAt: new Date().toISOString(),
    };
    await saveServerUnitsConfig(seeded, client).catch(() => {});
    return seeded;
  } catch {
    return fallback;
  }
}

/**
 * Saves the Project Units & Sub-Units configuration to Supabase Server (_system/units_config.json).
 */
export async function saveServerUnitsConfig(
  config: ProjectUnitsConfig,
  sbAdmin?: SupabaseClient | null
): Promise<ProjectUnitsConfig> {
  const client = sbAdmin || getSupabaseAdminClient();
  const normalized: ProjectUnitsConfig = {
    units: Array.from(
      new Set((config.units || UNITS).map((u) => String(u || '').trim()).filter(Boolean))
    ),
    utilitySubUnits: Array.from(
      new Set(
        (config.utilitySubUnits || UTILITY_SUB_UNITS)
          .map((u) => String(u || '').trim())
          .filter(Boolean)
      )
    ),
    mspSubUnits: Array.from(
      new Set(
        (config.mspSubUnits || MSP_SUB_UNITS)
          .map((u) => String(u || '').trim())
          .filter(Boolean)
      )
    ),
    updatedBy: config.updatedBy || 'Admin',
    updatedAt: new Date().toISOString(),
  };

  applyDynamicUnitsConfig(normalized);

  if (!client) {
    return normalized;
  }

  try {
    await client.storage.createBucket(UNITS_CONFIG_BUCKET, {
      public: true,
      fileSizeLimit: 52428800,
    });
  } catch {}

  const payload = JSON.stringify(normalized, null, 2);
  const { error } = await client.storage
    .from(UNITS_CONFIG_BUCKET)
    .upload(UNITS_CONFIG_PATH, Buffer.from(payload, 'utf-8'), {
      contentType: 'application/json',
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to save Units configuration to Supabase: ${error.message}`);
  }

  return normalized;
}

/**
 * Server-side anon client used to perform signInWithPassword and obtain a genuine user JWT.
 */
export function getSupabaseAnonServerClient(): SupabaseClient | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey || !url.startsWith('https://')) {
    return null;
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashPasswordWithSalt(rawPassword: string): string {
  const digest = crypto
    .createHmac('sha256', SERVER_SESSION_SECRET)
    .update(rawPassword.trim(), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

/**
 * Generates a deterministic internal password for Supabase Auth (auth.users) when
 * bridging an account whose password was already verified on the server.
 */
export function deriveSupabaseAuthPassword(authEmail: string): string {
  const hmac = crypto
    .createHmac('sha256', SERVER_SESSION_SECRET)
    .update(`sb_auth_pw:${authEmail.trim().toLowerCase()}`, 'utf8')
    .digest('hex');
  return `Nrep!${hmac.slice(0, 24)}9a`;
}

export function stripRolePrefixFromPassword(storedPassword?: string | null): string {
  if (!storedPassword) return '';
  return String(storedPassword).replace(/^role:[a-z_]+\|/i, '');
}

export function extractRoleFromStoredPassword(storedPassword?: string | null): UserRole | null {
  if (!storedPassword) return null;
  const match = String(storedPassword).match(/^role:([a-z_]+)\|/i);
  if (!match || !match[1]) return null;
  const raw = match[1].trim().toLowerCase();
  // Ignore legacy 'editor' or 'engineer' prefixes so they get upgraded to 'inspector' or 'lead_engineer'
  if (raw === 'editor' || raw === 'engineer') {
    return null;
  }
  if (raw === 'admin' || raw === 'lead_engineer' || raw === 'inspector' || raw === 'viewer') {
    return raw as UserRole;
  }
  return null;
}

export function normalizeRole(raw?: string | null): UserRole {
  const r = (raw || '').trim().toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'lead_engineer') return 'lead_engineer';
  if (r === 'inspector' || r === 'editor' || r === 'engineer') return 'inspector';
  if (r === 'viewer') return 'viewer';
  return 'viewer';
}

export function encodePasswordWithRole(
  storedPassword: string | undefined,
  role: UserRole
): string {
  const cleanHash = stripRolePrefixFromPassword(storedPassword);
  const canonicalRole: UserRole = normalizeRole(role);
  return `role:${canonicalRole}|${cleanHash}`;
}

export function resolveAuthoritativeUserRole(params: {
  dbRole?: string | null;
  storedPassword?: string | null;
  appMetaRole?: string | null;
  inAdminsTable?: boolean;
}): UserRole {
  if (params.inAdminsTable || params.dbRole === 'admin') {
    return 'admin';
  }
  const pwRole = extractRoleFromStoredPassword(params.storedPassword);
  if (pwRole) {
    return pwRole;
  }
  if (params.appMetaRole) {
    const rawMeta = String(params.appMetaRole).trim().toLowerCase();
    if (rawMeta === 'admin' || rawMeta === 'lead_engineer' || rawMeta === 'inspector' || rawMeta === 'viewer') {
      return rawMeta as UserRole;
    }
  }
  return normalizeRole(params.dbRole);
}

export function sanitizeProfileForClient(profile: UserProfile): UserProfile {
  const copy: UserProfile = { ...profile };
  const pwRole = extractRoleFromStoredPassword(copy.password);
  if (pwRole && copy.role !== 'admin') {
    copy.role = pwRole;
  } else {
    copy.role = normalizeRole(copy.role);
  }
  delete copy.password;
  return copy;
}

/**
 * Upserts a user into public.users. If the database still has the legacy 3-value
 * users_role_check constraint ('admin','editor','viewer') prior to running rls_remediation.sql,
 * falls back to storing 'editor' in public.users.role while encoding the exact granular role
 * ('lead_engineer' or 'inspector') in the server-only password field and auth.users.app_metadata.
 */
export async function upsertPublicUserSafe(
  sbAdmin: SupabaseClient,
  record: UserProfile
): Promise<{ error: any; constraintBlocked?: boolean }> {
  const canonicalRole = normalizeRole(record.role);
  const encodedPassword = encodePasswordWithRole(record.password, canonicalRole);
  const recordWithEncodedRole: UserProfile = {
    ...record,
    role: canonicalRole,
    password: encodedPassword,
  };

  const { error } = await sbAdmin
    .from('users')
    .upsert(recordWithEncodedRole, { onConflict: 'uid' });
  if (error && (error.code === '23514' || String(error.message).includes('users_role_check'))) {
    const fallbackRole: UserRole =
      canonicalRole === 'admin'
        ? 'admin'
        : canonicalRole === 'viewer'
        ? 'viewer'
        : 'editor';
    const fallbackRecord: UserProfile = {
      ...recordWithEncodedRole,
      role: fallbackRole,
    };
    const retry = await sbAdmin.from('users').upsert(fallbackRecord, { onConflict: 'uid' });
    return { error: retry.error, constraintBlocked: true };
  }
  return { error, constraintBlocked: false };
}

/**
 * Provisions or synchronizes a user in Supabase Auth (auth.users), links their UUID (auth.uid())
 * in public.users and public.admins, and signs them in to return a real Supabase Auth JWT session.
 */
export async function provisionAndSignInSupabaseUser(params: {
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  assignedUnits?: string;
  hashedPassword?: string;
  legacyUid?: string;
}): Promise<{
  authUid: string;
  profile: UserProfile;
  session: { access_token: string; refresh_token: string } | null;
}> {
  const sbAdmin = getSupabaseAdminClient();
  const sbAnon = getSupabaseAnonServerClient();
  const cleanEmail = params.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();

  if (!sbAdmin || !sbAnon) {
    const fallbackProfile: UserProfile = {
      uid: params.legacyUid || cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_'),
      email: cleanEmail,
      displayName: params.displayName,
      role: params.role,
      status: params.status,
      assignedUnits: params.assignedUnits || 'All',
      createdAt: nowIso,
      lastLoginAt: nowIso,
    };
    return { authUid: fallbackProfile.uid, profile: fallbackProfile, session: null };
  }

  const internalAuthPassword = deriveSupabaseAuthPassword(cleanEmail);

  // 1. Check if auth.users entry already exists for this email
  const { data: listData } = await sbAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existingAuthUser = listData?.users?.find(
    (u) => u.email?.toLowerCase() === cleanEmail
  );

  let authUserId: string;

  if (!existingAuthUser) {
    const { data: created, error: createErr } = await sbAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: internalAuthPassword,
      email_confirm: true,
      user_metadata: {
        displayName: params.displayName,
        legacyUid: params.legacyUid || cleanEmail,
      },
      app_metadata: {
        role: params.role,
        status: params.status,
        assignedUnits: params.assignedUnits || 'All',
        legacyUid: params.legacyUid || cleanEmail,
      },
    });

    if (createErr || !created?.user) {
      throw new Error(`Failed to provision Supabase Auth user: ${createErr?.message || 'Unknown error'}`);
    }
    authUserId = created.user.id;
  } else {
    authUserId = existingAuthUser.id;
    await sbAdmin.auth.admin.updateUserById(authUserId, {
      password: internalAuthPassword,
      email_confirm: true,
      user_metadata: {
        ...existingAuthUser.user_metadata,
        displayName: params.displayName,
      },
      app_metadata: {
        ...existingAuthUser.app_metadata,
        role: params.role,
        status: params.status,
        assignedUnits: params.assignedUnits || 'All',
      },
    });
  }

  // 2. Ensure public.users has a row keyed by uid = authUserId (so RLS uid = auth.uid()::text works directly)
  const { data: existingPublicRow } = await sbAdmin
    .from('users')
    .select('*')
    .eq('uid', authUserId)
    .maybeSingle();

  const { data: emailRows } = await sbAdmin
    .from('users')
    .select('*')
    .ilike('email', cleanEmail);

  const specificScopedRow = (emailRows || []).find(
    (r: any) => r.assignedUnits && String(r.assignedUnits).trim() !== '' && String(r.assignedUnits).trim().toLowerCase() !== 'all'
  );

  const resolvedAssignedUnits =
    params.assignedUnits && params.assignedUnits !== 'All'
      ? params.assignedUnits
      : existingPublicRow?.assignedUnits && existingPublicRow.assignedUnits !== 'All'
      ? existingPublicRow.assignedUnits
      : specificScopedRow?.assignedUnits
      ? specificScopedRow.assignedUnits
      : existingAuthUser?.app_metadata?.assignedUnits && existingAuthUser.app_metadata.assignedUnits !== 'All'
      ? String(existingAuthUser.app_metadata.assignedUnits)
      : params.assignedUnits || existingPublicRow?.assignedUnits || 'All';

  const rawBasePassword =
    params.hashedPassword ||
    stripRolePrefixFromPassword(existingPublicRow?.password) ||
    hashPasswordWithSalt(internalAuthPassword);

  const syncedRecord: UserProfile = {
    uid: authUserId,
    email: cleanEmail,
    displayName: params.displayName,
    role: params.role,
    status: params.status,
    password: encodePasswordWithRole(rawBasePassword, params.role),
    assignedUnits: resolvedAssignedUnits,
    createdAt: existingPublicRow?.createdAt || nowIso,
    lastLoginAt: nowIso,
  };

  await upsertPublicUserSafe(sbAdmin, syncedRecord);

  // Keep any legacy rows with the same email synchronized on assignedUnits and encoded role password
  if (emailRows && emailRows.length > 0) {
    await sbAdmin
      .from('users')
      .update({
        assignedUnits: resolvedAssignedUnits,
        password: syncedRecord.password,
      })
      .ilike('email', cleanEmail);
  }

  // 3. Sync public.admins table with authUserId
  if (params.role === 'admin') {
    await sbAdmin.from('admins').upsert(
      {
        uid: authUserId,
        email: cleanEmail,
        assignedAt: nowIso,
      },
      { onConflict: 'uid' }
    );
  } else {
    await sbAdmin.from('admins').delete().eq('uid', authUserId);
  }

  // 4. Sign in via Supabase Auth to issue a genuine JWT where auth.uid() == authUserId
  let sessionTokens: { access_token: string; refresh_token: string } | null = null;
  const { data: signInData, error: signInErr } = await sbAnon.auth.signInWithPassword({
    email: cleanEmail,
    password: internalAuthPassword,
  });

  if (!signInErr && signInData?.session) {
    sessionTokens = {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    };
  }

  return {
    authUid: authUserId,
    profile: sanitizeProfileForClient(syncedRecord),
    session: sessionTokens,
  };
}

export function signSessionToken(
  profile: UserProfile,
  supabaseSession?: { access_token: string; refresh_token: string } | null
): string {
  const safeProfile = sanitizeProfileForClient(profile);
  const payload = Buffer.from(
    JSON.stringify({
      profile: safeProfile,
      sb: supabaseSession || null,
      iat: Date.now(),
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }),
    'utf8'
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', SERVER_SESSION_SECRET)
    .update(payload, 'utf8')
    .digest('base64url');

  return `${payload}.${sig}`;
}

export function verifySessionCookieToken(token: string): {
  profile: UserProfile;
  supabaseSession: { access_token: string; refresh_token: string } | null;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SERVER_SESSION_SECRET)
      .update(payload, 'utf8')
      .digest('base64url');

    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded || !decoded.profile || (decoded.exp && Date.now() > decoded.exp)) {
      return null;
    }
    return {
      profile: sanitizeProfileForClient(decoded.profile as UserProfile),
      supabaseSession: decoded.sb || null,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the caller's identity and live database role from either:
 * 1. Authorization: Bearer <supabase_access_token> (verified via Supabase Auth getUser)
 * 2. HttpOnly HMAC-signed session cookie (nrep_session)
 *
 * NEVER trusts client-supplied role or UID parameters in request bodies/queries.
 */
export async function verifyAuthenticatedCaller(req: NextRequest): Promise<{
  authenticated: boolean;
  profile: UserProfile | null;
  isAdmin: boolean;
  canWriteEquipment: boolean;
  canReadAuditLogs: boolean;
  error?: string;
  statusCode?: number;
}> {
  const sbAdmin = getSupabaseAdminClient();
  let candidateUid: string | null = null;
  let candidateEmail: string | null = null;
  let appMetaRole: UserRole | null = null;
  let appMetaAssignedUnits: string | null = null;
  let cookieFallbackProfile: UserProfile | null = null;

  // 1. Check Authorization: Bearer <jwt> header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ') && sbAdmin) {
    const jwt = authHeader.slice('Bearer '.length).trim();
    if (jwt) {
      const { data: userData, error: userErr } = await sbAdmin.auth.getUser(jwt);
      if (!userErr && userData?.user) {
        candidateUid = userData.user.id;
        candidateEmail = userData.user.email?.toLowerCase() || null;
        if (userData.user.app_metadata?.role) {
          appMetaRole = normalizeRole(userData.user.app_metadata.role);
        }
        if (userData.user.app_metadata?.assignedUnits) {
          appMetaAssignedUnits = String(userData.user.app_metadata.assignedUnits);
        }
      }
    }
  }

  // 2. Check HttpOnly session cookie if no Bearer header resolved
  if (!candidateUid) {
    const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookieToken) {
      const verifiedCookie = verifySessionCookieToken(cookieToken);
      if (verifiedCookie?.profile) {
        candidateUid = verifiedCookie.profile.uid;
        candidateEmail = verifiedCookie.profile.email?.toLowerCase() || null;
        cookieFallbackProfile = verifiedCookie.profile;
      }
    }
  }

  if (!candidateUid) {
    return {
      authenticated: false,
      profile: null,
      isAdmin: false,
      canWriteEquipment: false,
      canReadAuditLogs: false,
      error: 'Unauthorized: Authentication required.',
      statusCode: 401,
    };
  }

  // 3. Look up authoritative user record from public.users and public.admins on the server
  let dbProfile: UserProfile | null = null;
  let inAdminsTable = false;

  if (sbAdmin) {
    const { data: byUid } = await sbAdmin
      .from('users')
      .select('*')
      .eq('uid', candidateUid)
      .maybeSingle();

    if (byUid) {
      dbProfile = byUid as UserProfile;
    }

    if (candidateEmail) {
      const { data: byEmail } = await sbAdmin
        .from('users')
        .select('*')
        .ilike('email', candidateEmail);
      if (byEmail && byEmail.length > 0) {
        if (!dbProfile) {
          dbProfile = byEmail[0] as UserProfile;
        }
        // If any row for this email has a specific assignedUnits scope, ensure it is respected
        const scopedRow = byEmail.find(
          (r: any) =>
            r.assignedUnits &&
            String(r.assignedUnits).trim() !== '' &&
            String(r.assignedUnits).trim().toLowerCase() !== 'all'
        );
        if (
          scopedRow &&
          (!dbProfile.assignedUnits || dbProfile.assignedUnits.trim().toLowerCase() === 'all')
        ) {
          dbProfile = { ...dbProfile, assignedUnits: scopedRow.assignedUnits };
        }
        // If any row for this email has an encoded role in password, preserve it
        const rowWithRolePrefix = byEmail.find((r: any) =>
          Boolean(extractRoleFromStoredPassword(r.password))
        );
        if (rowWithRolePrefix && !extractRoleFromStoredPassword(dbProfile.password)) {
          dbProfile = { ...dbProfile, password: rowWithRolePrefix.password };
        }
      }
    }

    const { data: adminRow } = await sbAdmin
      .from('admins')
      .select('uid')
      .eq('uid', candidateUid)
      .maybeSingle();

    if (adminRow) {
      inAdminsTable = true;
    }
  }

  const effectiveProfile = dbProfile || cookieFallbackProfile;
  if (!effectiveProfile) {
    return {
      authenticated: false,
      profile: null,
      isAdmin: false,
      canWriteEquipment: false,
      canReadAuditLogs: false,
      error: 'Unauthorized: User profile not found in registry.',
      statusCode: 401,
    };
  }

  // Resolve authoritative granular role from password tag, auth.users.app_metadata, or public.users
  const resolvedRole: UserRole = resolveAuthoritativeUserRole({
    dbRole: effectiveProfile.role,
    storedPassword: effectiveProfile.password,
    appMetaRole: appMetaRole || cookieFallbackProfile?.role,
    inAdminsTable,
  });

  const resolvedStatus: UserStatus =
    resolvedRole === 'admin' ? 'approved' : effectiveProfile.status || 'pending';

  const resolvedAssignedUnits: string =
    effectiveProfile.assignedUnits &&
    effectiveProfile.assignedUnits.trim() !== '' &&
    effectiveProfile.assignedUnits.trim().toLowerCase() !== 'all'
      ? effectiveProfile.assignedUnits.trim()
      : appMetaAssignedUnits && appMetaAssignedUnits.trim().toLowerCase() !== 'all'
      ? appMetaAssignedUnits.trim()
      : effectiveProfile.assignedUnits || 'All';

  if (resolvedStatus !== 'approved') {
    return {
      authenticated: true,
      profile: sanitizeProfileForClient({
        ...effectiveProfile,
        role: resolvedRole,
        status: resolvedStatus,
        assignedUnits: resolvedAssignedUnits,
      }),
      isAdmin: false,
      canWriteEquipment: false,
      canReadAuditLogs: false,
      error: `Forbidden: Account status is "${resolvedStatus}". Administrator approval is required.`,
      statusCode: 403,
    };
  }

  const isAdmin = resolvedRole === 'admin' || inAdminsTable;
  const canWriteEquipment =
    isAdmin ||
    resolvedRole === 'lead_engineer' ||
    resolvedRole === 'engineer' ||
    resolvedRole === 'inspector' ||
    resolvedRole === 'editor';
  const canReadAuditLogs = isAdmin || resolvedRole === 'lead_engineer';

  return {
    authenticated: true,
    profile: sanitizeProfileForClient({
      ...effectiveProfile,
      uid: candidateUid,
      role: resolvedRole,
      status: resolvedStatus,
      assignedUnits: resolvedAssignedUnits,
    }),
    isAdmin,
    canWriteEquipment,
    canReadAuditLogs,
  };
}

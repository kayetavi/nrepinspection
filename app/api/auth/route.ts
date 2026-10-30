import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { UserProfile, UserRole, UserStatus } from '@/lib/types';

// Server-only secrets (never exposed to client bundle)
const SERVER_ADMIN_EMAIL = (process.env.ADMIN_BOOTSTRAP_EMAIL || 'kayetavijit97@gmail.com').trim().toLowerCase();
const SERVER_ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
const SERVER_VIEWER_DEFAULT_PASSWORD = process.env.VIEWER_DEFAULT_PASSWORD || 'viewer123';
const SERVER_SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET || 'nrep-nrl-server-hmac-secret-key-2026-secure';

// Legacy SHA-256 hashes moved from client AuthModal.tsx to backend
const LEGACY_SHA256_HASHES: Record<string, string> = {
  admin: '4e089f2da94eb0ca20d6914d33fd32a2c92e262e9daef473dd502e24ce25096c',
  viewer: 'ad943c304c5b4aa137af856f43cdd030ff6198e172c3955a6b78dcdd2c41260a',
};

const SESSION_COOKIE_NAME = 'nrep_session';

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hashPasswordWithSalt(rawPassword: string): string {
  const digest = crypto
    .createHmac('sha256', SERVER_SESSION_SECRET)
    .update(rawPassword.trim(), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

function verifyPasswordOnServer(
  inputPassword: string,
  storedPassword: string | undefined,
  accountKey?: string
): boolean {
  const cleanInput = inputPassword.trim();

  if (storedPassword && storedPassword.trim() !== '') {
    const cleanStored = storedPassword.trim();

    // 1. Check server HMAC-hashed password format (sha256:<hex>)
    if (cleanStored.startsWith('sha256:')) {
      const expected = hashPasswordWithSalt(cleanInput);
      if (expected.length === cleanStored.length) {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleanStored));
      }
      return false;
    }

    // 2. Check if stored password matches raw SHA-256 hex
    const inputSha = sha256Hex(cleanInput);
    if (cleanStored.length === 64 && /^[0-9a-f]+$/i.test(cleanStored)) {
      return inputSha.toLowerCase() === cleanStored.toLowerCase();
    }

    // 3. Fallback for existing legacy plaintext passwords in Firestore
    if (cleanInput === cleanStored) {
      return true;
    }
  }

  // 4. Built-in account fallback checks on server
  if (accountKey === 'admin') {
    const inputSha = sha256Hex(cleanInput);
    return (
      cleanInput === SERVER_ADMIN_DEFAULT_PASSWORD ||
      cleanInput === 'admin' ||
      inputSha === LEGACY_SHA256_HASHES.admin
    );
  }

  if (accountKey === 'viewer') {
    const inputSha = sha256Hex(cleanInput);
    return (
      cleanInput === SERVER_VIEWER_DEFAULT_PASSWORD ||
      cleanInput === 'viewer' ||
      inputSha === LEGACY_SHA256_HASHES.viewer
    );
  }

  return false;
}

function sanitizeProfileForClient(profile: UserProfile): UserProfile {
  const copy: UserProfile = { ...profile };
  delete copy.password;
  return copy;
}

function signSessionToken(profile: UserProfile): string {
  const safeProfile = sanitizeProfileForClient(profile);
  const payload = Buffer.from(
    JSON.stringify({
      profile: safeProfile,
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

function verifySessionToken(token: string): UserProfile | null {
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
    return sanitizeProfileForClient(decoded.profile as UserProfile);
  } catch {
    return null;
  }
}

function attachSessionCookie(res: NextResponse, profile: UserProfile) {
  const token = signSessionToken(profile);
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false, profile: null });
  }
  const profile = verifySessionToken(token);
  if (!profile) {
    return NextResponse.json({ authenticated: false, profile: null });
  }
  const isAdmin =
    profile.role === 'admin' || profile.email?.toLowerCase() === SERVER_ADMIN_EMAIL;
  return NextResponse.json({
    authenticated: true,
    profile,
    isAdmin,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // 1. Verify User ID / Email & Password on Backend
    if (action === 'verify-credentials') {
      const rawInput = String(body.usernameOrEmail || '').trim();
      const u = rawInput.toLowerCase();
      const p = String(body.password || '').trim();
      const firestoreUser = body.firestoreUser as UserProfile | null | undefined;

      if (!u) {
        return NextResponse.json(
          { ok: false, error: 'Please enter User ID or Email.' },
          { status: 400 }
        );
      }

      const isAdminUser = u === 'admin' || u === SERVER_ADMIN_EMAIL;
      const isViewerUser = u === 'viewer';
      const nowIso = new Date().toISOString();

      // Case A: User record exists in Firestore
      if (firestoreUser) {
        if (firestoreUser.status === 'suspended') {
          return NextResponse.json(
            { ok: false, error: 'Your account has been suspended by the administrator.' },
            { status: 403 }
          );
        }

        const hasStoredPassword =
          typeof firestoreUser.password === 'string' && firestoreUser.password.trim() !== '';

        if (hasStoredPassword) {
          const valid = verifyPasswordOnServer(
            p,
            firestoreUser.password,
            isAdminUser ? 'admin' : isViewerUser ? 'viewer' : undefined
          );
          if (!valid) {
            return NextResponse.json(
              { ok: false, error: 'Incorrect password. Please try again.' },
              { status: 401 }
            );
          }
        }

        const nextHashedPassword = p
          ? hashPasswordWithSalt(p)
          : firestoreUser.password && firestoreUser.password.startsWith('sha256:')
          ? firestoreUser.password
          : firestoreUser.password
          ? hashPasswordWithSalt(firestoreUser.password)
          : undefined;

        const updatedRecord: UserProfile = {
          ...firestoreUser,
          role: isAdminUser ? 'admin' : firestoreUser.role,
          status: isAdminUser ? 'approved' : firestoreUser.status,
          lastLoginAt: nowIso,
          ...(nextHashedPassword ? { password: nextHashedPassword } : {}),
        };

        const clientProfile = sanitizeProfileForClient(updatedRecord);
        const res = NextResponse.json({
          ok: true,
          profile: clientProfile,
          firestoreRecordToSync: updatedRecord,
          isAdmin:
            clientProfile.role === 'admin' ||
            clientProfile.email?.toLowerCase() === SERVER_ADMIN_EMAIL,
        });
        attachSessionCookie(res, clientProfile);
        return res;
      }

      // Case B: Built-in Server Accounts (admin / viewer / bootstrap email)
      if (isAdminUser || isViewerUser) {
        const accountKey = isAdminUser ? 'admin' : 'viewer';
        if (p) {
          const valid = verifyPasswordOnServer(p, undefined, accountKey);
          if (!valid) {
            return NextResponse.json(
              { ok: false, error: 'Incorrect password. Please try again.' },
              { status: 401 }
            );
          }
        }

        const defaultRole: UserRole = isAdminUser ? 'admin' : 'viewer';
        const defaultEmail = isAdminUser ? SERVER_ADMIN_EMAIL : `${u}@nrl.co.in`;
        const defaultName = isAdminUser ? 'admin' : 'viewer';
        const rawSecretPass =
          p || (isAdminUser ? SERVER_ADMIN_DEFAULT_PASSWORD : SERVER_VIEWER_DEFAULT_PASSWORD);

        const fullRecord: UserProfile = {
          uid: isAdminUser ? 'admin' : 'viewer',
          email: defaultEmail,
          displayName: defaultName,
          role: defaultRole,
          status: 'approved',
          password: hashPasswordWithSalt(rawSecretPass),
          assignedUnits: 'All',
          createdAt: nowIso,
          lastLoginAt: nowIso,
        };

        const clientProfile = sanitizeProfileForClient(fullRecord);
        const res = NextResponse.json({
          ok: true,
          profile: clientProfile,
          firestoreRecordToSync: fullRecord,
          isAdmin: isAdminUser,
        });
        attachSessionCookie(res, clientProfile);
        return res;
      }

      return NextResponse.json(
        {
          ok: false,
          error: `User "${rawInput}" is not found in registry. Please ask an Admin to grant you access.`,
        },
        { status: 404 }
      );
    }

    // 2. Sync Google Authenticated User on Backend
    if (action === 'sync-google-user') {
      const uid = String(body.uid || '').trim();
      const email = String(body.email || '').trim();
      const displayName = String(body.displayName || '').trim();
      const existingProfile = body.existingProfile as UserProfile | null | undefined;

      if (!uid) {
        return NextResponse.json({ ok: false, error: 'Missing UID' }, { status: 400 });
      }

      const isBootstrapAdmin = email.toLowerCase() === SERVER_ADMIN_EMAIL;
      const nowIso = new Date().toISOString();

      let resolvedProfile: UserProfile;
      if (!existingProfile) {
        const initialRole: UserRole = isBootstrapAdmin ? 'admin' : 'viewer';
        const initialStatus: UserStatus = isBootstrapAdmin ? 'approved' : 'pending';
        resolvedProfile = {
          uid,
          email,
          displayName: displayName || email.split('@')[0] || 'Engineer',
          role: initialRole,
          status: initialStatus,
          assignedUnits: 'All',
          createdAt: nowIso,
          lastLoginAt: nowIso,
        };
      } else {
        resolvedProfile = {
          ...existingProfile,
          role: isBootstrapAdmin ? 'admin' : existingProfile.role,
          status: isBootstrapAdmin ? 'approved' : existingProfile.status,
          lastLoginAt: nowIso,
        };
      }

      const clientProfile = sanitizeProfileForClient(resolvedProfile);
      const res = NextResponse.json({
        ok: true,
        profile: clientProfile,
        firestoreRecordToSync: resolvedProfile,
        isBootstrapAdmin,
        isAdmin: clientProfile.role === 'admin' || isBootstrapAdmin,
      });
      attachSessionCookie(res, clientProfile);
      return res;
    }

    // 3. Hash a password on Backend before storing in Firestore
    if (action === 'hash-password') {
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

    // 4. Provide server-generated default admin seed record (without exposing raw secrets in client bundle)
    if (action === 'get-bootstrap-admin-seed') {
      const nowIso = new Date().toISOString();
      const defaultAdmin: UserProfile = {
        uid: 'admin',
        email: SERVER_ADMIN_EMAIL,
        displayName: 'admin',
        role: 'admin',
        status: 'approved',
        password: hashPasswordWithSalt(SERVER_ADMIN_DEFAULT_PASSWORD),
        assignedUnits: 'All',
        createdAt: nowIso,
        lastLoginAt: 'System Master Admin',
      };
      return NextResponse.json({
        ok: true,
        adminRecord: defaultAdmin,
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

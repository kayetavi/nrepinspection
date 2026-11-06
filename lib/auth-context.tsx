'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from './supabase';
import { UserProfile, isWriteCapableRole } from './types';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  profile: UserProfile | null;
  accessToken: string | null;
  loading: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  isApproved: boolean;
  isGuest: boolean;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  sessionExpiredNotice: string | null;
  setSessionExpiredNotice: (msg: string | null) => void;
  recoverySession: { email: string; accessToken: string } | null;
  recoveryLinkNotice: string | null;
  recoveryPrefillUser: string;
  clearRecoverySession: () => void;
  signInWithGoogle: () => Promise<void>;
  loginWithCredentials: (
    usernameOrEmail: string,
    password?: string,
    onStep?: (step: 'verifying' | 'session' | 'authenticated') => void
  ) => Promise<boolean>;
  requestPasswordReset: (
    usernameOrEmail: string
  ) => Promise<{ ok: boolean; message: string; email?: string }>;
  resetPassword: (params: {
    usernameOrEmail: string;
    newPassword: string;
    recoveryAccessToken?: string;
    recoveryOtp?: string;
  }) => Promise<{ ok: boolean; message: string; email?: string }>;
  setGuestMode: (guest: boolean) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  accessToken: null,
  loading: true,
  isAdmin: false,
  isEditor: false,
  isApproved: false,
  isGuest: false,
  showLoginModal: false,
  setShowLoginModal: () => {},
  sessionExpiredNotice: null,
  setSessionExpiredNotice: () => {},
  recoverySession: null,
  recoveryLinkNotice: null,
  recoveryPrefillUser: '',
  clearRecoverySession: () => {},
  signInWithGoogle: async () => {},
  loginWithCredentials: async () => false,
  requestPasswordReset: async () => ({ ok: false, message: '' }),
  resetPassword: async () => ({ ok: false, message: '' }),
  setGuestMode: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const LOCAL_USERS_REGISTRY_KEY = 'nrep_users_registry_v1';
export const SUPABASE_ACCESS_TOKEN_STORAGE_KEY = 'nrep_sb_access_token';
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes of inactivity auto-logout
export const LAST_ACTIVITY_STORAGE_KEY = 'nrep_last_activity_ts';

function stripSecrets(profile: UserProfile): UserProfile {
  const clean = { ...profile };
  delete clean.password;
  return clean;
}

export function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (
      sessionStorage.getItem(SUPABASE_ACCESS_TOKEN_STORAGE_KEY) ||
      localStorage.getItem(SUPABASE_ACCESS_TOKEN_STORAGE_KEY) ||
      null
    );
  } catch {
    return null;
  }
}

export function buildAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  const token = getStoredAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function loadLocalUsersRegistry(): UserProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_USERS_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((u: UserProfile) => stripSecrets(u));
    }
  } catch {}
  return [];
}

export function saveLocalUsersRegistry(users: UserProfile[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LOCAL_USERS_REGISTRY_KEY,
      JSON.stringify(users.map(stripSecrets))
    );
  } catch {}
}

interface InitialRecoveryUrlState {
  isRecoveryUrl: boolean;
  session: { email: string; accessToken: string } | null;
  errorNotice: string | null;
  prefillEmail: string;
}

function decodeJwtEmail(jwt: string): string {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return '';
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json);
    return typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
  } catch {
    return '';
  }
}

function parseInitialRecoveryFromUrl(): InitialRecoveryUrlState {
  if (typeof window === 'undefined') {
    return { isRecoveryUrl: false, session: null, errorNotice: null, prefillEmail: '' };
  }
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

    const hashType = hashParams.get('type') || '';
    const searchType = searchParams.get('type') || '';
    const isResetRecoveryFlag = searchParams.get('reset_recovery') === '1';
    const prefillEmail = (searchParams.get('reset_email') || '').trim();

    const errorCode = hashParams.get('error_code') || searchParams.get('error_code') || '';
    const errorDesc =
      hashParams.get('error_description') || searchParams.get('error_description') || '';
    const hasError = Boolean(
      errorCode || hashParams.get('error') || searchParams.get('error')
    );

    const isRecoveryUrl =
      hashType === 'recovery' ||
      searchType === 'recovery' ||
      isResetRecoveryFlag ||
      errorCode === 'otp_expired' ||
      errorDesc.toLowerCase().includes('email link');

    const accessToken = (
      hashParams.get('access_token') ||
      searchParams.get('access_token') ||
      ''
    ).trim();

    if (accessToken && (isRecoveryUrl || hashType === 'recovery')) {
      const email = decodeJwtEmail(accessToken) || prefillEmail || 'Verified User';
      return {
        isRecoveryUrl: true,
        session: { email, accessToken },
        errorNotice: null,
        prefillEmail: email,
      };
    }

    if (hasError && isRecoveryUrl) {
      return {
        isRecoveryUrl: true,
        session: null,
        errorNotice:
          'Ye email reset link pehle use ho chuka hai ya expire ho gaya hai (ek reset link sirf 1 baar click ho sakta hai). Kripya niche "Send Reset Email" click karke naya reset link mangwayein.',
        prefillEmail,
      };
    }

    return {
      isRecoveryUrl,
      session: null,
      errorNotice: null,
      prefillEmail,
    };
  } catch {
    return { isRecoveryUrl: false, session: null, errorNotice: null, prefillEmail: '' };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (typeof window === 'undefined') return null;
    const initRec = parseInitialRecoveryFromUrl();
    if (initRec.isRecoveryUrl) {
      return null;
    }
    try {
      const lastTsStr = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
      if (lastTsStr) {
        const lastTs = parseInt(lastTsStr, 10);
        if (Number.isFinite(lastTs) && Date.now() - lastTs >= INACTIVITY_TIMEOUT_MS) {
          return null;
        }
      }
      const storedProfile =
        localStorage.getItem('nrep_user_profile') ||
        sessionStorage.getItem('nrep_user_profile');
      if (storedProfile) {
        return stripSecrets(JSON.parse(storedProfile) as UserProfile);
      }
    } catch {}
    return null;
  });
  const [accessToken, setAccessToken] = useState<string | null>(() => getStoredAccessToken());
  const [serverIsAdmin, setServerIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
  const [recoverySession, setRecoverySession] = useState<{
    email: string;
    accessToken: string;
  } | null>(() => parseInitialRecoveryFromUrl().session);
  const [recoveryLinkNotice, setRecoveryLinkNotice] = useState<string | null>(
    () => parseInitialRecoveryFromUrl().errorNotice
  );
  const [recoveryPrefillUser, setRecoveryPrefillUser] = useState<string>(
    () => parseInitialRecoveryFromUrl().prefillEmail
  );
  const lastSyncedUidRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(0);
  const isSigningOutRef = useRef<boolean>(false);
  const isRecoveryModeRef = useRef<boolean>(
    typeof window !== 'undefined' ? parseInitialRecoveryFromUrl().isRecoveryUrl : false
  );

  const clearRecoverySession = useCallback(() => {
    isRecoveryModeRef.current = false;
    setRecoverySession(null);
    setRecoveryLinkNotice(null);
  }, []);

  const touchActivity = useCallback((ts?: number) => {
    const now = ts ?? Date.now();
    lastActivityRef.current = now;
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now));
    } catch {}
  }, []);

  const persistAccessToken = useCallback((token: string | null) => {
    setAccessToken(token);
    if (typeof window === 'undefined') return;
    try {
      if (token) {
        sessionStorage.setItem(SUPABASE_ACCESS_TOKEN_STORAGE_KEY, token);
        localStorage.setItem(SUPABASE_ACCESS_TOKEN_STORAGE_KEY, token);
      } else {
        sessionStorage.removeItem(SUPABASE_ACCESS_TOKEN_STORAGE_KEY);
        localStorage.removeItem(SUPABASE_ACCESS_TOKEN_STORAGE_KEY);
      }
    } catch {}
  }, []);

  const signOut = useCallback(async () => {
    isSigningOutRef.current = true;
    lastSyncedUidRef.current = null;

    // 1. Immediately and synchronously clear client auth state so UI switches to Login Page right away
    persistAccessToken(null);
    try {
      sessionStorage.clear();
      localStorage.removeItem('nrep_user_profile');
      localStorage.removeItem('nrep_user');
      localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
      localStorage.removeItem(SUPABASE_ACCESS_TOKEN_STORAGE_KEY);
      // Also remove any cached Supabase auth token keys from localStorage
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-')) {
          localStorage.removeItem(key);
        }
      }
    } catch {}

    setUser(null);
    setProfile(null);
    setServerIsAdmin(false);
    setIsGuest(false);
    setShowLoginModal(true);

    if (typeof window !== 'undefined') {
      window.location.hash = '';
      try {
        history.replaceState(null, '', window.location.pathname);
      } catch {}
    }

    // 2. Clean up Supabase & server session cookies asynchronously in the background
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch {}
    try {
      await fetch('/api/auth', { method: 'DELETE' });
    } catch {}
  }, [persistAccessToken]);

  // Sync profile from Supabase OAuth user via backend API (/api/auth) using verified JWT
  const syncProfile = async (authUser: AuthUser, jwtToken?: string | null, force = false) => {
    if (isSigningOutRef.current) return;
    if (!force && lastSyncedUidRef.current === authUser.uid) {
      return;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const tokenToUse = jwtToken || getStoredAccessToken();
      if (tokenToUse) {
        headers['Authorization'] = `Bearer ${tokenToUse}`;
      }

      const res = await fetch('/api/auth', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'sync-google-user',
          uid: authUser.uid,
          email: authUser.email || '',
          displayName: authUser.displayName || '',
        }),
      });

      if (!res.ok || isSigningOutRef.current) return;
      const data = await res.json().catch(() => null);
      if (data?.ok && data.profile && !isSigningOutRef.current) {
        lastSyncedUidRef.current = authUser.uid;
        const sanitized = stripSecrets(data.profile as UserProfile);
        setProfile(sanitized);
        setServerIsAdmin(Boolean(data.isAdmin));

        try {
          sessionStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
          localStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
        } catch {}
      }
    } catch {
      // Transient fetch interruption (e.g. tab visibility switch or dev server reload); retain existing profile state
    }
  };

  useEffect(() => {
    let isMounted = true;
    if (!lastActivityRef.current) {
      lastActivityRef.current = Date.now();
    }

    // Detect if the browser was opened via a Supabase Password Recovery email link BEFORE getSupabaseClient or inactivity timeout
    const checkIsRecoveryUrl = () => {
      if (typeof window === 'undefined') return false;
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      return (
        hash.includes('type=recovery') ||
        search.includes('type=recovery') ||
        search.includes('reset_recovery=1') ||
        hash.includes('error_code=otp_expired') ||
        search.includes('error_code=otp_expired')
      );
    };

    if (checkIsRecoveryUrl() || parseInitialRecoveryFromUrl().isRecoveryUrl) {
      isRecoveryModeRef.current = true;
    }

    const supabase = getSupabaseClient();

    // Check if an existing stored session already exceeded 15 minutes of inactivity before boot (skip if in recovery mode)
    if (!isRecoveryModeRef.current) {
      try {
        const storedActivityStr = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
        const hasStoredSession = Boolean(
          localStorage.getItem('nrep_user_profile') ||
          sessionStorage.getItem('nrep_user_profile') ||
          getStoredAccessToken()
        );
        if (hasStoredSession && storedActivityStr) {
          const lastTs = parseInt(storedActivityStr, 10);
          if (Number.isFinite(lastTs) && Date.now() - lastTs >= INACTIVITY_TIMEOUT_MS) {
            Promise.resolve().then(() => {
              if (!isMounted) return;
              setSessionExpiredNotice(
                'Your session has expired due to 15 minutes of inactivity. Please sign in again.'
              );
              signOut().finally(() => {
                if (isMounted) setLoading(false);
              });
            });
            return () => {
              isMounted = false;
            };
          }
        }
      } catch {}
    }

    // 1. Verify existing HttpOnly backend session or Supabase JWT on boot (skip if in email password recovery link flow)
    if (!isRecoveryModeRef.current) {
      fetch('/api/auth', {
        method: 'GET',
        headers: buildAuthHeaders(),
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(async (data) => {
          if (!isMounted || isSigningOutRef.current || isRecoveryModeRef.current) return;
          if (data?.authenticated && data?.profile) {
            const sanitized = stripSecrets(data.profile as UserProfile);
            lastSyncedUidRef.current = sanitized.uid;
            setProfile(sanitized);
            setUser({
              uid: sanitized.uid,
              email: sanitized.email,
              displayName: sanitized.displayName,
            });
            setServerIsAdmin(Boolean(data.isAdmin));
            if (data?.supabaseSession?.access_token) {
              persistAccessToken(data.supabaseSession.access_token);
              if (supabase && data.supabaseSession.refresh_token) {
                try {
                  await supabase.auth.setSession({
                    access_token: data.supabaseSession.access_token,
                    refresh_token: data.supabaseSession.refresh_token,
                  });
                } catch {}
              }
            }
            try {
              sessionStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
              localStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
            } catch {}
          } else if (supabase) {
            try {
              const { data: sbSession } = await supabase.auth.getSession();
              if (!sbSession?.session?.user && !isSigningOutRef.current) {
                lastSyncedUidRef.current = null;
                setProfile(null);
                setUser(null);
                setServerIsAdmin(false);
                persistAccessToken(null);
                try {
                  sessionStorage.removeItem('nrep_user_profile');
                  localStorage.removeItem('nrep_user_profile');
                } catch {}
              }
            } catch {}
          }
        })
        .catch(() => {})
        .finally(() => {
          if (isMounted) setLoading(false);
        });
    } else {
      setLoading(false);
    }

    if (!supabase) {
      return () => {
        isMounted = false;
      };
    }

    // 2. Check active Supabase Auth session
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!isMounted || isSigningOutRef.current) return;
        if (session?.user) {
          if (isRecoveryModeRef.current || checkIsRecoveryUrl()) {
            isRecoveryModeRef.current = true;
            setRecoverySession({
              email: session.user.email || '',
              accessToken: session.access_token,
            });
            setUser(null);
            setProfile(null);
            setShowLoginModal(true);
            setLoading(false);
            return;
          }
          persistAccessToken(session.access_token);
          const sbAuthUser: AuthUser = {
            uid: session.user.id,
            email: session.user.email ?? null,
            displayName:
              session.user.user_metadata?.full_name ||
              session.user.user_metadata?.name ||
              session.user.email?.split('@')[0] ||
              null,
          };
          setUser(sbAuthUser);
          syncProfile(sbAuthUser, session.access_token);
          setShowLoginModal(false);
        }
        setLoading(false);
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted || isSigningOutRef.current) return;
      if (event === 'PASSWORD_RECOVERY' || (session?.user && isRecoveryModeRef.current)) {
        isRecoveryModeRef.current = true;
        if (session?.user) {
          setRecoverySession({
            email: session.user.email || '',
            accessToken: session.access_token,
          });
        }
        setUser(null);
        setProfile(null);
        setShowLoginModal(true);
        setLoading(false);
        return;
      }
      if (session?.user) {
        persistAccessToken(session.access_token);
        const sbAuthUser: AuthUser = {
          uid: session.user.id,
          email: session.user.email ?? null,
          displayName:
            session.user.user_metadata?.full_name ||
            session.user.user_metadata?.name ||
            session.user.email?.split('@')[0] ||
            null,
        };
        setUser((prev) =>
          prev?.uid === sbAuthUser.uid &&
          prev?.email === sbAuthUser.email &&
          prev?.displayName === sbAuthUser.displayName
            ? prev
            : sbAuthUser
        );
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          await syncProfile(sbAuthUser, session.access_token);
        }
        setShowLoginModal(false);
      } else if (event === 'SIGNED_OUT') {
        lastSyncedUidRef.current = null;
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [persistAccessToken, signOut]);

  // Primitive boolean indicating whether the user is currently inside the app (matches app/page.tsx)
  const isSessionActive = Boolean(user || profile || isGuest);

  // 15-Minute Inactivity Auto-Logout Tracker
  useEffect(() => {
    if (!isSessionActive) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const triggerInactivityLogout = () => {
      setSessionExpiredNotice(
        'Your session has expired due to 15 minutes of inactivity. Please sign in again.'
      );
      signOut();
    };

    const scheduleDirectTimer = (lastTs: number) => {
      if (timeoutId) clearTimeout(timeoutId);
      const elapsed = Date.now() - lastTs;
      const remaining = Math.max(500, INACTIVITY_TIMEOUT_MS - elapsed);
      timeoutId = setTimeout(() => {
        checkInactivity();
      }, remaining);
    };

    const checkInactivity = () => {
      try {
        const storedStr = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
        const storedTs = storedStr ? parseInt(storedStr, 10) : NaN;
        const effectiveLastTs = Number.isFinite(storedTs)
          ? Math.max(storedTs, lastActivityRef.current)
          : lastActivityRef.current;

        if (Date.now() - effectiveLastTs >= INACTIVITY_TIMEOUT_MS) {
          triggerInactivityLogout();
          return true;
        }
        scheduleDirectTimer(effectiveLastTs);
      } catch {
        if (Date.now() - lastActivityRef.current >= INACTIVITY_TIMEOUT_MS) {
          triggerInactivityLogout();
          return true;
        }
      }
      return false;
    };

    // Initialize or validate existing activity timestamp without overwriting an already-expired timestamp
    try {
      const existingStr = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
      if (existingStr) {
        const existingTs = parseInt(existingStr, 10);
        if (Number.isFinite(existingTs)) {
          if (Date.now() - existingTs >= INACTIVITY_TIMEOUT_MS) {
            triggerInactivityLogout();
            return;
          }
          lastActivityRef.current = existingTs;
        } else {
          touchActivity();
        }
      } else {
        touchActivity();
      }
    } catch {
      touchActivity();
    }

    scheduleDirectTimer(lastActivityRef.current);

    let lastStorageWrite = Date.now();
    let lastMousePos: { x: number; y: number } | null = null;

    const handleUserActivity = (e: Event) => {
      // Ignore synthetic or sub-pixel stationary mousemove events fired by browser re-renders
      if (e.type === 'mousemove') {
        const me = e as MouseEvent;
        if (lastMousePos) {
          const dist = Math.hypot(me.clientX - lastMousePos.x, me.clientY - lastMousePos.y);
          if (dist < 4) return;
        }
        lastMousePos = { x: me.clientX, y: me.clientY };
      }

      const now = Date.now();
      // If somehow already past timeout before this event, log out immediately
      if (now - lastActivityRef.current >= INACTIVITY_TIMEOUT_MS) {
        triggerInactivityLogout();
        return;
      }

      lastActivityRef.current = now;
      if (now - lastStorageWrite >= 2000) {
        lastStorageWrite = now;
        touchActivity(now);
      }
      scheduleDirectTimer(now);
    };

    const activityEvents = ['mousedown', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { capture: true, passive: true });
    });

    const intervalId = setInterval(checkInactivity, 5000); // Check every 5 seconds

    const handleVisibilityOrFocus = () => {
      checkInactivity();
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_STORAGE_KEY && e.newValue) {
        const newTs = parseInt(e.newValue, 10);
        if (Number.isFinite(newTs)) {
          lastActivityRef.current = newTs;
          scheduleDirectTimer(newTs);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('storage', handleStorage);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, handleUserActivity, { capture: true });
      });
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('storage', handleStorage);
    };
  }, [isSessionActive, signOut, touchActivity]);

  const signInWithGoogle = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error(
        'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) are not configured yet. Please sign in with User ID & Password or configure Supabase keys.'
      );
    }
    isSigningOutRef.current = false;
    setSessionExpiredNotice(null);
    touchActivity();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    if (error) {
      throw error;
    }
  };

  // Server-verified login with User ID / Email & Password via /api/auth + Supabase Auth JWT
  const loginWithCredentials = async (
    usernameOrEmail: string,
    password?: string,
    onStep?: (step: 'verifying' | 'session' | 'authenticated') => void
  ): Promise<boolean> => {
    const rawInput = usernameOrEmail.trim();
    const p = (password || '').trim();
    if (!rawInput) throw new Error('Please enter User ID or Email.');

    isSigningOutRef.current = false;
    onStep?.('verifying');

    // Delegate credential verification and Supabase Auth JWT issuance strictly to server (/api/auth)
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify-credentials',
        usernameOrEmail: rawInput,
        password: p,
      }),
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Invalid user ID or password.');
    }

    onStep?.('session');

    const sanitizedProfile = stripSecrets(result.profile as UserProfile);
    lastSyncedUidRef.current = sanitizedProfile.uid;

    // Bind genuine Supabase Auth JWT session (auth.uid()) into the browser Supabase client
    const supabase = getSupabaseClient();
    if (result.supabaseSession?.access_token) {
      persistAccessToken(result.supabaseSession.access_token);
      if (supabase && result.supabaseSession.refresh_token) {
        try {
          await supabase.auth.setSession({
            access_token: result.supabaseSession.access_token,
            refresh_token: result.supabaseSession.refresh_token,
          });
        } catch (err: any) {
          console.warn('Supabase session bind note:', err?.message);
        }
      }
    }

    onStep?.('authenticated');

    touchActivity();
    setProfile(sanitizedProfile);
    setUser({
      uid: sanitizedProfile.uid,
      email: sanitizedProfile.email,
      displayName: sanitizedProfile.displayName,
    });
    setServerIsAdmin(Boolean(result.isAdmin));
    setIsGuest(false);
    setShowLoginModal(false);
    setSessionExpiredNotice(null);

    // Store only non-secret profile metadata in browser storage
    try {
      localStorage.setItem('nrep_user', sanitizedProfile.uid);
      localStorage.setItem('nrep_user_profile', JSON.stringify(sanitizedProfile));
      sessionStorage.setItem('nrep_user', sanitizedProfile.uid);
      sessionStorage.setItem('nrep_user_profile', JSON.stringify(sanitizedProfile));
    } catch {}

    if (typeof window !== 'undefined') {
      window.location.hash = '';
      try {
        history.replaceState(null, '', window.location.pathname);
      } catch {}
    }

    return true;
  };

  // Step 1: Trigger real Supabase password reset recovery email
  const requestPasswordReset = async (
    usernameOrEmail: string
  ): Promise<{ ok: boolean; message: string; email?: string }> => {
    const rawInput = usernameOrEmail.trim();
    if (!rawInput) throw new Error('Please enter your Username or Email.');

    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/?reset_recovery=1&reset_email=${encodeURIComponent(rawInput)}`
        : undefined;

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'request-password-reset',
        usernameOrEmail: rawInput,
        redirectTo,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data?.error || 'Failed to send password reset email.');
    }

    return {
      ok: true,
      message:
        data.message ||
        'Password reset email sent! Please check your email inbox for the reset link or recovery code.',
      email: data.email,
    };
  };

  // Step 2: Complete password reset using verified email recovery token or OTP code
  const resetPassword = async (params: {
    usernameOrEmail: string;
    newPassword: string;
    recoveryAccessToken?: string;
    recoveryOtp?: string;
  }): Promise<{ ok: boolean; message: string; email?: string }> => {
    const rawInput = (params.usernameOrEmail || '').trim();
    const p = (params.newPassword || '').trim();
    if (!p || p.length < 4) throw new Error('New password must be at least 4 characters.');

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reset-password',
        usernameOrEmail: rawInput,
        newPassword: p,
        recoveryAccessToken: params.recoveryAccessToken,
        recoveryOtp: params.recoveryOtp,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data?.error || 'Failed to update password.');
    }

    // Clean up any temporary recovery session after password update
    clearRecoverySession();
    try {
      const supabase = getSupabaseClient();
      if (supabase) await supabase.auth.signOut();
    } catch {}
    if (typeof window !== 'undefined') {
      try {
        history.replaceState(null, '', window.location.pathname);
      } catch {}
    }

    return {
      ok: true,
      message: data.message || 'Password successfully updated in Supabase Cloud!',
      email: data.email,
    };
  };

  const setGuestMode = (guest: boolean) => {
    if (guest) {
      isSigningOutRef.current = false;
      setSessionExpiredNotice(null);
      touchActivity();
      setShowLoginModal(false);
    }
    setIsGuest(guest);
  };

  const refreshProfile = useCallback(async () => {
    if (isSigningOutRef.current || isRecoveryModeRef.current) return;
    try {
      const res = await fetch('/api/auth', {
        method: 'GET',
        headers: buildAuthHeaders(),
        cache: 'no-store',
      });
      if (!res.ok || isSigningOutRef.current || isRecoveryModeRef.current) return;
      const data = await res.json().catch(() => null);
      if (data?.authenticated && data?.profile && !isSigningOutRef.current) {
        const sanitized = stripSecrets(data.profile as UserProfile);
        lastSyncedUidRef.current = sanitized.uid;
        setProfile(sanitized);
        setUser((prev) =>
          prev?.uid === sanitized.uid &&
          prev?.email === sanitized.email &&
          prev?.displayName === sanitized.displayName
            ? prev
            : {
                uid: sanitized.uid,
                email: sanitized.email,
                displayName: sanitized.displayName,
              }
        );
        setServerIsAdmin(Boolean(data.isAdmin));
        try {
          sessionStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
          localStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
        } catch {}
      }
    } catch {}
  }, []);

  // Live Realtime synchronization for the active user's profile (assignedUnits, role, status)
  useEffect(() => {
    if (!user?.uid && !profile?.uid) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel('nrep-active-user-profile-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users' },
        () => {
          refreshProfile();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.uid, profile?.uid, refreshProfile]);

  const isAdmin = profile?.role === 'admin' || serverIsAdmin;
  const isApproved = profile?.status === 'approved' || isAdmin;
  const isEditor = isAdmin || (isApproved && isWriteCapableRole(profile?.role));

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        accessToken,
        loading,
        isAdmin,
        isEditor,
        isApproved,
        isGuest,
        showLoginModal,
        setShowLoginModal,
        sessionExpiredNotice,
        setSessionExpiredNotice,
        recoverySession,
        recoveryLinkNotice,
        recoveryPrefillUser,
        clearRecoverySession,
        signInWithGoogle,
        loginWithCredentials,
        requestPasswordReset,
        resetPassword,
        setGuestMode,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from 'firebase/firestore';
import { auth, db, googleProvider, testFirestoreConnection } from './firebase';
import { UserProfile } from './types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  isApproved: boolean;
  isGuest: boolean;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  signInWithGoogle: () => Promise<void>;
  loginWithCredentials: (usernameOrEmail: string, password?: string) => Promise<boolean>;
  setGuestMode: (guest: boolean) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isEditor: false,
  isApproved: false,
  isGuest: false,
  showLoginModal: false,
  setShowLoginModal: () => {},
  signInWithGoogle: async () => {},
  loginWithCredentials: async () => false,
  setGuestMode: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

function stripSecrets(profile: UserProfile): UserProfile {
  const clean = { ...profile };
  delete clean.password;
  return clean;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const storedProfile =
        localStorage.getItem('nrep_user_profile') ||
        sessionStorage.getItem('nrep_user_profile');
      if (storedProfile) {
        return stripSecrets(JSON.parse(storedProfile) as UserProfile);
      }
    } catch {}
    return null;
  });
  const [serverIsAdmin, setServerIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Sync profile from Firebase Auth user via backend API (/api/auth)
  const syncProfile = async (firebaseUser: User) => {
    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const userSnap = await getDoc(userRef);
      const existingData = userSnap.exists()
        ? ({ uid: userSnap.id, ...(userSnap.data() as Omit<UserProfile, 'uid'>) } as UserProfile)
        : null;

      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync-google-user',
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || '',
          existingProfile: existingData,
        }),
      });

      const data = await res.json();
      if (data.ok && data.profile) {
        const sanitized = stripSecrets(data.profile as UserProfile);
        setProfile(sanitized);
        setServerIsAdmin(Boolean(data.isAdmin));

        try {
          sessionStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
          localStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
        } catch {}

        if (data.firestoreRecordToSync) {
          await setDoc(userRef, data.firestoreRecordToSync, { merge: true });
        }
        if (data.isBootstrapAdmin) {
          await setDoc(
            doc(db, 'admins', firebaseUser.uid),
            {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              assignedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      }
    } catch (error) {
      console.error('Error synchronizing user profile:', error);
    }
  };

  useEffect(() => {
    testFirestoreConnection();

    // Verify existing HttpOnly backend session on boot
    fetch('/api/auth', { method: 'GET' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.authenticated && data?.profile) {
          const sanitized = stripSecrets(data.profile as UserProfile);
          setProfile(sanitized);
          setServerIsAdmin(Boolean(data.isAdmin));
          try {
            sessionStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
            localStorage.setItem('nrep_user_profile', JSON.stringify(sanitized));
          } catch {}
        }
      })
      .catch(() => {});

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await syncProfile(currentUser);
        setShowLoginModal(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setIsGuest(false);
      setShowLoginModal(false);
      if (typeof window !== 'undefined') window.location.hash = '';
    } catch (error: any) {
      console.error('Google Sign-in failed:', error);
      throw error;
    }
  };

  // Server-verified login with User ID / Email & Password via /api/auth
  const loginWithCredentials = async (usernameOrEmail: string, password?: string): Promise<boolean> => {
    const rawInput = usernameOrEmail.trim();
    const u = rawInput.toLowerCase();
    const p = (password || '').trim();
    if (!u) throw new Error('Please enter User ID or Email.');

    const sanitizedId = u.replace(/[^a-zA-Z0-9_-]/g, '_');

    // 1. Check if user document exists in Firestore to pass to backend verifier
    let matchedProfile: UserProfile | null = null;
    let targetDocId = sanitizedId;

    try {
      const directSnap = await getDoc(doc(db, 'users', sanitizedId));
      if (directSnap.exists()) {
        matchedProfile = { uid: directSnap.id, ...(directSnap.data() as Omit<UserProfile, 'uid'>) };
        targetDocId = directSnap.id;
      } else {
        const rawSnap = await getDoc(doc(db, 'users', rawInput));
        if (rawSnap.exists()) {
          matchedProfile = { uid: rawSnap.id, ...(rawSnap.data() as Omit<UserProfile, 'uid'>) };
          targetDocId = rawSnap.id;
        } else {
          const qEmail = query(collection(db, 'users'), where('email', '==', u), limit(1));
          const emailSnap = await getDocs(qEmail);
          if (!emailSnap.empty) {
            const d = emailSnap.docs[0];
            matchedProfile = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
            targetDocId = d.id;
          } else {
            const qName = query(collection(db, 'users'), where('displayName', '==', rawInput), limit(1));
            const nameSnap = await getDocs(qName);
            if (!nameSnap.empty) {
              const d = nameSnap.docs[0];
              matchedProfile = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
              targetDocId = d.id;
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('Firestore user lookup note:', err.message);
    }

    // 2. Delegate password & secret verification strictly to backend (/api/auth)
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify-credentials',
        usernameOrEmail: rawInput,
        password: p,
        firestoreUser: matchedProfile,
      }),
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Invalid user ID or password.');
    }

    const sanitizedProfile = stripSecrets(result.profile as UserProfile);
    setProfile(sanitizedProfile);
    setServerIsAdmin(Boolean(result.isAdmin));
    setIsGuest(false);
    setShowLoginModal(false);

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

    // Sync server-prepared record (with hashed password) to Firestore
    if (result.firestoreRecordToSync) {
      const syncId = result.firestoreRecordToSync.uid || targetDocId;
      try {
        await setDoc(doc(db, 'users', syncId), result.firestoreRecordToSync, { merge: true });
        if (result.isAdmin) {
          await setDoc(
            doc(db, 'admins', syncId),
            {
              uid: syncId,
              email: result.firestoreRecordToSync.email,
              assignedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      } catch {}
    }

    return true;
  };

  const signOut = async () => {
    try {
      await fbSignOut(auth);
    } catch {}
    try {
      await fetch('/api/auth', { method: 'DELETE' });
    } catch {}
    try {
      sessionStorage.clear();
      localStorage.removeItem('nrep_user_profile');
      localStorage.removeItem('nrep_user');
    } catch {}
    setUser(null);
    setProfile(null);
    setServerIsAdmin(false);
    setIsGuest(false);
    setShowLoginModal(true);
    if (typeof window !== 'undefined') {
      window.location.hash = '';
    }
  };

  const setGuestMode = (guest: boolean) => {
    setIsGuest(guest);
    if (guest) {
      setShowLoginModal(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await syncProfile(user);
    }
  };

  const isAdmin = profile?.role === 'admin' || serverIsAdmin;
  const isApproved = profile?.status === 'approved' || isAdmin;
  const isEditor = isAdmin || (isApproved && profile?.role === 'editor');

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAdmin,
        isEditor,
        isApproved,
        isGuest,
        showLoginModal,
        setShowLoginModal,
        signInWithGoogle,
        loginWithCredentials,
        setGuestMode,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

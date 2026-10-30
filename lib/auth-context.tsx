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
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
} from 'firebase/firestore';
import { auth, db, googleProvider, testFirestoreConnection } from './firebase';
import { UserProfile, UserRole, UserStatus } from './types';

const ADMIN_BOOTSTRAP_EMAIL = 'kayetavijit97@gmail.com';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const storedProfile = localStorage.getItem('nrep_user_profile') || sessionStorage.getItem('nrep_user_profile');
      if (storedProfile) {
        return JSON.parse(storedProfile) as UserProfile;
      }
      const storedUser = localStorage.getItem('nrep_user') || sessionStorage.getItem('nrep_user');
      if (storedUser === 'admin' || storedUser === 'viewer') {
        const u = storedUser;
        const role = u === 'admin' ? 'admin' : 'viewer';
        return {
          uid: u,
          email: u === 'admin' ? ADMIN_BOOTSTRAP_EMAIL : `${u}@nrl.co.in`,
          displayName: u,
          role,
          status: 'approved',
          assignedUnits: 'All',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
      }
    } catch (e) {}
    return null;
  });
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Sync profile to Firestore
  const syncProfileToCloud = async (uProfile: UserProfile) => {
    try {
      const userRef = doc(db, 'users', uProfile.uid);
      await setDoc(userRef, uProfile, { merge: true });
      if (uProfile.role === 'admin') {
        const adminRef = doc(db, 'admins', uProfile.uid);
        await setDoc(adminRef, {
          uid: uProfile.uid,
          email: uProfile.email,
          assignedAt: new Date().toISOString(),
        }, { merge: true });
      }
    } catch (err) {
      console.warn('Could not sync user profile to cloud:', err);
    }
  };

  // Sync profile from Firebase Auth user
  const syncProfile = async (firebaseUser: User) => {
    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const userSnap = await getDoc(userRef);

      const isBootstrapAdmin =
        firebaseUser.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();

      let currentProfile: UserProfile;

      if (!userSnap.exists()) {
        const initialRole: UserRole = isBootstrapAdmin ? 'admin' : 'viewer';
        const initialStatus: UserStatus = isBootstrapAdmin ? 'approved' : 'pending';

        currentProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Engineer',
          role: initialRole,
          status: initialStatus,
          assignedUnits: 'All',
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };

        await setDoc(userRef, currentProfile);

        if (isBootstrapAdmin) {
          await setDoc(doc(db, 'admins', firebaseUser.uid), {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            assignedAt: new Date().toISOString(),
          });
        }
      } else {
        const data = userSnap.data() as UserProfile;
        if (isBootstrapAdmin && (data.role !== 'admin' || data.status !== 'approved')) {
          data.role = 'admin';
          data.status = 'approved';
          await setDoc(userRef, data, { merge: true });
          await setDoc(doc(db, 'admins', firebaseUser.uid), {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            assignedAt: new Date().toISOString(),
          });
        }

        currentProfile = {
          ...data,
          lastLoginAt: new Date().toISOString(),
        };
        await setDoc(userRef, { lastLoginAt: currentProfile.lastLoginAt }, { merge: true });
      }

      setProfile(currentProfile);
      sessionStorage.setItem('nrep_user_profile', JSON.stringify(currentProfile));
    } catch (error) {
      console.error('Error synchronizing user profile:', error);
      const isBootstrapAdmin =
        firebaseUser.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();
      const fallback: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || 'Engineer',
        role: isBootstrapAdmin ? 'admin' : 'viewer',
        status: isBootstrapAdmin ? 'approved' : 'pending',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      setProfile(fallback);
    }
  };

  useEffect(() => {
    testFirestoreConnection();

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

  // Direct login with User ID / credentials (supports admin, viewer, and custom users with assigned passwords)
  const loginWithCredentials = async (usernameOrEmail: string, password?: string): Promise<boolean> => {
    const rawInput = usernameOrEmail.trim();
    const u = rawInput.toLowerCase();
    const p = (password || '').trim();
    if (!u) throw new Error('Please enter User ID or Email.');

    const sanitizedId = u.replace(/[^a-zA-Z0-9_-]/g, '_');

    // 1. Check if user document exists in Firestore
    let matchedProfile: UserProfile | null = null;
    let targetDocId = sanitizedId;

    try {
      // Check direct docId (e.g. 'admin', 'viewer', or email sanitized)
      const directSnap = await getDoc(doc(db, 'users', sanitizedId));
      if (directSnap.exists()) {
        matchedProfile = { uid: directSnap.id, ...(directSnap.data() as Omit<UserProfile, 'uid'>) };
        targetDocId = directSnap.id;
      } else {
        // Also check if doc exists with rawInput
        const rawSnap = await getDoc(doc(db, 'users', rawInput));
        if (rawSnap.exists()) {
          matchedProfile = { uid: rawSnap.id, ...(rawSnap.data() as Omit<UserProfile, 'uid'>) };
          targetDocId = rawSnap.id;
        } else {
          // Query by email
          const qEmail = query(collection(db, 'users'), where('email', '==', u), limit(1));
          const emailSnap = await getDocs(qEmail);
          if (!emailSnap.empty) {
            const d = emailSnap.docs[0];
            matchedProfile = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) };
            targetDocId = d.id;
          } else {
            // Query by displayName (case-insensitive fallback)
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

    // 2. If user exists in Firestore
    if (matchedProfile) {
      if (matchedProfile.status === 'suspended') {
        throw new Error('Your account has been suspended by the administrator.');
      }

      // Check assigned password if set
      if (matchedProfile.password && matchedProfile.password.trim() !== '') {
        if (p !== matchedProfile.password.trim()) {
          throw new Error('Incorrect password. Please try again.');
        }
      } else if (p && !matchedProfile.password) {
        // If user had no password yet, assign this initial password
        matchedProfile.password = p;
        try {
          await updateDoc(doc(db, 'users', targetDocId), { password: p });
        } catch (e) {}
      }

      const activeProfile: UserProfile = {
        ...matchedProfile,
        lastLoginAt: new Date().toISOString(),
      };

      setProfile(activeProfile);
      setIsGuest(false);
      setShowLoginModal(false);

      try {
        localStorage.setItem('nrep_user', u);
        localStorage.setItem('nrep_user_profile', JSON.stringify(activeProfile));
        sessionStorage.setItem('nrep_user', u);
        sessionStorage.setItem('nrep_user_profile', JSON.stringify(activeProfile));
      } catch (e) {}

      if (typeof window !== 'undefined') {
        window.location.hash = '';
        try {
          history.replaceState(null, '', window.location.pathname);
        } catch (e) {}
      }

      try {
        await updateDoc(doc(db, 'users', targetDocId), { lastLoginAt: activeProfile.lastLoginAt });
      } catch (e) {}

      return true;
    }

    // 3. Fallback for built-in accounts (admin / viewer / bootstrap email)
    const isAdminUser = u === 'admin' || u === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();
    const isViewerUser = u === 'viewer';

    if (isAdminUser || isViewerUser) {
      const defaultRole: UserRole = isAdminUser ? 'admin' : 'viewer';
      const defaultEmail = isAdminUser ? ADMIN_BOOTSTRAP_EMAIL : `${u}@nrl.co.in`;
      const defaultName = isAdminUser ? 'admin' : 'viewer';
      const assignedPassword = p || (isAdminUser ? 'admin123' : 'viewer123');

      const newProf: UserProfile = {
        uid: u,
        email: defaultEmail,
        displayName: defaultName,
        role: defaultRole,
        status: 'approved',
        password: assignedPassword,
        assignedUnits: 'All',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };

      setProfile(newProf);
      setIsGuest(false);
      setShowLoginModal(false);

      try {
        localStorage.setItem('nrep_user', u);
        localStorage.setItem('nrep_user_profile', JSON.stringify(newProf));
        sessionStorage.setItem('nrep_user', u);
        sessionStorage.setItem('nrep_user_profile', JSON.stringify(newProf));
      } catch (e) {}

      if (typeof window !== 'undefined') {
        window.location.hash = '';
        try {
          history.replaceState(null, '', window.location.pathname);
        } catch (e) {}
      }

      // Persist to Firestore so it appears in Admin Panel and syncs across devices
      try {
        await setDoc(doc(db, 'users', u), newProf, { merge: true });
        if (isAdminUser) {
          await setDoc(doc(db, 'admins', u), {
            uid: u,
            email: defaultEmail,
            assignedAt: new Date().toISOString(),
          }, { merge: true });
        }
      } catch (e) {}

      return true;
    }

    // 4. If neither registered in Firestore nor default account
    throw new Error(`User "${rawInput}" is not found in registry. Please ask an Admin to grant you access.`);
  };

  const signOut = async () => {
    try {
      await fbSignOut(auth);
    } catch (error) {}
    try {
      sessionStorage.clear();
      localStorage.removeItem('nrep_user_profile');
      localStorage.removeItem('nrep_user');
    } catch (e) {}
    setUser(null);
    setProfile(null);
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

  const isAdmin =
    profile?.role === 'admin' ||
    user?.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase() ||
    profile?.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();

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

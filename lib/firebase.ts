import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, setLogLevel, terminate } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Suppress internal SDK retry/backoff console.error spam when free tier quota is reached
try {
  setLogLevel('silent');
} catch {}

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// CRITICAL: Must use firestoreDatabaseId from firebaseConfig
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const QUOTA_EXCEEDED_SESSION_KEY = 'nrep_firestore_write_quota_exceeded';

export function isWriteQuotaExceeded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(QUOTA_EXCEEDED_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markWriteQuotaExceeded(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(QUOTA_EXCEEDED_SESSION_KEY, 'true');
  } catch {}
}

export function isQuotaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || '');
  const code = (error as any)?.code || '';
  return (
    code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('Quota exceeded')
  );
}

/**
 * Executes a Firestore write operation with a fast timeout and quota guard.
 * If the free daily write quota is exhausted, resolves `false` cleanly so
 * local state / localStorage persistence continues working without interruption.
 */
export async function safeFirestoreWrite(
  writeFn: () => Promise<unknown>,
  timeoutMs = 2500
): Promise<boolean> {
  if (isWriteQuotaExceeded()) {
    return false;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      writeFn().then(() => 'ok' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);

    if (result === 'timeout') {
      // Write stream is likely backing off due to quota exhaustion
      markWriteQuotaExceeded();
      return false;
    }
    return true;
  } catch (error) {
    if (isQuotaError(error)) {
      markWriteQuotaExceeded();
      return false;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Operation error tracking compliant with Firebase guidelines
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  if (isQuotaError(error)) {
    markWriteQuotaExceeded();
    console.warn(`Firestore daily write quota reached on ${operationType} (${path}). Using local persistence.`);
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection check on boot
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (isQuotaError(error)) {
      markWriteQuotaExceeded();
      return false;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore is offline or unreachable.');
    }
    return false;
  }
}

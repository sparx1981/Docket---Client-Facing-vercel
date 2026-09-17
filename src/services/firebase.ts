import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  Firestore,
} from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AppSettings,
  HistoricalBetRecord,
  SyncLogRecord,
} from '../types';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let firestoreInstance: Firestore;
try {
  if (firebaseConfig.firestoreDatabaseId) {
    firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  } else {
    firestoreInstance = getFirestore(app);
  }
} catch {
  firestoreInstance = getFirestore(app);
}

export const db = firestoreInstance;
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export interface UserCloudData {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  settings?: AppSettings;
  historicalBets?: HistoricalBetRecord[];
  syncLogs?: SyncLogRecord[];
  lastScanTimestamp?: string | null;
  updatedAt?: string;
}

/**
 * Sign in using Google OAuth Popup.
 */
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Sign out of current Firebase session.
 */
export async function logOut(): Promise<void> {
  await signOut(auth);
}

/**
 * Subscribe to auth state changes.
 */
export function subscribeToAuthChanges(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/**
 * Fetch the user's persisted data partition from Firestore.
 */
export async function fetchUserCloudData(userId: string): Promise<UserCloudData | null> {
  try {
    const userDocRef = doc(db, 'users', userId);
    const snap = await getDoc(userDocRef);
    if (!snap.exists()) {
      return null;
    }
    return snap.data() as UserCloudData;
  } catch (err) {
    console.error('Failed to fetch user data from Firestore:', err);
    return null;
  }
}

/**
 * Persist user's full Engine Configuration (API keys, thresholds, schedule) to Firestore.
 */
export async function persistUserSettingsToCloud(
  userId: string,
  settings: AppSettings,
  userProfile?: { email?: string | null; displayName?: string | null; photoURL?: string | null }
): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', userId);
    await setDoc(
      userDocRef,
      {
        uid: userId,
        email: userProfile?.email ?? null,
        displayName: userProfile?.displayName ?? null,
        photoURL: userProfile?.photoURL ?? null,
        settings,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Failed to persist user settings to Firestore:', err);
    throw err;
  }
}

/**
 * Persist the user's historical settled/pending bets archive to Firestore.
 */
export async function persistUserHistoricalBetsToCloud(
  userId: string,
  historicalBets: HistoricalBetRecord[]
): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', userId);
    await setDoc(
      userDocRef,
      {
        historicalBets,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Failed to persist historical bets to Firestore:', err);
  }
}

/**
 * Persist user's sync logs and last scan timestamp to Firestore.
 */
export async function persistUserSyncDataToCloud(
  userId: string,
  syncLogs: SyncLogRecord[],
  lastScanTimestamp: string | null
): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', userId);
    await setDoc(
      userDocRef,
      {
        syncLogs,
        lastScanTimestamp,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Failed to persist sync data to Firestore:', err);
  }
}

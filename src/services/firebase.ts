import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Firestore,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  connectAuthEmulator,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AppSettings,
  CandidateFixture,
  HistoricalBetRecord,
  SyncLogRecord,
  BacktestRunRecord,
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

// Only set by the e2e Playwright config's dev-server env, never in a
// production build — real Google Sign-In can't be automated headlessly, so
// e2e tests run the app against the Firebase Auth/Firestore Emulator Suite
// instead of the real backend.
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
}

export interface UserCloudData {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  settings?: AppSettings;
  historicalBets?: HistoricalBetRecord[];
  syncLogs?: SyncLogRecord[];
  lastScanTimestamp?: string | null;
  backtestRuns?: BacktestRunRecord[];
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
 * Anonymous sign-in used only by e2e tests running against the Firebase
 * Auth Emulator (see the emulator guard above) — real Google OAuth can't be
 * automated headlessly. LoginScreen only renders the button that calls this
 * when the same emulator flag is set, so it's unreachable in production.
 */
export async function signInForTests(): Promise<User> {
  const result = await signInAnonymously(auth);
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
 * Persist the user's saved backtest runs to Firestore.
 */
export async function persistUserBacktestRunsToCloud(
  userId: string,
  backtestRuns: BacktestRunRecord[]
): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', userId);
    await setDoc(
      userDocRef,
      {
        backtestRuns,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error('Failed to persist backtest runs to Firestore:', err);
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

/**
 * The classified fixtures written by the server-side daily scan cron
 * (users/{uid}/scanCache/latest), or null when no cron scan has run.
 */
export async function fetchLatestScanCache(
  userId: string
): Promise<{ scannedAt: string; fixtures: CandidateFixture[] } | null> {
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'scanCache', 'latest'));
    if (!snap.exists()) return null;
    const data = snap.data() as { scannedAt?: string; fixturesJson?: string };
    if (!data.scannedAt || !data.fixturesJson) return null;
    const fixtures = JSON.parse(data.fixturesJson);
    return Array.isArray(fixtures) ? { scannedAt: data.scannedAt, fixtures } : null;
  } catch (err) {
    console.error('Failed to fetch cached scan results from Firestore:', err);
    return null;
  }
}

/**
 * A server scan marked "running" for less than this long is treated as still
 * going (server/cron/schedule.ts treats one older than RUN_STALE_MINUTES = 12
 * as dead). Wiping the user's data underneath a live scan would let the scan
 * write its results straight back.
 */
const SERVER_SCAN_RUNNING_WINDOW_MS = 12 * 60_000;

/**
 * Wipes the signed-in user's synced data in Firestore, for "Reset data":
 * the Archive, sync history, saved backtest runs, and the server's saved
 * scan results (users/{uid}/scanCache/latest). Engine Configuration
 * (settings) and lastScanTimestamp are left alone.
 *
 * The server decides whether a daily scan is owed from the newest successful
 * sync log plus users/{uid}/scanState/current.lastSuccessAt. Wiping the logs
 * would erase that evidence and make the 30-minute backup check run a scan
 * straight away, so the newest successful time is first copied into
 * scanState.lastSuccessAt (never moved backwards) and only then are the logs
 * wiped. Throws, having changed nothing, if a server scan is running now.
 */
export async function resetUserCloudData(userId: string): Promise<void> {
  const userRef = doc(db, 'users', userId);
  const stateRef = doc(db, 'users', userId, 'scanState', 'current');
  const [userSnap, stateSnap] = await Promise.all([getDoc(userRef), getDoc(stateRef)]);
  const state = (stateSnap.exists() ? stateSnap.data() : {}) as {
    status?: string;
    startedAt?: string;
    lastSuccessAt?: string;
  };

  if (
    state.status === 'running' &&
    state.startedAt &&
    Date.now() - new Date(state.startedAt).getTime() < SERVER_SCAN_RUNNING_WINDOW_MS
  ) {
    throw new Error(
      'A scheduled scan is running on the server right now. Wait a few minutes for it to finish, then try again.'
    );
  }

  const logs: SyncLogRecord[] = Array.isArray(userSnap.data()?.syncLogs) ? userSnap.data()!.syncLogs : [];
  const newestGoodLog = logs.find((l) => l?.status && l.status !== 'FAILED' && l.timestamp)?.timestamp;
  const markerMs = [newestGoodLog, state.lastSuccessAt]
    .filter((t): t is string => !!t)
    .map((t) => new Date(t).getTime())
    .filter((n) => Number.isFinite(n));
  if (markerMs.length > 0) {
    const marker = new Date(Math.max(...markerMs)).toISOString();
    if (marker !== state.lastSuccessAt) await setDoc(stateRef, { lastSuccessAt: marker }, { merge: true });
  }

  await setDoc(
    userRef,
    { historicalBets: [], syncLogs: [], backtestRuns: [], updatedAt: new Date().toISOString() },
    { merge: true }
  );
  await deleteDoc(doc(db, 'users', userId, 'scanCache', 'latest'));
}

/** The signed-in user's Firebase ID token, for authenticating calls to our own backend. Null when signed out. */
export async function getCurrentIdToken(): Promise<string | null> {
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

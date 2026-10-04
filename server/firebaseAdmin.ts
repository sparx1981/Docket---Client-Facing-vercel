import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp, applicationDefault, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

/**
 * Shared firebase-admin setup for server code that must act outside a
 * user's own session (the daily-scan cron) or verify who is calling (the
 * notification test endpoint). Needs FIREBASE_SERVICE_ACCOUNT_JSON — a
 * Firebase service-account key's JSON — in the environment.
 */

function loadFirebaseConfig(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];
  const config = loadFirebaseConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || config.projectId;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not configured — add a Firebase service-account key to the Vercel project environment variables so the server can read users' settings and verify sign-ins."
    );
  }
  return initializeApp({
    projectId,
    credential: json ? cert(JSON.parse(json)) : applicationDefault(),
  });
}

export function getDb(): Firestore {
  const app = getAdminApp();
  const databaseId = process.env.FIREBASE_DATABASE_ID || loadFirebaseConfig().firestoreDatabaseId;
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

/** Verifies a Firebase ID token sent by the signed-in web app; rejects when invalid or expired. */
export async function verifyIdToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const decoded = await getAuth(getAdminApp()).verifyIdToken(idToken);
  return { uid: decoded.uid, email: decoded.email };
}

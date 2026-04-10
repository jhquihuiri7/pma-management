import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

let _db: Firestore | undefined;

function db(): Firestore {
  if (!_db) _db = getFirestore(getAdminApp());
  return _db;
}

export const adminDb = new Proxy({} as Firestore, {
  get(_target, prop, receiver) {
    return Reflect.get(db(), prop, receiver);
  },
});

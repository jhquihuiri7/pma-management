import admin from "firebase-admin";

let app: admin.app.App | null = null;

export function getFirebaseApp(): admin.app.App {
  if (app) return app;
  if (admin.apps.length > 0) {
    app = admin.apps[0]!;
    return app;
  }
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    app = admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } else {
    throw new Error(
      "Firebase Admin credentials missing. Set FIREBASE_ADMIN_* env vars or GOOGLE_APPLICATION_CREDENTIALS."
    );
  }
  return app;
}

export const fsdb = () => getFirebaseApp().firestore();

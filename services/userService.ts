import { adminDb } from "@/lib/firebase-admin";
import { User } from "@/types";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  sendEmailFromAdmin as sendPmaEmailFromAdmin,
  buildInvitationEmail as buildPmaInvitationEmail,
  buildPasswordRecoveryEmail as buildPmaRecoveryEmail,
} from "@/lib/gmail";
import {
  sendEmailFromAdmin as sendRgdpEmailFromAdmin,
  buildInvitationEmail as buildRgdpInvitationEmail,
  buildPasswordRecoveryEmail as buildRgdpRecoveryEmail,
} from "@/lib/gmail-rgdp";

const BCRYPT_ROUNDS = 10;

export type ManagedApp = "pma" | "rgdp";

const APP_CONFIG: Record<ManagedApp, {
  assignmentCollection: string;
  sendEmailFromAdmin: (adminId: string, to: string, subject: string, html: string) => Promise<void>;
  buildInvitationEmail: (userName: string, setPasswordLink: string) => string;
  buildPasswordRecoveryEmail: (userName: string, resetLink: string) => string;
}> = {
  pma: {
    assignmentCollection: "pma_assignments",
    sendEmailFromAdmin: sendPmaEmailFromAdmin,
    buildInvitationEmail: buildPmaInvitationEmail,
    buildPasswordRecoveryEmail: buildPmaRecoveryEmail,
  },
  rgdp: {
    assignmentCollection: "rgdp_project_assignments",
    sendEmailFromAdmin: sendRgdpEmailFromAdmin,
    buildInvitationEmail: buildRgdpInvitationEmail,
    buildPasswordRecoveryEmail: buildRgdpRecoveryEmail,
  },
};

function uniqueApps(apps: string[]): ManagedApp[] {
  return Array.from(
    new Set(apps.filter((app): app is ManagedApp => app === "pma" || app === "rgdp"))
  );
}

function sanitizeUser(user: User): User {
  return {
    ...user,
    apps: uniqueApps(user.apps ?? []),
    password: undefined,
    passwordSetToken: undefined,
  };
}

function subjectForInvitation(app: ManagedApp): string {
  return app === "pma"
    ? "Establece tu contrasena - Plan de Manejo Ambiental"
    : "Establece tu contrasena - Gestion de Riesgos";
}

function subjectForRecovery(app: ManagedApp): string {
  return app === "pma"
    ? "Restablece tu contrasena - Plan de Manejo Ambiental"
    : "Restablece tu contrasena - Gestion de Riesgos";
}

async function sendInvitationEmail(
  app: ManagedApp,
  adminId: string,
  email: string,
  name: string,
  token: string
): Promise<void> {
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const setPasswordLink = `${appUrl}/set-password?token=${token}`;
  const html = APP_CONFIG[app].buildInvitationEmail(name, setPasswordLink);

  await APP_CONFIG[app].sendEmailFromAdmin(
    adminId,
    email,
    subjectForInvitation(app),
    html
  );
}

export async function createReporter(
  adminId: string,
  name: string,
  email: string,
  unit?: string,
  position?: string,
  app: ManagedApp = "pma"
): Promise<User> {
  return createManagedUser(adminId, name, email, "REPORTER", unit, position, app);
}

export async function createViewer(
  adminId: string,
  name: string,
  email: string,
  unit?: string,
  position?: string,
  app: ManagedApp = "pma"
): Promise<User> {
  return createManagedUser(adminId, name, email, "VIEWER", unit, position, app);
}

async function createManagedUser(
  adminId: string,
  name: string,
  email: string,
  role: "REPORTER" | "VIEWER",
  unit: string | undefined,
  position: string | undefined,
  app: ManagedApp
): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();

  const existingSnapshot = await adminDb
    .collection("users")
    .where("email", "==", normalizedEmail)
    .limit(1)
    .get();

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  if (!existingSnapshot.empty) {
    const existingDoc = existingSnapshot.docs[0];
    const existingUser = existingDoc.data() as User;

    if (existingUser.adminId !== adminId) {
      throw new Error("Ya existe un usuario con ese correo");
    }

    if (existingUser.role !== "REPORTER" && existingUser.role !== "VIEWER") {
      throw new Error("No puedes gestionar este usuario");
    }

    if (existingUser.role !== role) {
      throw new Error("Ya existe un usuario con ese correo y un rol diferente");
    }

    const apps = uniqueApps(existingUser.apps ?? []);
    if (apps.includes(app)) {
      throw new Error("Ya existe un usuario con ese correo");
    }

    const nextApps = uniqueApps([...apps, app]);

    await existingDoc.ref.update({
      name,
      unit,
      position,
      apps: nextApps,
    });

    if (existingUser.passwordSet === false) {
      await existingDoc.ref.update({
        passwordSetToken: token,
        passwordSetTokenExpiry: tokenExpiry,
        emailSent: true,
      });

      try {
        await sendInvitationEmail(app, adminId, normalizedEmail, name, token);
      } catch (emailError) {
        console.error("[createManagedUser] Failed to send invitation email:", emailError);
        await existingDoc.ref.update({ emailSent: false });
        return {
          ...sanitizeUser(existingUser),
          name,
          unit,
          position,
          apps: nextApps,
          emailSent: false,
        } as User;
      }
    }

    return {
      ...sanitizeUser(existingUser),
      name,
      email: normalizedEmail,
      unit,
      position,
      apps: nextApps,
    };
  }

  const userRef = adminDb.collection("users").doc();
  const user: User = {
    id: userRef.id,
    name,
    email: normalizedEmail,
    passwordSet: false,
    passwordSetToken: token,
    passwordSetTokenExpiry: tokenExpiry,
    role,
    adminId,
    apps: [app],
    unit,
    position,
    createdAt: new Date().toISOString(),
  };

  await userRef.set(user);

  try {
    await sendInvitationEmail(app, adminId, normalizedEmail, name, token);
  } catch (emailError) {
    console.error("[createManagedUser] Failed to send invitation email:", emailError);
    await userRef.update({ emailSent: false });
    return { ...sanitizeUser(user), emailSent: false } as User;
  }

  return sanitizeUser(user);
}

export async function resendInvitation(
  userId: string,
  adminId: string,
  app: ManagedApp = "pma"
): Promise<void> {
  const doc = await adminDb.collection("users").doc(userId).get();
  if (!doc.exists) throw new Error("Usuario no encontrado");

  const user = doc.data() as User;
  if (user.adminId !== adminId) throw new Error("No autorizado");
  if (user.passwordSet !== false) throw new Error("Este usuario ya establecio su contrasena");

  const apps = uniqueApps(user.apps ?? []);
  if (!apps.includes(app)) throw new Error("El usuario no tiene acceso a esta aplicacion");

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await adminDb.collection("users").doc(userId).update({
    passwordSetToken: token,
    passwordSetTokenExpiry: tokenExpiry,
    emailSent: true,
  });

  await sendInvitationEmail(app, adminId, user.email, user.name, token);
}

export async function verifySetPasswordToken(
  token: string
): Promise<{ userId: string; name: string; email: string } | null> {
  const snapshot = await adminDb
    .collection("users")
    .where("passwordSetToken", "==", token)
    .where("passwordSet", "==", false)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const user = doc.data() as User;

  if (!user.passwordSetTokenExpiry || new Date(user.passwordSetTokenExpiry) < new Date()) {
    return null;
  }

  return { userId: doc.id, name: user.name, email: user.email };
}

export async function setUserPassword(
  token: string,
  password: string
): Promise<void> {
  const info = await verifySetPasswordToken(token);
  if (!info) throw new Error("El enlace es invalido o ha expirado");

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await adminDb.collection("users").doc(info.userId).update({
    password: hashedPassword,
    passwordSet: true,
    passwordSetToken: null,
    passwordSetTokenExpiry: null,
  });
}

export async function generatePasswordRecoveryToken(email: string): Promise<void> {
  const snapshot = await adminDb
    .collection("users")
    .where("email", "==", email.trim().toLowerCase())
    .limit(1)
    .get();

  if (snapshot.empty) return;

  const doc = snapshot.docs[0];
  const user = doc.data() as User;

  if (user.role !== "REPORTER" && user.role !== "VIEWER") return;
  if (user.passwordSet === false) return;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await doc.ref.update({
    passwordSetToken: token,
    passwordSetTokenExpiry: tokenExpiry,
  });

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const resetLink = `${appUrl}/reset-password?token=${token}`;

  const userApps = uniqueApps(user.apps ?? []);
  const app: ManagedApp = userApps.includes("pma") ? "pma" : "rgdp";

  const html = APP_CONFIG[app].buildPasswordRecoveryEmail(user.name, resetLink);

  try {
    await APP_CONFIG[app].sendEmailFromAdmin(
      user.adminId,
      user.email,
      subjectForRecovery(app),
      html
    );
  } catch {
    // Silently fail - token is still stored
  }
}

export async function verifyPasswordRecoveryToken(
  token: string
): Promise<{ userId: string; name: string; email: string } | null> {
  const snapshot = await adminDb
    .collection("users")
    .where("passwordSetToken", "==", token)
    .where("passwordSet", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const user = doc.data() as User;

  if (!user.passwordSetTokenExpiry || new Date(user.passwordSetTokenExpiry) < new Date()) {
    return null;
  }

  return { userId: doc.id, name: user.name, email: user.email };
}

export async function resetUserPassword(token: string, password: string): Promise<void> {
  const info = await verifyPasswordRecoveryToken(token);
  if (!info) throw new Error("El enlace es invalido o ha expirado");

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await adminDb.collection("users").doc(info.userId).update({
    password: hashedPassword,
    passwordSetToken: null,
    passwordSetTokenExpiry: null,
  });
}

export async function getUserById(userId: string): Promise<User | null> {
  const doc = await adminDb.collection("users").doc(userId).get();
  if (!doc.exists) return null;
  const data = doc.data() as User;
  return sanitizeUser(data);
}

export async function getReportersByAdmin(adminId: string): Promise<User[]> {
  const snapshot = await adminDb
    .collection("users")
    .where("adminId", "==", adminId)
    .where("role", "==", "REPORTER")
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => sanitizeUser(doc.data() as User));
}

export async function getManagedUsersByAdmin(
  adminId: string,
  app?: ManagedApp
): Promise<User[]> {
  const [reportersSnap, viewersSnap] = await Promise.all([
    adminDb
      .collection("users")
      .where("adminId", "==", adminId)
      .where("role", "==", "REPORTER")
      .orderBy("createdAt", "desc")
      .get(),
    adminDb
      .collection("users")
      .where("adminId", "==", adminId)
      .where("role", "==", "VIEWER")
      .orderBy("createdAt", "desc")
      .get(),
  ]);

  const all = [...reportersSnap.docs, ...viewersSnap.docs].map((doc) => sanitizeUser(doc.data() as User));

  const filtered = app
    ? all.filter((user) => (user.apps ?? []).includes(app))
    : all;

  return filtered.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function deleteReporter(
  userId: string,
  adminId: string,
  app: ManagedApp = "pma"
): Promise<void> {
  const doc = await adminDb.collection("users").doc(userId).get();
  if (!doc.exists) throw new Error("User not found");

  const user = doc.data() as User;
  if (user.adminId !== adminId) throw new Error("Unauthorized");
  if (user.role !== "REPORTER" && user.role !== "VIEWER") {
    throw new Error("Cannot delete admin users");
  }

  const apps = uniqueApps(user.apps ?? []);
  if (!apps.includes(app)) {
    throw new Error("El usuario no tiene acceso a esta aplicacion");
  }

  const assignments = await adminDb
    .collection(APP_CONFIG[app].assignmentCollection)
    .where("userId", "==", userId)
    .get();

  const remainingApps = apps.filter((value) => value !== app);

  const batch = adminDb.batch();
  assignments.docs.forEach((assignmentDoc) => batch.delete(assignmentDoc.ref));

  if (remainingApps.length === 0) {
    batch.delete(adminDb.collection("users").doc(userId));
  } else {
    batch.update(adminDb.collection("users").doc(userId), { apps: remainingApps });
  }

  await batch.commit();
}


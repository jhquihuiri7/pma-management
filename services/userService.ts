import { adminDb } from "@/lib/firebase-admin";
import { User, UserRole } from "@/types";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendEmailFromAdmin, buildInvitationEmail, buildPasswordRecoveryEmail } from "@/lib/gmail";

const BCRYPT_ROUNDS = 10;

export async function createReporter(
  adminId: string,
  name: string,
  email: string,
  unit?: string,
  position?: string
): Promise<User> {
  return createManagedUser(adminId, name, email, "REPORTER", unit, position);
}

export async function createViewer(
  adminId: string,
  name: string,
  email: string,
  unit?: string,
  position?: string
): Promise<User> {
  return createManagedUser(adminId, name, email, "VIEWER", unit, position);
}

async function createManagedUser(
  adminId: string,
  name: string,
  email: string,
  role: "REPORTER" | "VIEWER",
  unit?: string,
  position?: string
): Promise<User> {
  // Check if email already exists
  const existing = await adminDb
    .collection("pma_users")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (!existing.empty) {
    throw new Error("Ya existe un usuario con ese correo");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const userRef = adminDb.collection("pma_users").doc();

  const user: User = {
    id: userRef.id,
    name,
    email,
    passwordSet: false,
    passwordSetToken: token,
    passwordSetTokenExpiry: tokenExpiry,
    role,
    adminId,
    unit,
    position,
    createdAt: new Date().toISOString(),
  };

  await userRef.set(user);

  // Send invitation email
  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const setPasswordLink = `${appUrl}/set-password?token=${token}`;
  const html = buildInvitationEmail(name, setPasswordLink);

  try {
    await sendEmailFromAdmin(
      adminId,
      email,
      "Establece tu contraseña – Plan de Manejo Ambiental",
      html
    );
  } catch (emailError) {
    console.error("[createManagedUser] Failed to send invitation email:", emailError);
    // Mark user with emailSent: false so admin knows to resend
    await userRef.update({ emailSent: false });
    return { ...user, password: undefined, passwordSetToken: undefined, emailSent: false } as any;
  }

  return { ...user, password: undefined, passwordSetToken: undefined };
}

export async function resendInvitation(
  userId: string,
  adminId: string
): Promise<void> {
  const doc = await adminDb.collection("pma_users").doc(userId).get();
  if (!doc.exists) throw new Error("Usuario no encontrado");

  const user = doc.data() as User;
  if (user.adminId !== adminId) throw new Error("No autorizado");
  if (user.passwordSet !== false) throw new Error("Este usuario ya estableció su contraseña");

  // Generate a fresh token
  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await adminDb.collection("pma_users").doc(userId).update({
    passwordSetToken: token,
    passwordSetTokenExpiry: tokenExpiry,
    emailSent: true,
  });

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const setPasswordLink = `${appUrl}/set-password?token=${token}`;
  const html = buildInvitationEmail(user.name, setPasswordLink);

  await sendEmailFromAdmin(
    adminId,
    user.email,
    "Establece tu contraseña – Plan de Manejo Ambiental",
    html
  );
}

export async function verifySetPasswordToken(
  token: string
): Promise<{ userId: string; name: string; email: string } | null> {
  const snapshot = await adminDb
    .collection("pma_users")
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
  if (!info) throw new Error("El enlace es inválido o ha expirado");

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await adminDb.collection("pma_users").doc(info.userId).update({
    password: hashedPassword,
    passwordSet: true,
    passwordSetToken: null,
    passwordSetTokenExpiry: null,
  });
}

export async function generatePasswordRecoveryToken(email: string): Promise<void> {
  const snapshot = await adminDb
    .collection("pma_users")
    .where("email", "==", email)
    .limit(1)
    .get();

  // Always resolve silently to avoid email enumeration
  if (snapshot.empty) return;

  const doc = snapshot.docs[0];
  const user = doc.data() as User;

  // Only reporters and viewers can recover via email
  if (user.role !== "REPORTER" && user.role !== "VIEWER") return;
  // Cannot recover if password was never set (still in invite flow)
  if (user.passwordSet === false) return;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await doc.ref.update({
    passwordSetToken: token,
    passwordSetTokenExpiry: tokenExpiry,
  });

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const resetLink = `${appUrl}/reset-password?token=${token}`;
  const html = buildPasswordRecoveryEmail(user.name, resetLink);

  try {
    await sendEmailFromAdmin(user.adminId, user.email, "Restablece tu contraseña – Plan de Manejo Ambiental", html);
  } catch {
    // Silently fail — token is still stored, admin can resend manually
  }
}

export async function verifyPasswordRecoveryToken(
  token: string
): Promise<{ userId: string; name: string; email: string } | null> {
  const snapshot = await adminDb
    .collection("pma_users")
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
  if (!info) throw new Error("El enlace es inválido o ha expirado");

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await adminDb.collection("pma_users").doc(info.userId).update({
    password: hashedPassword,
    passwordSetToken: null,
    passwordSetTokenExpiry: null,
  });
}

export async function getUserById(userId: string): Promise<User | null> {
  const doc = await adminDb.collection("pma_users").doc(userId).get();
  if (!doc.exists) return null;
  const data = doc.data() as User;
  return { ...data, password: undefined };
}

export async function getReportersByAdmin(adminId: string): Promise<User[]> {
  const snapshot = await adminDb
    .collection("pma_users")
    .where("adminId", "==", adminId)
    .where("role", "==", "REPORTER")
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as User;
    return { ...data, password: undefined };
  });
}

export async function getManagedUsersByAdmin(adminId: string): Promise<User[]> {
  const [reportersSnap, viewersSnap] = await Promise.all([
    adminDb
      .collection("pma_users")
      .where("adminId", "==", adminId)
      .where("role", "==", "REPORTER")
      .orderBy("createdAt", "desc")
      .get(),
    adminDb
      .collection("pma_users")
      .where("adminId", "==", adminId)
      .where("role", "==", "VIEWER")
      .orderBy("createdAt", "desc")
      .get(),
  ]);

  const reporters = reportersSnap.docs.map((doc) => {
    const data = doc.data() as User;
    return { ...data, password: undefined, passwordSetToken: undefined };
  });
  const viewers = viewersSnap.docs.map((doc) => {
    const data = doc.data() as User;
    return { ...data, password: undefined, passwordSetToken: undefined };
  });

  return [...reporters, ...viewers].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function deleteReporter(
  userId: string,
  adminId: string
): Promise<void> {
  const doc = await adminDb.collection("pma_users").doc(userId).get();
  if (!doc.exists) throw new Error("User not found");

  const user = doc.data() as User;
  if (user.adminId !== adminId) throw new Error("Unauthorized");
  if (user.role !== "REPORTER" && user.role !== "VIEWER") throw new Error("Cannot delete admin users");

  // Delete assignments for this user
  const assignments = await adminDb
    .collection("pma_assignments")
    .where("userId", "==", userId)
    .get();

  const batch = adminDb.batch();
  assignments.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(adminDb.collection("pma_users").doc(userId));
  await batch.commit();
}

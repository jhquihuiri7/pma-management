import { adminDb } from "@/lib/firebase-admin";
import { User } from "@/types";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

export async function createReporter(
  adminId: string,
  name: string,
  email: string,
  password: string,
  unit?: string,
  position?: string
): Promise<User> {
  // Check if email already exists
  const existing = await adminDb
    .collection("users")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (!existing.empty) {
    throw new Error("A user with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const userRef = adminDb.collection("users").doc();

  const user: User = {
    id: userRef.id,
    name,
    email,
    password: hashedPassword,
    role: "REPORTER",
    adminId,
    unit,
    position,
    createdAt: new Date().toISOString(),
  };

  await userRef.set(user);
  return { ...user, password: undefined };
}

export async function getUserById(userId: string): Promise<User | null> {
  const doc = await adminDb.collection("users").doc(userId).get();
  if (!doc.exists) return null;
  const data = doc.data() as User;
  return { ...data, password: undefined };
}

export async function getReportersByAdmin(adminId: string): Promise<User[]> {
  const snapshot = await adminDb
    .collection("users")
    .where("adminId", "==", adminId)
    .where("role", "==", "REPORTER")
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as User;
    return { ...data, password: undefined };
  });
}

export async function deleteReporter(
  userId: string,
  adminId: string
): Promise<void> {
  const doc = await adminDb.collection("users").doc(userId).get();
  if (!doc.exists) throw new Error("User not found");

  const user = doc.data() as User;
  if (user.adminId !== adminId) throw new Error("Unauthorized");
  if (user.role !== "REPORTER") throw new Error("Cannot delete admin users");

  // Delete assignments for this user
  const assignments = await adminDb
    .collection("assignments")
    .where("userId", "==", userId)
    .get();

  const batch = adminDb.batch();
  assignments.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(adminDb.collection("users").doc(userId));
  await batch.commit();
}

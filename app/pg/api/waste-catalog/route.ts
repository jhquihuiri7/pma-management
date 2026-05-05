import { NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/api-utils";
import { loadRgdtWasteCatalog } from "@/lib/rgdtWasteCatalog";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (!session.user.adminId) return forbiddenResponse();

  const entries = loadRgdtWasteCatalog();
  return NextResponse.json(entries);
}

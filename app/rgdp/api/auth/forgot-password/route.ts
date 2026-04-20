import { NextRequest, NextResponse } from "next/server";
import { generatePasswordRecoveryToken } from "@/services-rgdp/userService";

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Correo requerido" }, { status: 400 });
  }

  // Always return success to avoid email enumeration
  await generatePasswordRecoveryToken(email.trim().toLowerCase());

  return NextResponse.json({ success: true });
}

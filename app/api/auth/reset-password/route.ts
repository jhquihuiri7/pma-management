import { NextRequest, NextResponse } from "next/server";
import { verifyPasswordRecoveryToken, resetUserPassword } from "@/services/userService";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token requerido" }, { status: 400 });
  }

  const info = await verifyPasswordRecoveryToken(token);

  if (!info) {
    return NextResponse.json({ error: "El enlace es inválido o ha expirado" }, { status: 400 });
  }

  return NextResponse.json({ name: info.name, email: info.email });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, password } = body;

  if (!token || !password) {
    return NextResponse.json({ error: "Token y contraseña son requeridos" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 6 caracteres" },
      { status: 400 }
    );
  }

  try {
    await resetUserPassword(token, password);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

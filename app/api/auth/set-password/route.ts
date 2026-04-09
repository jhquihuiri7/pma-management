import { NextRequest, NextResponse } from "next/server";
import { verifySetPasswordToken, setUserPassword } from "@/services/userService";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token requerido" }, { status: 400 });
  }

  const info = await verifySetPasswordToken(token);

  if (!info) {
    return NextResponse.json(
      { error: "El enlace es inválido o ha expirado" },
      { status: 400 }
    );
  }

  return NextResponse.json({ name: info.name, email: info.email });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, password } = body;

  if (!token || !password) {
    return NextResponse.json(
      { error: "Token y contraseña son requeridos" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 6 caracteres" },
      { status: 400 }
    );
  }

  try {
    await setUserPassword(token, password);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

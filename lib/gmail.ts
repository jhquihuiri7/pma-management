import { google } from "googleapis";
import { adminDb } from "./firebase-admin";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

interface AdminTokenData {
  googleAccessToken: string;
  googleRefreshToken: string;
  tokenExpiresAt: number;
  email: string;
  name: string;
}

function buildRawEmail(
  to: string,
  from: string,
  subject: string,
  html: string
): string {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

export async function sendEmailFromAdmin(
  adminId: string,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const adminDoc = await adminDb.collection("admins").doc(adminId).get();
  if (!adminDoc.exists) throw new Error("Admin no encontrado");

  const data = adminDoc.data() as AdminTokenData;

  oauth2Client.setCredentials({
    access_token: data.googleAccessToken,
    refresh_token: data.googleRefreshToken,
  });

  if (data.tokenExpiresAt < Date.now()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await adminDb.collection("admins").doc(adminId).update({
      googleAccessToken: credentials.access_token,
      tokenExpiresAt: credentials.expiry_date ?? Date.now() + 3600 * 1000,
    });
    oauth2Client.setCredentials(credentials);
  }

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const raw = buildRawEmail(
    to,
    `${data.name} <${data.email}>`,
    subject,
    html
  );

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

export function buildPasswordRecoveryEmail(
  userName: string,
  resetLink: string
): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:#0f172a;padding:32px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Plan de Manejo Ambiental</h1>
              <p style="margin:4px 0 0;color:#94a3b8;font-size:14px;">Plataforma de Gestión Ambiental</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#0f172a;font-size:18px;">Hola, ${userName}</h2>
              <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el siguiente botón para crear una nueva contraseña:
              </p>
              <div style="text-align:center;margin:32px 0;">
                <a href="${resetLink}"
                   style="display:inline-block;background:#0f172a;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:600;">
                  Restablecer contraseña
                </a>
              </div>
              <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">
                Este enlace expira en <strong>1 hora</strong>.
              </p>
              <p style="margin:0;color:#94a3b8;font-size:13px;">
                Si no solicitaste restablecer tu contraseña, puedes ignorar este correo.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f1f5f9;padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Plan de Manejo Ambiental &mdash; Plataforma de Gestión
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function buildInvitationEmail(
  userName: string,
  setPasswordLink: string
): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:#0f172a;padding:32px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Plan de Manejo Ambiental</h1>
              <p style="margin:4px 0 0;color:#94a3b8;font-size:14px;">Plataforma de Gestión Ambiental</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#0f172a;font-size:18px;">Bienvenido, ${userName}</h2>
              <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
                Has sido registrado en la plataforma. Para activar tu cuenta y establecer tu contraseña, haz clic en el siguiente botón:
              </p>
              <div style="text-align:center;margin:32px 0;">
                <a href="${setPasswordLink}"
                   style="display:inline-block;background:#0f172a;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:600;">
                  Establecer contraseña
                </a>
              </div>
              <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">
                Este enlace expira en <strong>24 horas</strong>.
              </p>
              <p style="margin:0;color:#94a3b8;font-size:13px;">
                Si no esperabas este correo, puedes ignorarlo.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f1f5f9;padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Plan de Manejo Ambiental &mdash; Plataforma de Gestión
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

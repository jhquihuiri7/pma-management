type AccountEmailArgs = {
  name: string;
  link: string;
};

type EmailContent = {
  subject: string;
  html: string;
  text: string;
};

const PRODUCT_NAME = "Plataforma de Gestión Ambiental";
const EXPIRY_LABEL = "24 horas";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function baseTemplate(args: {
  preview: string;
  eyebrow: string;
  title: string;
  intro: string;
  detail: string;
  ctaLabel: string;
  link: string;
}) {
  const safeLink = escapeHtml(args.link);
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(args.title)}</title>
  </head>
  <body style="margin:0;background:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#10201a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(args.preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dbe7df;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#11392d;padding:28px 32px;color:#ffffff;">
                <div style="display:inline-block;width:44px;height:44px;border-radius:14px;background:#d6f5df;color:#11392d;text-align:center;line-height:44px;font-weight:800;font-size:18px;">GA</div>
                <p style="margin:18px 0 6px 0;color:#a7d8b8;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(args.eyebrow)}</p>
                <h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:800;">${escapeHtml(args.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 8px 32px;">
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#243d34;">${escapeHtml(args.intro)}</p>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#51665d;">${escapeHtml(args.detail)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 32px 10px 32px;">
                <a href="${safeLink}" style="display:inline-block;background:#16834a;color:#ffffff;text-decoration:none;border-radius:10px;padding:14px 20px;font-weight:700;font-size:15px;">${escapeHtml(args.ctaLabel)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 28px 32px;">
                <p style="margin:0 0 10px 0;font-size:13px;line-height:1.6;color:#6b7d75;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
                <p style="margin:0;word-break:break-all;font-size:13px;line-height:1.5;color:#16834a;">${safeLink}</p>
              </td>
            </tr>
            <tr>
              <td style="background:#f7faf8;padding:18px 32px;border-top:1px solid #e5eee8;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7d75;">Este enlace expira en ${EXPIRY_LABEL}. Si no solicitaste esta acción, puedes ignorar este mensaje.</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0 0;font-size:12px;color:#7b8d85;">${PRODUCT_NAME}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function invitationEmail({ name, link }: AccountEmailArgs): EmailContent {
  const safeName = name.trim() || "usuario";
  return {
    subject: "Tu acceso a la Plataforma de Gestión Ambiental",
    html: baseTemplate({
      preview: "Te damos la bienvenida. Establece tu contraseña para ingresar.",
      eyebrow: "Bienvenido",
      title: "Tu cuenta está lista",
      intro: `Hola ${safeName}, te han invitado a la Plataforma de Gestión Ambiental.`,
      detail: "Para proteger tu acceso, primero debes establecer una contraseña personal. El enlace estará disponible durante 24 horas.",
      ctaLabel: "Establecer contraseña",
      link,
    }),
    text: `Hola ${safeName},\n\nTe han invitado a la ${PRODUCT_NAME}. Establece tu contraseña aquí:\n${link}\n\nEl enlace expira en ${EXPIRY_LABEL}.`,
  };
}

export function passwordResetEmail({ name, link }: AccountEmailArgs): EmailContent {
  const safeName = name.trim() || "usuario";
  return {
    subject: "Restablece tu contraseña",
    html: baseTemplate({
      preview: "Usa este enlace para restablecer tu contraseña.",
      eyebrow: "Recuperación de acceso",
      title: "Restablece tu contraseña",
      intro: `Hola ${safeName}, recibimos una solicitud para restablecer tu contraseña.`,
      detail: "Puedes crear una nueva contraseña desde el botón de abajo. Por seguridad, el enlace expira en 24 horas.",
      ctaLabel: "Restablecer contraseña",
      link,
    }),
    text: `Hola ${safeName},\n\nRecibimos una solicitud para restablecer tu contraseña. Usa este enlace:\n${link}\n\nEl enlace expira en ${EXPIRY_LABEL}. Si no solicitaste este cambio, ignora este mensaje.`,
  };
}

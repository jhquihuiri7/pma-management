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

type PendingActivityRow = {
  itemCode: string;
  medida: string;
  direccion: string;
  periodicidad: string;
  limitMonth: string;
  status: string;
};

type PendingActivitiesArgs = {
  name: string;
  planTitle: string;
  periodKey: string;
  /** Free text written by the sender. Never generated, never rewritten. */
  message: string;
  activities: PendingActivityRow[];
  link: string;
};

/**
 * Green when the evidence is already approved and only the grade is missing,
 * red for a rejected delivery, amber for one still under review, grey when
 * nothing was uploaded.
 */
function statusChip(status: string): string {
  if (status === "Entregado, sin calificar") return "color:#166534;background:#dcfce7;";
  if (status === "Rechazado") return "color:#9f1239;background:#ffe4e6;";
  if (status === "Pendiente de revisión") return "color:#92400e;background:#fef3c7;";
  return "color:#475569;background:#e2e8f0;";
}

function pendingRows(activities: PendingActivityRow[]): string {
  return activities
    .map((activity, index) => {
      const zebra = index % 2 === 1 ? "background:#fbfdfb;" : "";
      const cell = `padding:10px 12px;border-bottom:1px solid #e5eee8;font-size:13px;line-height:1.5;color:#243d34;vertical-align:top;`;
      return `<tr style="${zebra}">
        <td style="${cell}white-space:nowrap;font-weight:700;color:#11392d;">${escapeHtml(activity.itemCode)}</td>
        <td style="${cell}">${escapeHtml(activity.medida)}</td>
        <td style="${cell}white-space:nowrap;">${escapeHtml(activity.direccion)}</td>
        <td style="${cell}white-space:nowrap;">${escapeHtml(activity.periodicidad)}</td>
        <td style="${cell}white-space:nowrap;">${escapeHtml(activity.limitMonth)}</td>
        <td style="${cell}white-space:nowrap;"><span style="display:inline-block;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700;${statusChip(activity.status)}">${escapeHtml(activity.status)}</span></td>
      </tr>`;
    })
    .join("");
}

/**
 * One reporter's pending activities for one reporting period. The sender's
 * message is reproduced verbatim (escaped, newlines preserved) — the template
 * only adds the table and the link the dialog promises to attach.
 */
export function pendingActivitiesEmail(args: PendingActivitiesArgs): EmailContent {
  const safeName = args.name.trim() || "reportero";
  const safeLink = escapeHtml(args.link);
  const subject = `Actividades pendientes ${args.planTitle} — ${args.periodKey}`;
  const head = `padding:10px 12px;border-bottom:2px solid #dbe7df;text-align:left;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#51665d;white-space:nowrap;`;
  // The message carries its own greeting ("Estimado/a ..."), so the template
  // only supplies one when the sender cleared the body — otherwise the reader
  // would get two salutations stacked on top of each other.
  const messageBlock = args.message.trim()
    ? `<p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#243d34;white-space:pre-wrap;">${escapeHtml(args.message)}</p>`
    : `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#243d34;">Hola ${escapeHtml(safeName)},</p>`;

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#10201a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(`${args.activities.length} actividad(es) pendiente(s) del periodo ${args.periodKey}`)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:860px;background:#ffffff;border:1px solid #dbe7df;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#11392d;padding:28px 32px;color:#ffffff;">
                <div style="display:inline-block;width:44px;height:44px;border-radius:14px;background:#d6f5df;color:#11392d;text-align:center;line-height:44px;font-weight:800;font-size:18px;">GA</div>
                <p style="margin:18px 0 6px 0;color:#a7d8b8;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Actividades pendientes</p>
                <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:800;">${escapeHtml(args.planTitle)}</h1>
                <p style="margin:10px 0 0 0;font-size:14px;color:#c8e6d3;">Periodo de reporte ${escapeHtml(args.periodKey)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 0 32px;">
                ${messageBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <p style="margin:0 0 10px 0;font-size:13px;font-weight:700;color:#51665d;">${escapeHtml(`${args.activities.length} actividad(es) sin calificar a tu cargo`)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5eee8;border-radius:12px;">
                  <tr>
                    <th style="${head}">Ítem</th>
                    <th style="${head}">Medida propuesta</th>
                    <th style="${head}">Dirección</th>
                    <th style="${head}">Periodicidad</th>
                    <th style="${head}">Mes límite</th>
                    <th style="${head}">Estado</th>
                  </tr>
                  ${pendingRows(args.activities)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 32px 10px 32px;">
                <a href="${safeLink}" style="display:inline-block;background:#16834a;color:#ffffff;text-decoration:none;border-radius:10px;padding:14px 20px;font-weight:700;font-size:15px;">Ver el plan y cargar evidencias</a>
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
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7d75;">Estas actividades aún no tienen calificación de cumplimiento registrada para el periodo indicado. La columna Estado indica qué evidencia hay cargada: si dice &quot;Sin entregar&quot; falta subirla, y si dice &quot;Rechazado&quot; revisa el comentario de la validación.</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0 0;font-size:12px;color:#7b8d85;">${PRODUCT_NAME}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textRows = args.activities
    .map((a) => `- ${a.itemCode} · ${a.medida} · ${a.direccion} · ${a.periodicidad} · límite ${a.limitMonth} · ${a.status}`)
    .join("\n");
  const text = [
    args.message.trim() || `Hola ${safeName},`,
    `Actividades pendientes de ${args.planTitle} — periodo ${args.periodKey}:`,
    textRows,
    `Ver el plan: ${args.link}`,
  ]
    .filter((block) => block.length > 0)
    .join("\n\n");

  return { subject, html, text };
}

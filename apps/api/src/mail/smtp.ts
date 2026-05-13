import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../lib/env.js";
import type { MailMessage, MailProvider } from "./index.js";

/**
 * Generic SMTP mailer. Wraps any provider that exposes SMTP credentials
 * (Mailgun, SendGrid, Postmark, Amazon SES, self-hosted Postfix, etc.).
 * Configure via SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS env vars.
 */
export class SmtpMail implements MailProvider {
  private transporter: Transporter | null = null;
  private warned = false;

  private getTransporter(): Transporter | null {
    if (!env.SMTP_HOST) {
      if (!this.warned) {
        console.warn("[mail] SMTP_HOST not configured; emails will be logged to stdout only.");
        this.warned = true;
      }
      return null;
    }
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
      });
    }
    return this.transporter;
  }

  async send(msg: MailMessage): Promise<void> {
    const t = this.getTransporter();
    if (!t) {
      console.log("[mail] would send:", { to: msg.to, subject: msg.subject });
      return;
    }
    await t.sendMail({
      from: env.SMTP_FROM,
      to: Array.isArray(msg.to) ? msg.to.join(", ") : msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  }
}

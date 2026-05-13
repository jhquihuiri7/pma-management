export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
}

export interface MailProvider {
  send(msg: MailMessage): Promise<void>;
}

import { SmtpMail } from "./smtp.js";

let _provider: MailProvider | null = null;

export function getMail(): MailProvider {
  if (!_provider) {
    _provider = new SmtpMail();
  }
  return _provider;
}

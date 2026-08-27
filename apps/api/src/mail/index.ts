export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string | string[];
  /**
   * Copied recipients. Every address here sees the others and the `to`, so
   * only use it for people the recipient is meant to know are watching —
   * never to fan one message out to a list of unrelated addressees.
   */
  cc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Stable RFC Message-ID used by downstream providers/clients to dedupe retries. */
  messageId?: string;
  attachments?: MailAttachment[];
}

export interface MailProvider {
  send(msg: MailMessage): Promise<void>;
  close?(): Promise<void> | void;
}

import { SmtpMail } from "./smtp.js";

let _provider: MailProvider | null = null;

export function getMail(): MailProvider {
  if (!_provider) {
    _provider = new SmtpMail();
  }
  return _provider;
}

export async function closeMail(): Promise<void> {
  const provider = _provider;
  _provider = null;
  await provider?.close?.();
}

import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { mailOutboxJobs } from "../../db/schema/shared.js";
import { getMail, type MailMessage } from "../../mail/index.js";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function enqueueMail(
  tx: DbTransaction,
  message: Pick<MailMessage, "to" | "subject" | "html" | "text">,
  expiresAt: Date,
) {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  if (recipients.length === 0) throw new Error("Mail outbox requires a recipient");
  const rows = await tx
    .insert(mailOutboxJobs)
    .values(recipients.map((recipient) => ({
      recipient,
      subject: message.subject,
      html: message.html,
      textBody: message.text ?? null,
      expiresAt,
    })))
    .returning({ id: mailOutboxJobs.id });
  if (rows.length !== recipients.length) throw new Error("Mail outbox insert was not confirmed");
  return rows.map((row) => row.id);
}

/** Claim and deliver queued email without holding database locks during SMTP. */
export async function processPendingMail(limit = 20): Promise<{ sent: number; failed: number; expired: number }> {
  const db = getDb();
  const now = new Date();
  const staleLock = new Date(now.getTime() - 5 * 60_000);
  const claimable = or(isNull(mailOutboxJobs.lockedAt), lt(mailOutboxJobs.lockedAt, staleLock));
  const candidates = await db
    .select()
    .from(mailOutboxJobs)
    .where(and(lte(mailOutboxJobs.availableAt, now), claimable))
    .orderBy(asc(mailOutboxJobs.availableAt))
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let expired = 0;
  for (const candidate of candidates) {
    const claimTime = new Date();
    const [job] = await db
      .update(mailOutboxJobs)
      .set({ lockedAt: claimTime })
      .where(and(
        eq(mailOutboxJobs.id, candidate.id),
        or(isNull(mailOutboxJobs.lockedAt), lt(mailOutboxJobs.lockedAt, staleLock)),
      ))
      .returning();
    if (!job) continue;

    if (job.expiresAt <= now) {
      await db.delete(mailOutboxJobs).where(eq(mailOutboxJobs.id, job.id));
      expired += 1;
      continue;
    }

    try {
      await getMail().send({
        to: job.recipient,
        subject: job.subject,
        html: job.html,
        text: job.textBody ?? undefined,
        // SMTP cannot make the send+DB-delete boundary transactional. Reusing
        // one Message-ID makes a crash retry identifiable and deduplicable by
        // providers/clients instead of presenting as an unrelated new email.
        messageId: `<outbox-${job.id}@sigtar.gobiernogalapagos.gob.ec>`,
      });
      await db.delete(mailOutboxJobs).where(eq(mailOutboxJobs.id, job.id));
      sent += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const delayMs = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(attempts, 10));
      await db
        .update(mailOutboxJobs)
        .set({
          attempts,
          availableAt: new Date(Date.now() + delayMs),
          lockedAt: null,
          lastError: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        })
        .where(and(eq(mailOutboxJobs.id, job.id), eq(mailOutboxJobs.lockedAt, claimTime)));
      failed += 1;
    }
  }
  return { sent, failed, expired };
}

-- Keep the newest legacy notification for each evidence event before adding
-- database-level idempotency. Evidence outcome rows may be refreshed later.
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "user_id", "type", "evidence_id"
           ORDER BY "created_at" DESC, "id" DESC
         ) AS rn
  FROM "pma_notifications"
  WHERE "evidence_id" IS NOT NULL
    AND "type" IN (
      'evidence_submitted'::notification_type,
      'evidence_approved'::notification_type,
      'evidence_rejected'::notification_type
    )
)
DELETE FROM "pma_notifications"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "user_id", "type", "evidence_id"
           ORDER BY "created_at" DESC, "id" DESC
         ) AS rn
  FROM "rgdp_notifications"
  WHERE "evidence_id" IS NOT NULL
    AND "type" IN (
      'evidence_submitted'::notification_type,
      'evidence_approved'::notification_type,
      'evidence_rejected'::notification_type
    )
)
DELETE FROM "rgdp_notifications"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pma_notifications_evidence_event_unique_idx"
  ON "pma_notifications" ("user_id", "type", "evidence_id")
  WHERE "evidence_id" IS NOT NULL
    AND "type" IN (
      'evidence_submitted'::notification_type,
      'evidence_approved'::notification_type,
      'evidence_rejected'::notification_type
    );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rgdp_notifications_evidence_event_unique_idx"
  ON "rgdp_notifications" ("user_id", "type", "evidence_id")
  WHERE "evidence_id" IS NOT NULL
    AND "type" IN (
      'evidence_submitted'::notification_type,
      'evidence_approved'::notification_type,
      'evidence_rejected'::notification_type
    );

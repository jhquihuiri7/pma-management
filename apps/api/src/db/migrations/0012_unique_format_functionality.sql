-- Keep the latest configured format per functionality before enforcing the
-- invariant at database level. Superseded files are queued for durable cleanup.
WITH ranked AS (
  SELECT "id", "storage_path",
         row_number() OVER (PARTITION BY "functionality" ORDER BY "uploaded_at" DESC, "id" DESC) AS rn
  FROM "pma_formats"
), queued AS (
  INSERT INTO "storage_cleanup_jobs" ("storage_path", "reason")
  SELECT "storage_path", 'pma:format-deduplicated:migration-0012'
  FROM ranked WHERE rn > 1
  ON CONFLICT ("storage_path") DO NOTHING
)
DELETE FROM "pma_formats" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", "storage_path",
         row_number() OVER (PARTITION BY "functionality" ORDER BY "uploaded_at" DESC, "id" DESC) AS rn
  FROM "rgdp_formats"
), queued AS (
  INSERT INTO "storage_cleanup_jobs" ("storage_path", "reason")
  SELECT "storage_path", 'rgdp:format-deduplicated:migration-0012'
  FROM ranked WHERE rn > 1
  ON CONFLICT ("storage_path") DO NOTHING
)
DELETE FROM "rgdp_formats" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
ALTER TABLE "pma_formats"
  ADD CONSTRAINT "pma_formats_functionality_unique" UNIQUE("functionality");
--> statement-breakpoint
ALTER TABLE "rgdp_formats"
  ADD CONSTRAINT "rgdp_formats_functionality_unique" UNIQUE("functionality");

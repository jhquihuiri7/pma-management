DO $$ BEGIN
  CREATE TYPE "evidence_type" AS ENUM ('Informe', 'Registro Fotográfico', 'Certificado', 'Acta', 'Otros');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Added without a default on purpose: a default would be written into every
-- existing row immediately, leaving nothing for the backfill below to classify.
-- The default is attached at the end instead.
ALTER TABLE "pma_evidences" ADD COLUMN IF NOT EXISTS "evidence_type" "evidence_type";
--> statement-breakpoint
-- The type is mandatory for new uploads, so historical rows need one before the
-- NOT NULL constraint. The file name is the only record of intent available and
-- names the document explicitly often enough to be worth using. Name keywords
-- win over the extension: a scanned "Acta ....jpeg" is an Acta, not a
-- photographic record. Anything unmatched becomes 'Otros', which asserts
-- "unclassified" rather than a guess about the content.
UPDATE "pma_evidences" SET "evidence_type" =
  CASE
    WHEN "file_name" ~* 'acta'                       THEN 'Acta'
    WHEN "file_name" ~* 'certificad'                 THEN 'Certificado'
    WHEN "file_name" ~* 'informe|iac'                THEN 'Informe'
    WHEN "file_name" ~* '\.(png|jpe?g|gif|heic|webp|bmp|tiff?)$' THEN 'Registro Fotográfico'
    ELSE 'Otros'
  END::"evidence_type"
WHERE "evidence_type" IS NULL;
--> statement-breakpoint
ALTER TABLE "pma_evidences" ALTER COLUMN "evidence_type" SET NOT NULL;
--> statement-breakpoint
-- Applied last so it never pre-fills the backfill above. It keeps this migration
-- safe to run before the application code that knows about the column: an older
-- API inserting without evidence_type still satisfies NOT NULL. The current API
-- always sends the value explicitly (its upload schema requires it), so the
-- default only ever covers that deploy window.
ALTER TABLE "pma_evidences" ALTER COLUMN "evidence_type" SET DEFAULT 'Otros';

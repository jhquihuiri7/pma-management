-- Repair compliance rows written under a clipped period key.
--
-- `getPeriodLabel` on the web used to name the period in progress after
-- whatever month was current, so a single reporting block accumulated one
-- `period_key` per month in which somebody graded it: the block mar–ago 2026
-- was stored as "mar-may 2026" in April and again as "mar-jul 2026" in June.
-- Since 2026-07-22 the API validates keys against `enabledPeriodKeys`, which
-- only ever emits whole blocks, so those spellings are now unreachable: the
-- Cronograma and the compliance charts look for the whole-block key and no
-- longer find these grades.
--
-- The mapping is spelled out rather than derived. Recomputing a block key in
-- SQL would mean parsing Spanish month abbreviations (including the CLDR
-- "sept", which is what actually reaches the database) and re-deriving each
-- plan's origin — fragile for a one-off repair of six known keys. Each key
-- below was verified to belong to exactly one plan, whose block grid makes the
-- target unambiguous:
--
--   ene-may 2026, ene-jun 2026            -> ene-dic 2026          (1 año,   inicio 2026-01-01)
--   mar-may 2026, mar-jul 2026            -> mar-ago 2026          (6 meses, inicio 2023-09-19)
--   sept 2024-may 2026, sept 2024-jun 2026 -> sept 2024-ago 2026   (2 años,  inicio 2018-09-07)
--
-- Where an item was graded under both spellings of the same block, the most
-- recent grade wins. Runs to a no-op on any database that never stored these
-- keys.
WITH remap(old_key, new_key) AS (
  VALUES
    ('ene-may 2026', 'ene-dic 2026'),
    ('ene-jun 2026', 'ene-dic 2026'),
    ('mar-may 2026', 'mar-ago 2026'),
    ('mar-jul 2026', 'mar-ago 2026'),
    ('sept 2024-may 2026', 'sept 2024-ago 2026'),
    ('sept 2024-jun 2026', 'sept 2024-ago 2026')
),
winners AS (
  SELECT DISTINCT ON (c."plan_item_id", r.new_key)
         c."plan_item_id" AS plan_item_id,
         r.new_key        AS period_key,
         c."status"       AS status,
         c."updated_at"   AS updated_at
  FROM "pma_period_compliance" c
  JOIN remap r ON r.old_key = c."period_key"
  ORDER BY c."plan_item_id", r.new_key, c."updated_at" DESC, c."period_key" DESC
)
INSERT INTO "pma_period_compliance" ("plan_item_id", "period_key", "status", "updated_at")
SELECT plan_item_id, period_key, status, updated_at FROM winners
ON CONFLICT ("plan_item_id", "period_key") DO UPDATE
  SET "status" = EXCLUDED."status",
      "updated_at" = EXCLUDED."updated_at"
  -- Never let a recovered grade overwrite a newer one entered under the
  -- correct key after this bug was fixed.
  WHERE "pma_period_compliance"."updated_at" < EXCLUDED."updated_at";
--> statement-breakpoint
DELETE FROM "pma_period_compliance"
WHERE "period_key" IN (
  'ene-may 2026',
  'ene-jun 2026',
  'mar-may 2026',
  'mar-jul 2026',
  'sept 2024-may 2026',
  'sept 2024-jun 2026'
);

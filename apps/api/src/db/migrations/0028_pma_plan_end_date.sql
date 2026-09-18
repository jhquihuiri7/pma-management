-- Give a "Vencida" PMA plan the date its instrument stopped being in force.
--
-- 0027 added `estado` as a pure label, noting that "a PMA carries no expiry
-- date in this database" so nothing could derive it. This column is that date,
-- and it turns the label into a schedule boundary: once set, the plan's
-- calendar, its reporting periods, its charts and the months that accept an
-- evidence all stop at the month it falls in.
--
-- Nullable, and empty for every existing row: a plan in force has no end, and
-- legacy rows already marked 'Vencida' by hand keep behaving exactly as they
-- do today (a NULL end date means "no ceiling"), instead of being assigned a
-- date nobody could know.
ALTER TABLE "pma_plans"
  ADD COLUMN IF NOT EXISTS "end_date" date;--> statement-breakpoint
-- The end cannot precede the origin. `start_date` is NOT NULL since 0024, so
-- this is total over the rows that carry an end date.
DO $$ BEGIN
  ALTER TABLE "pma_plans"
    ADD CONSTRAINT "pma_plans_end_date_not_before_start"
    CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
-- A plan in force with an end date on it is the one contradiction worth making
-- unrepresentable: returning a plan to 'Vigente' clears the column, and this
-- keeps a stale date from surviving that transition and silently truncating a
-- live calendar.
--
-- The converse — 'Vencida' must carry a date — is deliberately NOT a
-- constraint. Rows marked 'Vencida' before this migration have no date to
-- backfill, and a biconditional CHECK would refuse to validate against them.
-- The API enforces that half on every write (see `assertEstadoEndDatePair`),
-- so new transitions cannot omit it while the legacy rows stay loadable.
DO $$ BEGIN
  ALTER TABLE "pma_plans"
    ADD CONSTRAINT "pma_plans_vigente_has_no_end_date"
    CHECK ("estado" <> 'Vigente' OR "end_date" IS NULL);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Rows imported from Excel before the direccion selector existed kept the
-- trailing whitespace of the source cell ("DOSPPSVR ", "DAF "). The edit form
-- round-trips the stored value verbatim, so the API's enum rejected every
-- update of those 16 items with a 400 while the selector — finding no matching
-- <option> — displayed a different direccion than the one being submitted.
--
-- Only whitespace is stripped: every trimmed value already belongs to the
-- catalog, so no row changes which direccion it is assigned to.
UPDATE "pma_plan_items"
SET "direccion" = btrim("direccion")
WHERE "direccion" IS NOT NULL AND "direccion" <> btrim("direccion");
--> statement-breakpoint
UPDATE "rgdp_plan_items"
SET "direccion" = btrim("direccion")
WHERE "direccion" IS NOT NULL AND "direccion" <> btrim("direccion");

-- Remove compliance rows left on a reporting block that no longer exists.
--
-- Plan "Helipuerto Santa Cruz" (2 años) was graded on 2026-08-03 while its
-- `start_date` still placed a block at ago 2023–jul 2025. The start date was
-- corrected to 2016-08-13 the same day at 19:21, which shifted the whole grid
-- by an odd number of years: the blocks became ago 2016, ago 2018, ago 2020,
-- ago 2022 and ago 2024. The 14 items were then re-graded on the corrected
-- grid, but the nine rows from the first pass stayed behind, pointing at a
-- block the plan no longer has. `enabledPeriodKeys` cannot produce that key, so
-- nothing reads them: they are invisible to the Cronograma and to the
-- compliance charts, and they inflate row counts for anyone querying directly.
--
-- Deleting them loses no assessment. Every one of the plan's 14 items already
-- carries a grade on each valid block, and the nine affected items (PMA-01 to
-- PMA-09) were re-graded afterwards on the corrected grid — including PMA-08,
-- the only item whose orphaned value differed, which the later pass
-- deliberately set to 'N/A'.
--
-- Scoped by plan on purpose. The literal key is not reserved: another plan
-- could legitimately own a ago 2023–jul 2025 block, and this repair must not
-- reach it.
--
-- NOTE: this is a one-off cleanup, not a guard. Editing a plan's `start_date`
-- or `report_per` still silently orphans existing compliance rows, because both
-- fields define the block grid the keys are derived from. Preventing a
-- recurrence needs a check at the point of edit, which is deliberately out of
-- scope here.
DELETE FROM "pma_period_compliance" AS c
USING "pma_plan_items" AS i
WHERE i."id" = c."plan_item_id"
  AND i."plan_id" = '106b23fb-5b08-42f5-951b-2fd075afd4d3'
  AND c."period_key" = 'ago 2023-jul 2025';

-- Repair databases that applied the original 178 trigger before it watched id.
-- Recreate the trigger and advance the generation to invalidate any projection
-- built before the missing group-id fence was repaired.
DROP TRIGGER IF EXISTS quota_combo_generation_group_update;
CREATE TRIGGER quota_combo_generation_group_update
AFTER UPDATE OF id, name ON quota_groups
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
WHERE key = 'quota_combo_generation';

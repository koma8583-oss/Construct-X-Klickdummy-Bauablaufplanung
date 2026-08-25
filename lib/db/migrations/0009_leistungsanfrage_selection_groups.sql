-- Parallel Leistungsanfragen are grouped for one exclusive AG selection.
-- Existing historic rows remain single-recipient groups by using their own ID.
ALTER TABLE leistungsanfragen
  ADD COLUMN IF NOT EXISTS selection_group_id text;

UPDATE leistungsanfragen
SET selection_group_id = id
WHERE selection_group_id IS NULL;

ALTER TABLE leistungsanfragen
  ALTER COLUMN selection_group_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS leistungsanfragen_selection_group_id_idx
  ON leistungsanfragen (selection_group_id);
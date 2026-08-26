-- Automated AN availability responses are valid domain events even when no
-- human user initiated them.
ALTER TABLE IF EXISTS an_leistungsantworten
  ALTER COLUMN created_by_user_id DROP NOT NULL;
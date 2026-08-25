DO $$
BEGIN
  CREATE TYPE leistungsantwort_origin AS ENUM (
    'LOCAL',
    'DATASPACE_INBOUND'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE leistungsantworten
  ADD COLUMN IF NOT EXISTS origin leistungsantwort_origin NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN IF NOT EXISTS source_org_id text REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

ALTER TABLE leistungsantworten
  ALTER COLUMN created_by_user_id DROP NOT NULL;
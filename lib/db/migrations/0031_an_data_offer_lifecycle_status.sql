-- Keep the immutable AN-local data-offer snapshot separate from the mutable
-- publication lifecycle. Existing projections are backfilled only when their
-- stored snapshot contains one of the supported lifecycle values; malformed
-- values remain NULL and must fail closed at the API boundary.
ALTER TABLE an_project_invitations
  ADD COLUMN IF NOT EXISTS data_offer_lifecycle_status text;

UPDATE an_project_invitations
SET data_offer_lifecycle_status = CASE
  WHEN data_offer_snapshot ->> 'status' IN ('PUBLISHED', 'SUSPENDED', 'WITHDRAWN')
    THEN data_offer_snapshot ->> 'status'
  ELSE NULL
END
WHERE data_publication_id IS NOT NULL
  AND data_offer_lifecycle_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'an_project_invitation_offer_lifecycle_status_check'
      AND conrelid = 'an_project_invitations'::regclass
  ) THEN
    ALTER TABLE an_project_invitations
      ADD CONSTRAINT an_project_invitation_offer_lifecycle_status_check
      CHECK (
        data_offer_lifecycle_status IS NULL
        OR data_offer_lifecycle_status IN ('PUBLISHED', 'SUSPENDED', 'WITHDRAWN')
      );
  END IF;
END $$;
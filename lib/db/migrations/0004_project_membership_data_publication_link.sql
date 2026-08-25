-- AG-side link between a published data offer and its project membership.
-- Kept separate from the AN invitation projection so the migration can be
-- applied safely to physically separate AG and AN databases.
ALTER TABLE data_publication_recipients
  ADD COLUMN IF NOT EXISTS project_membership_id text
  REFERENCES project_memberships(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS data_pub_recipient_membership_idx
  ON data_publication_recipients(project_membership_id);
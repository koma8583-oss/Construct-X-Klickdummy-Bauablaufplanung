ALTER TABLE project_memberships
  ADD COLUMN IF NOT EXISTS data_publication_id text
    REFERENCES data_publications(id) ON DELETE SET NULL;

ALTER TABLE data_publications
  ADD COLUMN IF NOT EXISTS project_invitation_id text;

DO $$ BEGIN
  ALTER TABLE data_publications
    ADD CONSTRAINT uq_data_publication_project_invitation UNIQUE (project_invitation_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS project_memberships_data_publication_idx
  ON project_memberships(data_publication_id);
CREATE INDEX IF NOT EXISTS data_publications_project_invitation_idx
  ON data_publications(project_invitation_id);
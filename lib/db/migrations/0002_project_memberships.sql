DO $$ BEGIN
  CREATE TYPE project_membership_status AS ENUM ('INVITED','ACTIVE','REJECTED','REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE dataspace_exchange_message_type ADD VALUE IF NOT EXISTS 'PROJECT_INVITATION';
ALTER TYPE dataspace_exchange_message_type ADD VALUE IF NOT EXISTS 'PROJECT_INVITATION_RESPONSE';
ALTER TYPE dataspace_message_type ADD VALUE IF NOT EXISTS 'PROJECT_INVITATION';
ALTER TYPE dataspace_message_type ADD VALUE IF NOT EXISTS 'PROJECT_INVITATION_RESPONSE';

CREATE TABLE IF NOT EXISTS project_memberships (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ag_org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  an_org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  an_participant_id text,
  status project_membership_status NOT NULL DEFAULT 'INVITED',
  invitation_message text,
  invitation_id text NOT NULL UNIQUE,
  correlation_id text NOT NULL UNIQUE,
  invitation_expires_at timestamptz,
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_membership_project_an UNIQUE (project_id, an_org_id)
);
CREATE INDEX IF NOT EXISTS project_memberships_project_idx ON project_memberships(project_id);
CREATE INDEX IF NOT EXISTS project_memberships_an_idx ON project_memberships(an_org_id);
CREATE INDEX IF NOT EXISTS project_memberships_status_idx ON project_memberships(status);

-- Existing active contractor relationships are the compatibility baseline.
INSERT INTO project_memberships
  (id, project_id, ag_org_id, an_org_id, status, invitation_id, correlation_id, invited_at, accepted_at)
SELECT gen_random_uuid()::text, pc.project_id, p.ag_org_id, pc.an_org_id, 'ACTIVE',
       'legacy-membership-' || pc.project_id || '-' || pc.an_org_id,
       'legacy-membership:' || pc.project_id || ':' || pc.an_org_id,
       COALESCE(pc.added_at, now()), COALESCE(pc.added_at, now())
FROM project_contractors pc
JOIN projects p ON p.id = pc.project_id
WHERE pc.assignment_status = 'ACTIVE'
ON CONFLICT (project_id, an_org_id) DO NOTHING;
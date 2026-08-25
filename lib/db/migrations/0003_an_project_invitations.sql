DO $$ BEGIN
  CREATE TYPE an_project_invitation_status AS ENUM ('PENDING','ACCEPTED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS an_project_invitations (
  id text PRIMARY KEY,
  invitation_id text NOT NULL UNIQUE,
  correlation_id text NOT NULL UNIQUE,
  sender_ag_org_id text NOT NULL,
  receiver_an_org_id text NOT NULL,
  project_reference text NOT NULL,
  project_name text NOT NULL,
  project_description text,
  project_location text,
  invitation_message text,
  invitation_expires_at timestamptz,
  data_publication_id text,
  data_publication_title text,
  selected_fields jsonb,
  policy_snapshot jsonb NOT NULL,
  status an_project_invitation_status NOT NULL DEFAULT 'PENDING',
  policy_accepted_at timestamptz,
  responded_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS an_project_invitation_receiver_status_idx
  ON an_project_invitations(receiver_an_org_id, status);
CREATE INDEX IF NOT EXISTS an_project_invitation_correlation_idx
  ON an_project_invitations(correlation_id);
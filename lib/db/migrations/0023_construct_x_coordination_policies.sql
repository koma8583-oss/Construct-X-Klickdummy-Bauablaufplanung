DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coordination_policy_kind') THEN
    CREATE TYPE coordination_policy_kind AS ENUM (
      'PROJECT_AGREEMENT', 'PERFORMANCE_REQUEST', 'SCHEDULE_CHANGE', 'DATA_OFFER'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coordination_policy_lifecycle') THEN
    CREATE TYPE coordination_policy_lifecycle AS ENUM (
      'DRAFT', 'PUBLISHED', 'CONSENT_REQUIRED', 'ACCEPTED',
      'REJECTED', 'SUPERSEDED', 'REVOKED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coordination_policy_delta_class') THEN
    CREATE TYPE coordination_policy_delta_class AS ENUM (
      'WITHIN_BASELINE', 'REQUIRES_CONSENT', 'NOT_PERMITTED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS coordination_policies (
  id text PRIMARY KEY,
  policy_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  kind coordination_policy_kind NOT NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  provider_org_id text NOT NULL,
  recipient_org_id text NOT NULL,
  parent_policy_id text REFERENCES coordination_policies(id) ON DELETE RESTRICT,
  lifecycle_status coordination_policy_lifecycle NOT NULL DEFAULT 'DRAFT',
  delta_class coordination_policy_delta_class,
  policy_snapshot jsonb NOT NULL,
  diff jsonb,
  effective_policy jsonb,
  consented_at timestamptz,
  consented_by_org_id text,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coordination_policies_key_version_unique UNIQUE (policy_key, version)
);

CREATE INDEX IF NOT EXISTS coordination_policies_project_idx
  ON coordination_policies (project_id);
CREATE INDEX IF NOT EXISTS coordination_policies_parent_idx
  ON coordination_policies (parent_policy_id);
CREATE INDEX IF NOT EXISTS coordination_policies_recipient_kind_idx
  ON coordination_policies (recipient_org_id, kind);

ALTER TABLE project_memberships
  ADD COLUMN IF NOT EXISTS project_agreement_policy_id text
  REFERENCES coordination_policies(id) ON DELETE RESTRICT;

ALTER TABLE leistungsanfragen
  ADD COLUMN IF NOT EXISTS performance_policy_id text
  REFERENCES coordination_policies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS schedule_change_policy_id text
  REFERENCES coordination_policies(id) ON DELETE RESTRICT;
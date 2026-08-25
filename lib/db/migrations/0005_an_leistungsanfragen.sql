DO $$
BEGIN
  CREATE TYPE an_leistungsanfrage_status AS ENUM (
    'RECEIVED',
    'DETAILS_RETRIEVED',
    'UNDER_REVIEW',
    'RESPONDED',
    'REVISION_REQUIRED',
    'CONFIRMED',
    'CANCELLED',
    'SUPERSEDED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS an_leistungsanfragen (
  id text PRIMARY KEY,
  external_leistungsanfrage_id text NOT NULL,
  external_request_version integer NOT NULL,
  source_message_id text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id text NOT NULL,
  sender_ag_org_id text NOT NULL,
  receiver_an_org_id text NOT NULL,
  project_reference text NOT NULL,
  leistung_reference text NOT NULL,
  planned_start text NOT NULL,
  planned_end text NOT NULL,
  policy_snapshot jsonb,
  payload_snapshot jsonb NOT NULL,
  status an_leistungsanfrage_status NOT NULL DEFAULT 'RECEIVED',
  received_at timestamptz NOT NULL DEFAULT now(),
  details_retrieved_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_an_leistungsanfrage_source_message UNIQUE (source_message_id),
  CONSTRAINT uq_an_leistungsanfrage_receiver_external_version
    UNIQUE (receiver_an_org_id, external_leistungsanfrage_id, external_request_version)
);

CREATE INDEX IF NOT EXISTS an_leistungsanfragen_receiver_status_idx
  ON an_leistungsanfragen (receiver_an_org_id, status);
CREATE INDEX IF NOT EXISTS an_leistungsanfragen_external_idx
  ON an_leistungsanfragen (receiver_an_org_id, external_leistungsanfrage_id);

CREATE TABLE IF NOT EXISTS an_leistungsanfrage_resource_requirements (
  id text PRIMARY KEY,
  an_leistungsanfrage_id text NOT NULL
    REFERENCES an_leistungsanfragen(id) ON DELETE CASCADE,
  external_resource_type_code text NOT NULL,
  external_resource_type_name text NOT NULL,
  local_resource_type_id text,
  required_capacity numeric(10, 2),
  capacity_unit text NOT NULL,
  utilization_percent integer NOT NULL,
  period_start text NOT NULL,
  period_end text NOT NULL,
  required_qualification text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS an_leistungsanfrage_resource_requirements_request_idx
  ON an_leistungsanfrage_resource_requirements (an_leistungsanfrage_id);
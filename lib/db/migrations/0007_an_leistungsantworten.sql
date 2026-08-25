DO $$
BEGIN
  CREATE TYPE an_leistungsantwort_decision AS ENUM (
    'ACCEPTED',
    'ALTERNATIVES_PROPOSED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS an_leistungsantworten (
  id text PRIMARY KEY,
  an_leistungsanfrage_id text NOT NULL
    REFERENCES an_leistungsanfragen(id) ON DELETE CASCADE,
  source_request_id text NOT NULL,
  request_version integer NOT NULL,
  decision an_leistungsantwort_decision NOT NULL,
  reason_code text,
  comment text,
  accepted_start timestamptz,
  accepted_end timestamptz,
  next_available_date date,
  payload_hash text NOT NULL,
  outbound_message_id text NOT NULL UNIQUE,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_an_leistungsantwort_request_version
    UNIQUE (an_leistungsanfrage_id, request_version)
);

CREATE INDEX IF NOT EXISTS an_leistungsantworten_request_idx
  ON an_leistungsantworten (an_leistungsanfrage_id);
CREATE INDEX IF NOT EXISTS an_leistungsantworten_source_request_idx
  ON an_leistungsantworten (source_request_id, request_version);

CREATE TABLE IF NOT EXISTS an_leistungsantwort_alternativen (
  id text PRIMARY KEY,
  response_id text NOT NULL
    REFERENCES an_leistungsantworten(id) ON DELETE CASCADE,
  alternative_id text NOT NULL,
  rank integer NOT NULL,
  proposed_start timestamptz NOT NULL,
  proposed_end timestamptz NOT NULL,
  crew_size integer,
  conditions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_an_leistungsantwort_alternative_id UNIQUE (response_id, alternative_id),
  CONSTRAINT uq_an_leistungsantwort_rank UNIQUE (response_id, rank)
);

CREATE INDEX IF NOT EXISTS an_leistungsantwort_alternativen_response_idx
  ON an_leistungsantwort_alternativen (response_id);
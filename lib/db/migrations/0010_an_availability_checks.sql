CREATE TABLE IF NOT EXISTS an_availability_checks (
  id TEXT PRIMARY KEY,
  an_leistungsanfrage_id TEXT NOT NULL REFERENCES an_leistungsanfragen(id) ON DELETE CASCADE,
  an_org_id TEXT NOT NULL REFERENCES organizations(id),
  status availability_check_status NOT NULL DEFAULT 'PENDING',
  result availability_result,
  run_number INTEGER NOT NULL DEFAULT 1,
  internal_result_payload JSONB,
  public_result_payload JSONB,
  checked_at TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS an_availability_checks_request_org_run_idx
  ON an_availability_checks (an_leistungsanfrage_id, an_org_id, run_number);
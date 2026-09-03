DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'dataspace_access_grant_status'
  ) THEN
    CREATE TYPE dataspace_access_grant_status AS ENUM ('ACTIVE', 'EXPIRED', 'INVALID', 'REVOKED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dataspace_access_grants (
  id text PRIMARY KEY,
  sender_bpn text NOT NULL,
  receiver_bpn text NOT NULL,
  asset_id text NOT NULL,
  contract_agreement_id text NOT NULL,
  edr_id text,
  data_plane_url text,
  status dataspace_access_grant_status NOT NULL DEFAULT 'ACTIVE',
  agreement_expires_at timestamptz,
  edr_expires_at timestamptz,
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataspace_access_grants_participants_asset_key
    UNIQUE (sender_bpn, receiver_bpn, asset_id)
);

CREATE INDEX IF NOT EXISTS dataspace_access_grants_status_idx
  ON dataspace_access_grants (status);
CREATE INDEX IF NOT EXISTS dataspace_access_grants_expiry_idx
  ON dataspace_access_grants (agreement_expires_at, edr_expires_at);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'an_policy_delta_class') THEN
    CREATE TYPE an_policy_delta_class AS ENUM (
      'WITHIN_BASELINE', 'REQUIRES_CONSENT', 'NOT_PERMITTED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'an_policy_consent_status') THEN
    CREATE TYPE an_policy_consent_status AS ENUM (
      'NOT_REQUIRED', 'PENDING', 'ACCEPTED', 'REJECTED'
    );
  END IF;
END $$;

ALTER TABLE an_leistungsanfragen
  ADD COLUMN IF NOT EXISTS policy_delta_class an_policy_delta_class,
  ADD COLUMN IF NOT EXISTS policy_consent_status an_policy_consent_status NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS policy_diff jsonb,
  ADD COLUMN IF NOT EXISTS effective_policy jsonb;
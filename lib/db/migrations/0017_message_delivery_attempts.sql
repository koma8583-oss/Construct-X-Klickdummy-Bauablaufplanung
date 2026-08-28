CREATE TABLE IF NOT EXISTS message_delivery_attempts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id text NOT NULL,
  attempt_number integer NOT NULL,
  status dataspace_message_status NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_message_delivery_attempt_message_number UNIQUE (message_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS msg_delivery_attempts_message_idx
  ON message_delivery_attempts(message_id);
CREATE INDEX IF NOT EXISTS msg_delivery_attempts_message_attempt_idx
  ON message_delivery_attempts(message_id, attempt_number);
CREATE INDEX IF NOT EXISTS msg_delivery_attempts_attempted_at_idx
  ON message_delivery_attempts(attempted_at);
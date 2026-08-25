ALTER TABLE dataspace_exchanges
  DROP CONSTRAINT IF EXISTS dataspace_exchanges_message_id_key;

DROP INDEX IF EXISTS dataspace_exchanges_message_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS dataspace_exchanges_direction_message_id_key
  ON dataspace_exchanges (direction, message_id);
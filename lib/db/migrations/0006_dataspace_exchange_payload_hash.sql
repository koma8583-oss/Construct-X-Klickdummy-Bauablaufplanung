ALTER TABLE dataspace_exchanges
  ADD COLUMN IF NOT EXISTS payload_hash text;
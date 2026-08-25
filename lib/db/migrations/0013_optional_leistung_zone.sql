-- Zone is descriptive metadata and may be unknown when a Leistung is created.
ALTER TABLE leistungen
  ALTER COLUMN zone DROP NOT NULL;
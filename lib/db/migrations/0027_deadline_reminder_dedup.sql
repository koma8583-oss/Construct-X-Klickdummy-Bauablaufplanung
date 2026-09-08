-- Preserve the deadline worker's idempotency invariant after legacy/fresh
-- shared-database partitioning. Some bootstrap paths historically lost the
-- Drizzle-generated unique index while moving tables out of public.

DO $$
BEGIN
  IF to_regclass('ag.leistungsanfrage_reminders') IS NULL THEN
    RAISE EXCEPTION 'ag.leistungsanfrage_reminders is required before applying reminder deduplication';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ag.leistungsanfrage_reminders
    GROUP BY leistungsanfrage_id, reminder_type, deduplication_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce reminder deduplication: duplicate reminder keys already exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leistungsanfrage_reminder_dedup
  ON ag.leistungsanfrage_reminders (
    leistungsanfrage_id,
    reminder_type,
    deduplication_key
  );

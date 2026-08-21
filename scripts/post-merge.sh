#!/bin/bash
set -e
pnpm install --frozen-lockfile

if [[ -n "${DATABASE_URL:-}" ]]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0001_leistungen_canonical_rename.sql

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.leistungsantworten') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.leistungsantworten'::regclass
         AND conname = 'leistungsantworten_response_payload_hash_unique'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.leistungsantworten
       WHERE response_payload_hash IS NOT NULL
       GROUP BY response_payload_hash
       HAVING COUNT(*) > 1
     )
  THEN
    ALTER TABLE public.leistungsantworten
      ADD CONSTRAINT leistungsantworten_response_payload_hash_unique
      UNIQUE (response_payload_hash);
  END IF;
END $$;
SQL
fi

pnpm -w run typecheck:libs

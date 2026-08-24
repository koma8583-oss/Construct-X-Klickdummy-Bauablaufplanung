#!/bin/bash
set -e
pnpm install --frozen-lockfile

if [[ -n "${AG_DATABASE_URL:-}" && -n "${AN_DATABASE_URL:-}" && -n "${HUB_DATABASE_URL:-}" ]]; then
  if [[ "$AG_DATABASE_URL" == "$AN_DATABASE_URL" || "$AG_DATABASE_URL" == "$HUB_DATABASE_URL" || "$AN_DATABASE_URL" == "$HUB_DATABASE_URL" ]]; then
    echo "AG, AN and Hub databases must be different" >&2
    exit 1
  fi
  psql "$AG_DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0001_leistungen_canonical_rename.sql
  psql "$AG_DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0002_project_memberships.sql
  for role in ag an hub; do
    echo "Applying role-specific schema to ${role} database"
    DB_ROLE="$role" pnpm --filter @workspace/db run push-force
  done

  psql "$AG_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
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
elif [[ -n "${DATABASE_URL:-}" && -z "${AG_DATABASE_URL:-}" && -z "${AN_DATABASE_URL:-}" && -z "${HUB_DATABASE_URL:-}" ]]; then
  echo "Using the configured single development database with logical AG/AN/Hub isolation"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0001_leistungen_canonical_rename.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0002_project_memberships.sql
fi

pnpm -w run typecheck:libs

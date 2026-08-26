#!/bin/bash
set -e
pnpm install --frozen-lockfile

apply_ag_migrations() {
  local database_url="$1"
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0001_leistungen_canonical_rename.sql
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0002_project_memberships.sql
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0004_project_membership_data_publication_link.sql
}

apply_an_migrations() {
  local database_url="$1"
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0003_an_project_invitations.sql
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0016_an_project_invitation_offer_snapshot.sql
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0005_an_leistungsanfragen.sql
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0007_an_leistungsantworten.sql
}

apply_hub_migrations() {
  local database_url="$1"
  psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0006_dataspace_exchange_payload_hash.sql
}

apply_shared_post_migration() {
  local database_url="$1"
  psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
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
}

if [[ -n "${AG_DATABASE_URL:-}" && -n "${AN_DATABASE_URL:-}" && -n "${HUB_DATABASE_URL:-}" ]]; then
  if [[ "$AG_DATABASE_URL" == "$AN_DATABASE_URL" && "$AG_DATABASE_URL" == "$HUB_DATABASE_URL" ]]; then
    echo "Applying the complete shared PoC schema once for AG, AN and Hub"
    apply_ag_migrations "$AG_DATABASE_URL"
    apply_an_migrations "$AG_DATABASE_URL"
    apply_hub_migrations "$AG_DATABASE_URL"
    DB_ROLE=shared DATABASE_URL="$AG_DATABASE_URL" pnpm --filter @workspace/db run push-force
    apply_shared_post_migration "$AG_DATABASE_URL"
  else
    echo "Applying role-specific schemas to separate AG, AN and Hub databases"
    apply_ag_migrations "$AG_DATABASE_URL"
    apply_an_migrations "$AN_DATABASE_URL"
    apply_hub_migrations "$HUB_DATABASE_URL"
    DB_ROLE=ag pnpm --filter @workspace/db run push-force
    DB_ROLE=an pnpm --filter @workspace/db run push-force
    DB_ROLE=hub pnpm --filter @workspace/db run push-force
    apply_shared_post_migration "$AG_DATABASE_URL"
  fi
elif [[ -n "${DATABASE_URL:-}" && -z "${AG_DATABASE_URL:-}" && -z "${AN_DATABASE_URL:-}" && -z "${HUB_DATABASE_URL:-}" ]]; then
  echo "Applying the complete shared PoC schema to DATABASE_URL"
  apply_ag_migrations "$DATABASE_URL"
  DB_ROLE=shared DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push-force
  apply_shared_post_migration "$DATABASE_URL"
fi

pnpm -w run typecheck:libs

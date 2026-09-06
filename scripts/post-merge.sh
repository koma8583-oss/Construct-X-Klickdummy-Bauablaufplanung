#!/bin/bash
set -e
pnpm install --frozen-lockfile

apply_ag_migrations() {
  local database_url="$1"
  PGOPTIONS="-c search_path=ag,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0001_leistungen_canonical_rename.sql
  PGOPTIONS="-c search_path=ag,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0002_project_memberships.sql
  PGOPTIONS="-c search_path=ag,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0004_project_membership_data_publication_link.sql
  PGOPTIONS="-c search_path=ag,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0023_construct_x_coordination_policies.sql
}

apply_an_migrations() {
  local database_url="$1"
  PGOPTIONS="-c search_path=an,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0003_an_project_invitations.sql
  PGOPTIONS="-c search_path=an,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0016_an_project_invitation_offer_snapshot.sql
  PGOPTIONS="-c search_path=an,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0005_an_leistungsanfragen.sql
  PGOPTIONS="-c search_path=an,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0007_an_leistungsantworten.sql
  PGOPTIONS="-c search_path=an,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0024_an_policy_consent.sql
}

apply_hub_migrations() {
  local database_url="$1"
  PGOPTIONS="-c search_path=hub,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0006_dataspace_exchange_payload_hash.sql
  PGOPTIONS="-c search_path=hub,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0017_message_delivery_attempts.sql
  PGOPTIONS="-c search_path=hub,public,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 \
    -f lib/db/migrations/0022_dataspace_access_grants.sql
}

apply_shared_post_migration() {
  local database_url="$1"
  PGOPTIONS="-c search_path=ag,pg_catalog" psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('leistungsantworten') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'leistungsantworten'::regclass
         AND conname = 'leistungsantworten_response_payload_hash_unique'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM leistungsantworten
       WHERE response_payload_hash IS NOT NULL
       GROUP BY response_payload_hash
       HAVING COUNT(*) > 1
     )
  THEN
    ALTER TABLE leistungsantworten
      ADD CONSTRAINT leistungsantworten_response_payload_hash_unique
      UNIQUE (response_payload_hash);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('leistungsabhaengigkeiten') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'leistungsabhaengigkeiten'::regclass
         AND conname = 'leistungsabhaengigkeiten_predecessor_id_successor_id_unique'
     )
  THEN
    IF EXISTS (
       SELECT predecessor_id, successor_id
       FROM leistungsabhaengigkeiten
      GROUP BY predecessor_id, successor_id
      HAVING COUNT(*) > 1
    )
    THEN
      RAISE EXCEPTION
        'Cannot add leistungsabhaengigkeiten predecessor/successor uniqueness: duplicate pairs exist';
    END IF;

     ALTER TABLE leistungsabhaengigkeiten
      ADD CONSTRAINT leistungsabhaengigkeiten_predecessor_id_successor_id_unique
      UNIQUE (predecessor_id, successor_id);
  END IF;
END $$;
SQL
}

database_admin_url="${DATABASE_ADMIN_URL:-${DATABASE_URL:-${AG_DATABASE_URL:-}}}"
if [[ -z "$database_admin_url" ]]; then
  echo "A shared DATABASE_URL (or DATABASE_ADMIN_URL) is required for schema initialization" >&2
  exit 1
fi

echo "Applying the shared PostgreSQL schema and role bootstrap"
psql "$database_admin_url" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/0025_shared_database_roles.sql

role_schema_is_empty() {
  local schema_name="$1"
  [[ "$(psql "$database_admin_url" -Atqc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${schema_name}' AND table_type = 'BASE TABLE'")" == "0" ]]
}

if role_schema_is_empty ag; then
  DATABASE_URL="$database_admin_url" DB_ROLE=ag pnpm --filter @workspace/db run push-force
fi
if role_schema_is_empty an; then
  DATABASE_URL="$database_admin_url" DB_ROLE=an pnpm --filter @workspace/db run push-force
fi
if role_schema_is_empty hub; then
  DATABASE_URL="$database_admin_url" DB_ROLE=hub pnpm --filter @workspace/db run push-force
fi

# Raw migrations depend on the complete role-local schema and enum types.
# Fresh installs therefore push first; existing installs skip the push and
# apply the same migrations in place.
apply_ag_migrations "$database_admin_url"
apply_an_migrations "$database_admin_url"
apply_hub_migrations "$database_admin_url"

# Re-apply grants after Drizzle creates any new table or sequence.
psql "$database_admin_url" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/0025_shared_database_roles.sql
apply_shared_post_migration "$database_admin_url"

pnpm -w run typecheck:libs

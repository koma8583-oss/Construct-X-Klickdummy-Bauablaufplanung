#!/bin/bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

database_admin_url="${DATABASE_ADMIN_URL:-${DATABASE_URL:-${AG_DATABASE_URL:-}}}"
if [[ -z "$database_admin_url" ]]; then
  echo "DATABASE_ADMIN_URL, DATABASE_URL or AG_DATABASE_URL is required for schema initialization" >&2
  exit 1
fi

apply_migration() {
  local schema_name="$1"
  local migration_file="$2"
  PGOPTIONS="-c search_path=${schema_name},public,pg_catalog" \
    psql "$database_admin_url" -v ON_ERROR_STOP=1 -f "$migration_file"
}

# The same setup supports both fresh CI/development databases and upgrades.
# First create the shared schemas/roles. On a fresh database the role schemas
# are still empty afterwards, so Drizzle creates only the tables owned by each
# role-specific schema. Existing shared or legacy-public installations keep
# their data and skip schema creation when tables already exist.
echo "Applying shared PostgreSQL role and schema boundaries"
psql "$database_admin_url" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/0025_shared_database_roles.sql

role_schema_is_empty() {
  local schema_name="$1"
  [[ "$(psql "$database_admin_url" -Atqc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${schema_name}' AND table_type = 'BASE TABLE'")" == "0" ]]
}

if role_schema_is_empty ag; then
  echo "Bootstrapping fresh AG schema"
  DATABASE_URL="$database_admin_url" DB_ROLE=ag pnpm --filter @workspace/db run push-force
fi
if role_schema_is_empty an; then
  echo "Bootstrapping fresh AN schema"
  DATABASE_URL="$database_admin_url" DB_ROLE=an pnpm --filter @workspace/db run push-force
fi
if role_schema_is_empty hub; then
  echo "Bootstrapping fresh Hub schema"
  DATABASE_URL="$database_admin_url" DB_ROLE=hub pnpm --filter @workspace/db run push-force
fi

for migration in \
  0001_leistungen_canonical_rename.sql \
  0002_project_memberships.sql \
  0004_project_membership_data_publication_link.sql \
  0023_construct_x_coordination_policies.sql; do
  apply_migration ag "lib/db/migrations/$migration"
done

for migration in \
  0003_an_project_invitations.sql \
  0016_an_project_invitation_offer_snapshot.sql \
  0005_an_leistungsanfragen.sql \
  0007_an_leistungsantworten.sql \
  0024_an_policy_consent.sql; do
  apply_migration an "lib/db/migrations/$migration"
done

for migration in \
  0006_dataspace_exchange_payload_hash.sql \
  0017_message_delivery_attempts.sql \
  0022_dataspace_access_grants.sql; do
  apply_migration hub "lib/db/migrations/$migration"
done

# Drizzle creates tables as the bootstrap owner. Reapplying the boundary
# migration repairs table/sequence ACLs and removes any non-owner table that a
# stale schema push left behind.
psql "$database_admin_url" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/0025_shared_database_roles.sql
psql "$database_admin_url" -v ON_ERROR_STOP=1 \
  -f lib/db/migrations/0026_atomic_hub_outbox.sql

PGOPTIONS="-c search_path=ag,pg_catalog" \
  psql "$database_admin_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('leistungsantworten') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'leistungsantworten'::regclass
         AND conname = 'leistungsantworten_response_payload_hash_unique'
     )
     AND NOT EXISTS (
       SELECT 1 FROM leistungsantworten
       WHERE response_payload_hash IS NOT NULL
       GROUP BY response_payload_hash HAVING COUNT(*) > 1
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
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'leistungsabhaengigkeiten'::regclass
         AND conname = 'leistungsabhaengigkeiten_predecessor_id_successor_id_unique'
     )
  THEN
    IF EXISTS (
      SELECT predecessor_id, successor_id
      FROM leistungsabhaengigkeiten
      GROUP BY predecessor_id, successor_id HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION
        'Cannot add leistungsabhaengigkeiten uniqueness: duplicate pairs exist';
    END IF;
    ALTER TABLE leistungsabhaengigkeiten
      ADD CONSTRAINT leistungsabhaengigkeiten_predecessor_id_successor_id_unique
      UNIQUE (predecessor_id, successor_id);
  END IF;
END $$;
SQL

psql "$database_admin_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  target_schema text;
  expected_table text;
  expected_tables text[];
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['ag', 'an', 'hub'] LOOP
    expected_tables := CASE target_schema
      WHEN 'ag' THEN ARRAY[
        'organizations', 'users', 'user_organizations',
        'projects', 'project_contractors', 'project_memberships',
        'coordination_policies', 'project_calendars',
        'leistungen', 'leistungsanfragen', 'leistungsanfrage_snapshots',
        'leistungsanfrage_audit_events', 'leistungsanfrage_reminders',
        'leistungsanfrage_resource_requirements',
        'leistungsantworten', 'leistungsantwort_alternativen',
        'leistungsantwort_entscheidungen', 'leistungsabhaengigkeiten',
        'leistungs_versionen', 'service_change_proposals',
        'service_constraints', 'service_dependencies',
        'service_readiness_checks', 'service_clarifications',
        'policy_templates', 'data_publications', 'data_publication_recipients',
        'delegations', 'delegation_responses'
      ]
      WHEN 'an' THEN ARRAY[
        'organizations', 'users', 'user_organizations',
        'resource_types', 'resources', 'resource_assignments',
        'resource_bookings', 'nu_local_projects', 'availability_checks',
        'an_project_invitations', 'an_leistungsanfragen',
        'an_leistungsanfrage_resource_requirements',
        'an_availability_checks', 'an_leistungsantworten',
        'an_leistungsantwort_alternativen'
      ]
      ELSE ARRAY[
        'organizations', 'users', 'user_organizations', 'refresh_tokens',
        'hub_messages', 'hub_admins', 'message_outbox', 'message_inbox',
        'message_delivery_attempts', 'dataspace_exchanges',
        'dataspace_access_grants', 'webhook_events', 'webhook_subscriptions'
      ]
    END;

    FOREACH expected_table IN ARRAY expected_tables LOOP
      IF to_regclass(format('%I.%I', target_schema, expected_table)) IS NULL THEN
        RAISE EXCEPTION 'Shared database bootstrap is incomplete: %.% is missing',
          target_schema, expected_table;
      END IF;
    END LOOP;
  END LOOP;
END $$;
SQL

-- TaktKoord shared PostgreSQL target architecture.
--
-- AG, AN and Hub intentionally use one physical database. The schemas and
-- NOLOGIN roles below are the security boundary. The bootstrap connection
-- (normally DATABASE_URL) must be allowed to create roles and grant them to
-- itself so the application can SET ROLE on each pool.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taktkoord_ag') THEN
    CREATE ROLE taktkoord_ag NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taktkoord_an') THEN
    CREATE ROLE taktkoord_an NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taktkoord_hub') THEN
    CREATE ROLE taktkoord_hub NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS ag;
CREATE SCHEMA IF NOT EXISTS an;
CREATE SCHEMA IF NOT EXISTS hub;

-- Preserve transport rows written into AG/AN by revisions that incorrectly
-- copied Hub-owned tables into every schema. Establish the canonical table
-- first when this is the first role-boundary run, then merge only columns that
-- exist on both copies so additive schema drift does not discard legacy data.
-- Parent/envelope tables precede delivery history and exchange metadata.
DO $$
DECLARE
  table_name text;
  source_schema text;
  template_schema text;
  common_columns text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'message_outbox',
    'message_inbox',
    'message_delivery_attempts',
    'dataspace_exchanges'
  ] LOOP
    IF to_regclass(format('hub.%I', table_name)) IS NULL THEN
      template_schema := NULL;
      FOREACH source_schema IN ARRAY ARRAY['public', 'ag', 'an'] LOOP
        IF to_regclass(format('%I.%I', source_schema, table_name)) IS NOT NULL THEN
          template_schema := source_schema;
          EXIT;
        END IF;
      END LOOP;

      IF template_schema IS NOT NULL THEN
        EXECUTE format(
          'CREATE TABLE hub.%I (LIKE %I.%I INCLUDING ALL)',
          table_name, template_schema, table_name
        );
      END IF;
    END IF;

    IF to_regclass(format('hub.%I', table_name)) IS NOT NULL THEN
      FOREACH source_schema IN ARRAY ARRAY['ag', 'an'] LOOP
        IF to_regclass(format('%I.%I', source_schema, table_name)) IS NOT NULL THEN
          SELECT string_agg(format('%I', target_column.attname), ', '
                            ORDER BY target_column.attnum)
          INTO common_columns
          FROM pg_attribute target_column
          JOIN pg_attribute source_column
            ON source_column.attrelid =
                 to_regclass(format('%I.%I', source_schema, table_name))
           AND source_column.attname = target_column.attname
           AND source_column.attnum > 0
           AND NOT source_column.attisdropped
          WHERE target_column.attrelid = to_regclass(format('hub.%I', table_name))
            AND target_column.attnum > 0
            AND NOT target_column.attisdropped
            AND target_column.attgenerated = ''
            AND target_column.attidentity = '';

          IF common_columns IS NOT NULL THEN
            -- Canonical Hub rows always win, including primary-key and other
            -- uniqueness conflicts. Reruns therefore remain idempotent.
            EXECUTE format(
              'INSERT INTO hub.%I (%s) SELECT %s FROM %I.%I ON CONFLICT DO NOTHING',
              table_name, common_columns, common_columns, source_schema, table_name
            );
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Enforce physical table ownership. Earlier revisions copied every public
-- application table into every role schema and relied on ACLs to hide the
-- duplicates. Besides wasting space, those copies allowed owner/bootstrap
-- sessions to accidentally read stale data from the wrong domain.
DO $$
DECLARE
  table_row record;
  table_name text;
  target_schema text;
  allowed_tables text[];
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['ag', 'an', 'hub'] LOOP
    allowed_tables := CASE target_schema
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

    FOR table_row IN
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = target_schema
        AND tablename NOT LIKE 'drizzle%'
        AND tablename NOT LIKE '__drizzle%'
    LOOP
      IF NOT table_row.tablename = ANY(allowed_tables) THEN
        EXECUTE format('DROP TABLE %I.%I CASCADE', target_schema, table_row.tablename);
      END IF;
    END LOOP;

    -- A legacy single-schema installation may still have the only copy in
    -- public. Bootstrap only the declared owner table; never fan it out to all
    -- role schemas. Existing owner tables are authoritative and never merged
    -- with a potentially stale public copy.
    FOREACH table_name IN ARRAY allowed_tables LOOP
      IF to_regclass(format('%I.%I', target_schema, table_name)) IS NULL
         AND to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
        EXECUTE format(
          'CREATE TABLE %I.%I (LIKE public.%I INCLUDING ALL)',
          target_schema, table_name, table_name
        );
        EXECUTE format(
          'INSERT INTO %I.%I SELECT * FROM public.%I',
          target_schema, table_name, table_name
        );
      END IF;
    END LOOP;
  END LOOP;

END $$;

-- CREATE TABLE ... LIKE does not copy foreign keys. Reconstruct only those
-- public legacy constraints whose child and parent both belong to the same
-- canonical role schema. NOT VALID avoids blocking the repair on historical
-- orphan rows while still enforcing the constraint for every new write.
DO $$
DECLARE
  target_schema text;
  foreign_key record;
  constraint_definition text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['ag', 'an', 'hub'] LOOP
    FOR foreign_key IN
      SELECT
        constraint_row.conname,
        child.relname AS child_table,
        parent.relname AS parent_table,
        pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid = constraint_row.conrelid
      JOIN pg_namespace child_namespace
        ON child_namespace.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = constraint_row.confrelid
      JOIN pg_namespace parent_namespace
        ON parent_namespace.oid = parent.relnamespace
      WHERE constraint_row.contype = 'f'
        AND child_namespace.nspname = 'public'
        AND parent_namespace.nspname = 'public'
        AND NOT (
          target_schema = 'an'
          AND parent.relname IN ('organizations', 'users')
        )
        AND NOT (
          target_schema = 'hub'
          AND child.relname IN (
            'hub_messages', 'message_outbox', 'message_inbox',
            'dataspace_exchanges', 'dataspace_access_grants'
          )
          AND parent.relname IN ('organizations', 'users')
        )
        AND to_regclass(format('%I.%I', target_schema, child.relname)) IS NOT NULL
        AND to_regclass(format('%I.%I', target_schema, parent.relname)) IS NOT NULL
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint existing_constraint
        JOIN pg_class existing_child
          ON existing_child.oid = existing_constraint.conrelid
        JOIN pg_namespace existing_namespace
          ON existing_namespace.oid = existing_child.relnamespace
        WHERE existing_namespace.nspname = target_schema
          AND existing_child.relname = foreign_key.child_table
          AND existing_constraint.conname = foreign_key.conname
      ) THEN
        constraint_definition := regexp_replace(
          foreign_key.definition,
          'REFERENCES [^ (]+',
          format(
            'REFERENCES %I.%I',
            target_schema,
            foreign_key.parent_table
          )
        );
        EXECUTE format(
          'ALTER TABLE %I.%I ADD CONSTRAINT %I %s NOT VALID',
          target_schema,
          foreign_key.child_table,
          foreign_key.conname,
          constraint_definition
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Audit rows are historical records. Removing a local identity must retain
  -- the event while clearing its optional actor references.
  IF to_regclass('ag.leistungsanfrage_audit_events') IS NOT NULL THEN
    FOR foreign_key IN
      SELECT constraint_row.conname, child_column.attname AS child_column
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid = constraint_row.conrelid
      JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
      JOIN pg_attribute child_column
        ON child_column.attrelid = child.oid
       AND child_column.attnum = constraint_row.conkey[1]
      WHERE constraint_row.contype = 'f'
        AND child_namespace.nspname = 'ag'
        AND child.relname = 'leistungsanfrage_audit_events'
        AND child_column.attname IN ('actor_org_id', 'actor_user_id')
    LOOP
      EXECUTE format(
        'ALTER TABLE ag.leistungsanfrage_audit_events DROP CONSTRAINT %I',
        foreign_key.conname
      );
      EXECUTE format(
        'ALTER TABLE ag.leistungsanfrage_audit_events ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES ag.%I(id) ON DELETE SET NULL NOT VALID',
        foreign_key.conname,
        foreign_key.child_column,
        CASE foreign_key.child_column
          WHEN 'actor_org_id' THEN 'organizations'
          ELSE 'users'
        END
      );
    END LOOP;
  END IF;

  -- AN projections carry external organization/user identifiers. Preserve
  -- local aggregate FKs, but do not require those external identities to be
  -- duplicated into AN-owned identity tables.
  FOR foreign_key IN
    SELECT constraint_row.conname, child.relname AS child_table
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid
    WHERE constraint_row.contype = 'f'
      AND child_namespace.nspname = 'an'
      AND parent.relname IN ('organizations', 'users')
  LOOP
    EXECUTE format(
      'ALTER TABLE an.%I DROP CONSTRAINT %I',
      foreign_key.child_table,
      foreign_key.conname
    );
  END LOOP;

  -- Hub envelopes can name external Dataspace participants that deliberately
  -- have no local organizations projection. Transport identity is validated by
  -- the connector/application layer, so legacy Hub foreign keys must not turn
  -- external identifiers into local referential-integrity failures.
  FOR foreign_key IN
    SELECT
      constraint_row.conname,
      child.relname AS child_table
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_namespace child_namespace
      ON child_namespace.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid
    WHERE constraint_row.contype = 'f'
      AND child_namespace.nspname = 'hub'
      AND child.relname IN (
        'hub_messages', 'message_outbox', 'message_inbox',
        'dataspace_exchanges', 'dataspace_access_grants'
      )
      AND parent.relname IN ('organizations', 'users')
  LOOP
    EXECUTE format(
      'ALTER TABLE hub.%I DROP CONSTRAINT %I',
      foreign_key.child_table,
      foreign_key.conname
    );
  END LOOP;
END $$;

REVOKE ALL ON SCHEMA ag, an, hub FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA ag TO taktkoord_ag;
GRANT USAGE ON SCHEMA an TO taktkoord_an;
GRANT USAGE ON SCHEMA hub TO taktkoord_hub;

-- The bootstrap/session owner may SET ROLE into each NOLOGIN application role.
GRANT taktkoord_ag TO CURRENT_USER;
GRANT taktkoord_an TO CURRENT_USER;
GRANT taktkoord_hub TO CURRENT_USER;

-- Role-specific grants are repeated after schema push so these statements also
-- cover tables that did not exist when this bootstrap was first applied.
REVOKE ALL ON ALL TABLES IN SCHEMA ag, an, hub
  FROM taktkoord_ag, taktkoord_an, taktkoord_hub;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ag, an, hub
  FROM taktkoord_ag, taktkoord_an, taktkoord_hub;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
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
  ] LOOP
    IF to_regclass(format('ag.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('GRANT ALL ON TABLE ag.%I TO taktkoord_ag', table_name);
    END IF;
  END LOOP;
END $$;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ag TO taktkoord_ag;

-- AN owns local resources, availability and response projections. Transport
-- writes below are a narrow Hub outbox interface, not AN access to AG data.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'users', 'user_organizations', 'resources',
    'resource_types', 'resource_assignments', 'resource_bookings',
    'nu_local_projects',
    'availability_checks', 'an_availability_checks',
    'an_project_invitations', 'an_leistungsanfragen',
    'an_leistungsanfrage_resource_requirements', 'an_leistungsantworten',
    'an_leistungsantwort_alternativen'
  ] LOOP
    IF to_regclass(format('an.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('GRANT ALL ON TABLE an.%I TO taktkoord_an', table_name);
    END IF;
  END LOOP;
END $$;
GRANT ALL ON ALL SEQUENCES IN SCHEMA an TO taktkoord_an;

-- Hub owns authentication/control-plane records and transport metadata only.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'users', 'user_organizations', 'refresh_tokens',
    'hub_messages', 'hub_admins', 'message_outbox', 'message_inbox',
    'message_delivery_attempts', 'dataspace_exchanges',
    'dataspace_access_grants', 'webhook_events', 'webhook_subscriptions'
  ] LOOP
    IF to_regclass(format('hub.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('GRANT ALL ON TABLE hub.%I TO taktkoord_hub', table_name);
    END IF;
  END LOOP;
END $$;
GRANT ALL ON ALL SEQUENCES IN SCHEMA hub TO taktkoord_hub;

-- AG and AN never access Hub transport tables directly. Application code uses
-- the Hub facade, which runs with taktkoord_hub. Explicitly revoke both the
-- schema and table privileges so rerunning this migration repairs installations
-- created by the earlier broad-grant version.
REVOKE USAGE ON SCHEMA hub FROM taktkoord_ag, taktkoord_an;
REVOKE ALL ON ALL TABLES IN SCHEMA hub FROM taktkoord_ag, taktkoord_an;

ALTER DEFAULT PRIVILEGES IN SCHEMA ag REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ag REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA an REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA an REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA hub REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA hub REVOKE ALL ON SEQUENCES FROM PUBLIC;
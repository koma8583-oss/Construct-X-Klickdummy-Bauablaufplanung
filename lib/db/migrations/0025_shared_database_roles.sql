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

-- Preserve an existing single-schema development database during the
-- transition. New installations have no public application tables and simply
-- create the role schemas through Drizzle. Existing public tables are copied
-- into each logical area before the role-specific schema is used; ACLs below
-- prevent any role from reading another area's copy.
DO $$
DECLARE
  table_row record;
  target_schema text;
  transport_table text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['ag', 'an', 'hub'] LOOP
    FOR table_row IN
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE 'drizzle%'
        AND tablename NOT LIKE '__drizzle%'
    LOOP
      IF to_regclass(format('%I.%I', target_schema, table_row.tablename)) IS NULL THEN
        EXECUTE format(
          'CREATE TABLE %I.%I (LIKE public.%I INCLUDING ALL)',
          target_schema, table_row.tablename, table_row.tablename
        );
        EXECUTE format(
          'INSERT INTO %I.%I SELECT * FROM public.%I ON CONFLICT DO NOTHING',
          target_schema, table_row.tablename, table_row.tablename
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Outbox and inbox are Hub transport state, not AG/AN domain state. Move
  -- legacy copies before removing them so an upgrade does not lose retries.
  FOREACH target_schema IN ARRAY ARRAY['ag', 'an'] LOOP
    FOREACH transport_table IN ARRAY ARRAY[
      'message_outbox', 'message_inbox', 'message_delivery_attempts',
      'dataspace_exchanges'
    ] LOOP
      IF to_regclass(format('%I.%I', target_schema, transport_table)) IS NOT NULL
         AND to_regclass(format('hub.%I', transport_table)) IS NOT NULL THEN
        EXECUTE format(
          'INSERT INTO hub.%I SELECT * FROM %I.%I ON CONFLICT DO NOTHING',
          transport_table, target_schema, transport_table
        );
        EXECUTE format('DROP TABLE %I.%I', target_schema, transport_table);
      END IF;
    END LOOP;
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

GRANT ALL ON ALL TABLES IN SCHEMA ag TO taktkoord_ag;
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
-- AG planning, AN resource and coordination tables remain inaccessible even
-- though the migration shape contains their definitions for dependency safety.
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
GRANT USAGE ON SCHEMA hub TO taktkoord_ag, taktkoord_an;
GRANT ALL ON TABLE
  hub.message_outbox, hub.message_inbox, hub.message_delivery_attempts,
  hub.dataspace_exchanges
  TO taktkoord_ag, taktkoord_an;

ALTER DEFAULT PRIVILEGES IN SCHEMA ag REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ag REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA an REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA an REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA hub REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA hub REVOKE ALL ON SEQUENCES FROM PUBLIC;
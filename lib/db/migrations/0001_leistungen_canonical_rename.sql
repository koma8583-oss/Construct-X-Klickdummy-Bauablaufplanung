-- =============================================================================
-- Migration 0001: Establish canonical internal German identifiers (Task #196)
-- =============================================================================
-- Renames:
--   Tables:   takte → leistungen
--             takt_requests → leistungsanfragen
--             takt_request_snapshots → leistungsanfrage_snapshots
--             takt_request_resource_requirements → leistungsanfrage_resource_requirements
--             takt_request_audit_events → leistungsanfrage_audit_events
--             takt_request_reminders → leistungsanfrage_reminders
--             takt_responses → leistungsantworten
--             takt_response_alternatives → leistungsantwort_alternativen
--             takt_response_decisions → leistungsantwort_entscheidungen
--             takt_dependencies → leistungsabhaengigkeiten
--             takt_versions → leistungs_versionen
--   Columns:  takt_bezeichnung → leistungs_bezeichnung  (in leistungen)
--             takt_id          → leistung_id            (in leistungsanfragen, leistungs_versionen)
--             takt_version     → leistung_version       (in leistungsanfragen)
--             takt_request_id  → leistungsanfrage_id    (in leistungsanfrage_snapshots,
--                                                         leistungsantworten,
--                                                         leistungsanfrage_resource_requirements,
--                                                         leistungsanfrage_reminders,
--                                                         leistungsantwort_entscheidungen)
--
-- Safety guarantees:
--   - Every operation is guarded by an EXISTS check against pg_catalog so the
--     script is fully idempotent (safe to re-run after a partial failure).
--   - No data is copied or dropped.
--   - All operations run inside a single transaction.
--   - Enum type names are brought into the Leistung vocabulary; their labels
--     are preserved unchanged so persisted business and transport statuses stay
--     backward-compatible.
--   - Indexes and constraints are renamed in place (no recreation).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. RENAME TABLES
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takte' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takte RENAME TO leistungen;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_requests' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_requests RENAME TO leistungsanfragen;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_request_snapshots' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_request_snapshots RENAME TO leistungsanfrage_snapshots;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_request_resource_requirements' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_request_resource_requirements RENAME TO leistungsanfrage_resource_requirements;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_request_audit_events' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_request_audit_events RENAME TO leistungsanfrage_audit_events;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_request_reminders' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_request_reminders RENAME TO leistungsanfrage_reminders;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_responses' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_responses RENAME TO leistungsantworten;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_response_alternatives' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_response_alternatives RENAME TO leistungsantwort_alternativen;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_response_decisions' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_response_decisions RENAME TO leistungsantwort_entscheidungen;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_dependencies' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_dependencies RENAME TO leistungsabhaengigkeiten;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'takt_versions' AND n.nspname = current_schema())
  THEN
    ALTER TABLE takt_versions RENAME TO leistungs_versionen;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. RENAME COLUMNS
-- ---------------------------------------------------------------------------

-- leistungen.takt_bezeichnung → leistungs_bezeichnung
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungen'
               AND a.attname = 'takt_bezeichnung'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungen RENAME COLUMN takt_bezeichnung TO leistungs_bezeichnung;
  END IF;
END $$;

-- leistungsanfragen.takt_id → leistung_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungsanfragen'
               AND a.attname = 'takt_id'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungsanfragen RENAME COLUMN takt_id TO leistung_id;
  END IF;
END $$;

-- leistungsanfragen.takt_version → leistung_version
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungsanfragen'
               AND a.attname = 'takt_version'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungsanfragen RENAME COLUMN takt_version TO leistung_version;
  END IF;
END $$;

-- leistungsanfrage_snapshots.takt_request_id → leistungsanfrage_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungsanfrage_snapshots'
               AND a.attname = 'takt_request_id'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungsanfrage_snapshots RENAME COLUMN takt_request_id TO leistungsanfrage_id;
  END IF;
END $$;

-- leistungsantworten.takt_request_id → leistungsanfrage_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungsantworten'
               AND a.attname = 'takt_request_id'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungsantworten RENAME COLUMN takt_request_id TO leistungsanfrage_id;
  END IF;
END $$;

-- leistungsanfrage_resource_requirements.takt_request_id → leistungsanfrage_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungsanfrage_resource_requirements'
               AND a.attname = 'takt_request_id'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungsanfrage_resource_requirements RENAME COLUMN takt_request_id TO leistungsanfrage_id;
  END IF;
END $$;

-- leistungsanfrage_reminders.takt_request_id → leistungsanfrage_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungsanfrage_reminders'
               AND a.attname = 'takt_request_id'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungsanfrage_reminders RENAME COLUMN takt_request_id TO leistungsanfrage_id;
  END IF;
END $$;

-- leistungsantwort_entscheidungen.takt_request_id → leistungsanfrage_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungsantwort_entscheidungen'
               AND a.attname = 'takt_request_id'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungsantwort_entscheidungen RENAME COLUMN takt_request_id TO leistungsanfrage_id;
  END IF;
END $$;

-- leistungs_versionen.takt_id → leistung_id
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = 'leistungs_versionen'
               AND a.attname = 'takt_id'
               AND n.nspname = current_schema()
               AND a.attnum > 0)
  THEN
    ALTER TABLE leistungs_versionen RENAME COLUMN takt_id TO leistung_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. RENAME INDEXES
-- ---------------------------------------------------------------------------

-- takt_requests_* indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_takt_id_idx')
  THEN
    ALTER INDEX takt_requests_takt_id_idx RENAME TO leistungsanfragen_leistung_id_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_gu_org_id_idx')
  THEN
    ALTER INDEX takt_requests_gu_org_id_idx RENAME TO leistungsanfragen_gu_org_id_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_nu_org_id_idx')
  THEN
    ALTER INDEX takt_requests_nu_org_id_idx RENAME TO leistungsanfragen_nu_org_id_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_status_idx')
  THEN
    ALTER INDEX takt_requests_status_idx RENAME TO leistungsanfragen_status_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_response_required_by_idx')
  THEN
    ALTER INDEX takt_requests_response_required_by_idx RENAME TO leistungsanfragen_response_required_by_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_expires_at_idx')
  THEN
    ALTER INDEX takt_requests_expires_at_idx RENAME TO leistungsanfragen_expires_at_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_created_at_idx')
  THEN
    ALTER INDEX takt_requests_created_at_idx RENAME TO leistungsanfragen_created_at_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_nu_org_status_idx')
  THEN
    ALTER INDEX takt_requests_nu_org_status_idx RENAME TO leistungsanfragen_nu_org_status_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_gu_org_status_idx')
  THEN
    ALTER INDEX takt_requests_gu_org_status_idx RENAME TO leistungsanfragen_gu_org_status_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_takt_version_idx')
  THEN
    ALTER INDEX takt_requests_takt_version_idx RENAME TO leistungsanfragen_leistung_version_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_requests_status_expires_at_idx')
  THEN
    ALTER INDEX takt_requests_status_expires_at_idx RENAME TO leistungsanfragen_status_expires_at_idx;
  END IF;
END $$;

-- takt_response_alternatives indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_response_alternatives_response_id_idx')
  THEN
    ALTER INDEX takt_response_alternatives_response_id_idx RENAME TO leistungsantwort_alternativen_response_id_idx;
  END IF;
END $$;

-- takt_response_decisions indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_response_decisions_request_id_idx')
  THEN
    ALTER INDEX takt_response_decisions_request_id_idx RENAME TO leistungsantwort_entscheidungen_anfrage_id_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_response_decisions_gu_org_idx')
  THEN
    ALTER INDEX takt_response_decisions_gu_org_idx RENAME TO leistungsantwort_entscheidungen_gu_org_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_response_decisions_decision_type_idx')
  THEN
    ALTER INDEX takt_response_decisions_decision_type_idx RENAME TO leistungsantwort_entscheidungen_decision_type_idx;
  END IF;
END $$;

-- takt_audit_* indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_audit_request_id_idx')
  THEN
    ALTER INDEX takt_audit_request_id_idx RENAME TO leistungsanfrage_audit_request_id_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_audit_event_type_idx')
  THEN
    ALTER INDEX takt_audit_event_type_idx RENAME TO leistungsanfrage_audit_event_type_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_audit_occurred_at_idx')
  THEN
    ALTER INDEX takt_audit_occurred_at_idx RENAME TO leistungsanfrage_audit_occurred_at_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_audit_actor_org_id_idx')
  THEN
    ALTER INDEX takt_audit_actor_org_id_idx RENAME TO leistungsanfrage_audit_actor_org_id_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_audit_request_occurred_at_idx')
  THEN
    ALTER INDEX takt_audit_request_occurred_at_idx RENAME TO leistungsanfrage_audit_request_occurred_at_idx;
  END IF;
END $$;

-- takt_req_resource_reqs indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_req_resource_reqs_request_id_idx')
  THEN
    ALTER INDEX takt_req_resource_reqs_request_id_idx RENAME TO leistungsanfrage_resource_reqs_anfrage_id_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_req_resource_reqs_an_org_id_idx')
  THEN
    ALTER INDEX takt_req_resource_reqs_an_org_id_idx RENAME TO leistungsanfrage_resource_reqs_an_org_id_idx;
  END IF;
END $$;

-- reminders indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'reminders_takt_request_id_idx')
  THEN
    ALTER INDEX reminders_takt_request_id_idx RENAME TO leistungsanfrage_reminders_anfrage_id_idx;
  END IF;
END $$;

-- takt_versions indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_versions_takt_id_idx')
  THEN
    ALTER INDEX takt_versions_takt_id_idx RENAME TO leistungs_versionen_leistung_id_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_versions_source_type_idx')
  THEN
    ALTER INDEX takt_versions_source_type_idx RENAME TO leistungs_versionen_source_type_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = 'takt_versions_content_hash_idx')
  THEN
    ALTER INDEX takt_versions_content_hash_idx RENAME TO leistungs_versionen_content_hash_idx;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. RENAME CONSTRAINTS (unique constraints stored as indexes in pg_indexes)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
             JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
             WHERE c.conname = 'uq_takt_version'
               AND n.nspname = current_schema())
  THEN
    ALTER INDEX uq_takt_version RENAME TO uq_leistung_version;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
             JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
             WHERE c.conname = 'uq_takt_response_decision_idempotency'
               AND n.nspname = current_schema())
  THEN
    ALTER INDEX uq_takt_response_decision_idempotency RENAME TO uq_leistungsantwort_entscheidung_idempotency;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
             JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
             WHERE c.conname = 'uq_reminder_dedup'
               AND n.nspname = current_schema())
  THEN
    ALTER INDEX uq_reminder_dedup RENAME TO uq_leistungsanfrage_reminder_dedup;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. RENAME ENUM TYPES (labels deliberately remain unchanged)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_procurement_priority' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_procurement_priority RENAME TO leistung_procurement_priority; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_risk_classification' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_risk_classification RENAME TO leistung_risk_classification; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_lifecycle_status' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_lifecycle_status RENAME TO leistung_lifecycle_status; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_status' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_status RENAME TO leistung_status; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_dependency_type' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_dependency_type RENAME TO leistungsabhaengigkeit_type; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_request_status' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_request_status RENAME TO leistungsanfrage_status; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_audit_event_type' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_audit_event_type RENAME TO leistungsanfrage_audit_event_type; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_audit_actor_role' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_audit_actor_role RENAME TO leistungsanfrage_audit_actor_role; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_decision' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_decision RENAME TO leistungsantwort_decision; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_response_reason_code' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_response_reason_code RENAME TO leistungsantwort_reason_code; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_coordination_decision_type' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_coordination_decision_type RENAME TO leistungsantwort_entscheidung_type; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'takt_version_source_type' AND n.nspname = current_schema())
  THEN ALTER TYPE takt_version_source_type RENAME TO leistungs_version_source_type; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. RENAME AUTO-GENERATED CONSTRAINT AND INDEX NAMES
-- ---------------------------------------------------------------------------
-- PostgreSQL keeps generated primary-key and foreign-key names when a table is
-- renamed. This final pass removes the legacy term without changing the
-- underlying definitions. A short hash keeps names under PostgreSQL's 63-byte
-- identifier limit while remaining deterministic and re-runnable.

DO $$
DECLARE
  item record;
  target_name text;
BEGIN
  FOR item IN
    SELECT n.nspname AS schema_name, tbl.relname AS table_name, con.conname
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = current_schema()
      AND con.conname ILIKE '%takt%'
  LOOP
    target_name := replace(
      replace(
        replace(
          replace(
            replace(
              replace(item.conname, 'takt_requests', 'leistungsanfragen'),
              'takt_request', 'leistungsanfrage'),
            'takt_responses', 'leistungsantworten'),
          'takt_response', 'leistungsantwort'),
        'takt_versions', 'leistungs_versionen'),
      'takt', 'leistung');
    IF length(target_name) > 63 THEN
      target_name := left(target_name, 54) || '_' || left(md5(item.conname), 8);
    END IF;
    IF target_name <> item.conname
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint existing
         JOIN pg_class existing_tbl ON existing_tbl.oid = existing.conrelid
         JOIN pg_namespace existing_ns ON existing_ns.oid = existing_tbl.relnamespace
         WHERE existing_ns.nspname = item.schema_name
           AND existing.conname = target_name
       )
    THEN
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
        item.schema_name, item.table_name, item.conname, target_name
      );
    END IF;
  END LOOP;

  FOR item IN
    SELECT n.nspname AS schema_name, idx.relname AS index_name
    FROM pg_class idx
    JOIN pg_namespace n ON n.oid = idx.relnamespace
    WHERE n.nspname = current_schema()
      AND idx.relkind = 'i'
      AND idx.relname ILIKE '%takt%'
  LOOP
    target_name := replace(
      replace(
        replace(
          replace(
            replace(
              replace(item.index_name, 'takt_requests', 'leistungsanfragen'),
              'takt_request', 'leistungsanfrage'),
            'takt_responses', 'leistungsantworten'),
          'takt_response', 'leistungsantwort'),
        'takt_versions', 'leistungs_versionen'),
      'takt', 'leistung');
    IF length(target_name) > 63 THEN
      target_name := left(target_name, 54) || '_' || left(md5(item.index_name), 8);
    END IF;
    IF target_name <> item.index_name
       AND NOT EXISTS (
         SELECT 1 FROM pg_class existing
         JOIN pg_namespace existing_ns ON existing_ns.oid = existing.relnamespace
         WHERE existing_ns.nspname = item.schema_name
           AND existing.relname = target_name
       )
    THEN
      EXECUTE format(
        'ALTER INDEX %I.%I RENAME TO %I',
        item.schema_name, item.index_name, target_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

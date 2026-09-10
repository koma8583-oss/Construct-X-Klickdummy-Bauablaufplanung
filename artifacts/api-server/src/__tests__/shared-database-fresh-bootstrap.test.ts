import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hasDatabase = Boolean(
  process.env.DATABASE_ADMIN_URL
    ?? process.env.DATABASE_URL
    ?? process.env.AG_DATABASE_URL,
);
const bootstrapSuite = hasDatabase ? describe : describe.skip;
const rootDir = fileURLToPath(new URL("../../../..", import.meta.url));
const adminUrl = process.env.DATABASE_ADMIN_URL
  ?? process.env.DATABASE_URL
  ?? process.env.AG_DATABASE_URL
  ?? "";

function databaseUrl(databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function psql(url: string, statement: string): string {
  return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-Atqc", statement], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

const expectedTables = [
  ["ag", "organizations"], ["ag", "users"], ["ag", "user_organizations"],
  ["ag", "projects"], ["ag", "project_contractors"], ["ag", "project_memberships"],
  ["ag", "coordination_policies"], ["ag", "project_calendars"], ["ag", "leistungen"],
  ["ag", "leistungsanfragen"], ["ag", "leistungsanfrage_snapshots"],
  ["ag", "leistungsanfrage_audit_events"], ["ag", "leistungsanfrage_reminders"],
  ["ag", "leistungsanfrage_resource_requirements"], ["ag", "leistungsantworten"],
  ["ag", "leistungsantwort_alternativen"], ["ag", "leistungsantwort_entscheidungen"],
  ["ag", "leistungsabhaengigkeiten"], ["ag", "leistungs_versionen"],
  ["ag", "service_change_proposals"], ["ag", "service_constraints"],
  ["ag", "service_dependencies"], ["ag", "service_readiness_checks"],
  ["ag", "service_clarifications"], ["ag", "policy_templates"],
  ["ag", "data_publications"], ["ag", "data_publication_recipients"],
  ["ag", "delegations"], ["ag", "delegation_responses"],
  ["an", "organizations"], ["an", "users"], ["an", "user_organizations"],
  ["an", "resource_types"], ["an", "resources"], ["an", "resource_assignments"],
  ["an", "resource_bookings"], ["an", "nu_local_projects"],
  ["an", "availability_checks"], ["an", "an_project_invitations"],
  ["an", "an_leistungsanfragen"], ["an", "an_leistungsanfrage_resource_requirements"],
  ["an", "an_availability_checks"], ["an", "an_leistungsantworten"],
  ["an", "an_leistungsantwort_alternativen"],
  ["hub", "organizations"], ["hub", "users"], ["hub", "user_organizations"],
  ["hub", "refresh_tokens"], ["hub", "hub_messages"], ["hub", "hub_admins"],
  ["hub", "message_outbox"], ["hub", "message_inbox"],
  ["hub", "message_delivery_attempts"], ["hub", "dataspace_exchanges"],
  ["hub", "dataspace_access_grants"], ["hub", "webhook_events"],
  ["hub", "webhook_subscriptions"],
] as const;

bootstrapSuite("fresh shared database bootstrap", () => {
  it("runs the complete fresh bootstrap and verifies role-owned tables and resource_mix", () => {
    const databaseName = `taktkoord_fresh_${process.pid}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const freshUrl = databaseUrl(databaseName);
    const escapedDatabaseName = databaseName.replace(/"/g, "\"\"");

    try {
      execFileSync("psql", [
        adminUrl,
        "-v", "ON_ERROR_STOP=1",
        "-c", `CREATE DATABASE "${escapedDatabaseName}"`,
      ], { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });

      execFileSync("bash", ["scripts/setup-shared-database.sh"], {
        cwd: rootDir,
        env: {
          ...process.env,
          DATABASE_ADMIN_URL: freshUrl,
          DATABASE_URL: freshUrl,
          AG_DATABASE_URL: freshUrl,
        },
        stdio: "pipe",
        timeout: 180_000,
      });

      const expectedValues = expectedTables
        .map(([schema, table]) => `('${schema}', '${table}')`)
        .join(", ");
      const missingTables = psql(freshUrl, `
        WITH expected(schema_name, table_name) AS (VALUES ${expectedValues})
        SELECT schema_name || '.' || table_name
        FROM expected
        WHERE to_regclass(format('%I.%I', schema_name, table_name)) IS NULL
        ORDER BY 1
      `);
      expect(missingTables).toBe("");

      expect(psql(freshUrl, `
        SELECT count(*)::int
        FROM information_schema.columns
        WHERE (table_schema, table_name, column_name) IN (
          ('ag', 'leistungsantwort_alternativen', 'resource_mix'),
          ('an', 'an_leistungsantwort_alternativen', 'resource_mix')
        )
      `)).toBe("2");

      expect(psql(freshUrl, `
        SELECT count(*)::int
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('organizations', 'users')
      `)).toBe("0");
    } finally {
      execFileSync("psql", [
        adminUrl,
        "-v", "ON_ERROR_STOP=1",
        "-c", `DROP DATABASE IF EXISTS "${escapedDatabaseName}" WITH (FORCE)`,
      ], { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    }
  }, 240_000);
});
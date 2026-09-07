import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { hubDb } from "@workspace/db";

const hasDatabase = Boolean(
  process.env.DATABASE_ADMIN_URL
    ?? process.env.DATABASE_URL
    ?? process.env.AG_DATABASE_URL,
);
const upgradeSuite = hasDatabase ? describe : describe.skip;
const rootDir = fileURLToPath(new URL("../../../..", import.meta.url));
const adminUrl = process.env.DATABASE_ADMIN_URL
  ?? process.env.DATABASE_URL
  ?? process.env.AG_DATABASE_URL
  ?? "";
const prefix = "legacy-transport-upgrade-394";

function psql(statement: string) {
  execFileSync("psql", [adminUrl, "-v", "ON_ERROR_STOP=1"], {
    cwd: rootDir,
    input: statement,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function cleanup() {
  if (!adminUrl) return;
  psql(`
    DROP TABLE IF EXISTS ag.message_delivery_attempts CASCADE;
    DROP TABLE IF EXISTS ag.message_outbox CASCADE;
    DROP TABLE IF EXISTS an.dataspace_exchanges CASCADE;
    DROP TABLE IF EXISTS an.message_inbox CASCADE;
    DELETE FROM hub.message_delivery_attempts WHERE id LIKE '${prefix}-%';
    DELETE FROM hub.message_inbox WHERE id LIKE '${prefix}-%';
    DELETE FROM hub.dataspace_exchanges WHERE id LIKE '${prefix}-%';
    DELETE FROM hub.message_outbox WHERE id LIKE '${prefix}-%';
  `);
}

upgradeSuite("legacy AG/AN transport table upgrade", () => {
  afterAll(() => {
    cleanup();
  });

  it("merges legacy-only transport rows into Hub before removing copies", async () => {
    cleanup();
    psql(`
      INSERT INTO hub.message_outbox
        (id, message_id, schema_version, message_type, sender_org_id,
         recipient_org_id, correlation_id, payload, status)
      VALUES
        ('${prefix}-outbox', '${prefix}-outbox-message', '1.0',
         'TAKT_REQUEST_NOTIFICATION', '${prefix}-sender', '${prefix}-recipient',
         '${prefix}-correlation', '{"source":"ag"}', 'PENDING'),
        ('${prefix}-conflict', '${prefix}-conflict-message', '1.0',
         'TAKT_REQUEST_NOTIFICATION', '${prefix}-sender', '${prefix}-recipient',
         '${prefix}-correlation', '{"source":"hub"}', 'PENDING');

      INSERT INTO hub.message_delivery_attempts
        (id, message_id, attempt_number, status)
      VALUES ('${prefix}-attempt', '${prefix}-outbox-message', 1, 'FAILED');

      INSERT INTO hub.message_inbox
        (id, message_id, recipient_org_id, sender_org_id, message_type,
         correlation_id, payload, status)
      VALUES
        ('${prefix}-inbox', '${prefix}-inbox-message', '${prefix}-recipient',
         '${prefix}-sender', 'TAKT_REQUEST_NOTIFICATION', '${prefix}-correlation',
         '{"source":"an"}', 'DELIVERED');

      INSERT INTO hub.dataspace_exchanges
        (id, direction, message_type, message_id, correlation_id, sender_org_id,
         receiver_org_id, business_object_id, business_object_version, status)
      VALUES
        ('${prefix}-exchange', 'INBOUND', 'SERVICE_REQUEST',
         '${prefix}-exchange-message', '${prefix}-correlation',
         '${prefix}-sender', '${prefix}-recipient', '${prefix}-business', 1,
         'RECEIVED');

      CREATE TABLE ag.message_outbox
        (LIKE hub.message_outbox INCLUDING ALL);
      CREATE TABLE ag.message_delivery_attempts
        (LIKE hub.message_delivery_attempts INCLUDING ALL);
      CREATE TABLE an.message_inbox
        (LIKE hub.message_inbox INCLUDING ALL);
      CREATE TABLE an.dataspace_exchanges
        (LIKE hub.dataspace_exchanges INCLUDING ALL);

      INSERT INTO ag.message_outbox
        SELECT * FROM hub.message_outbox WHERE id LIKE '${prefix}-%';
      INSERT INTO ag.message_delivery_attempts
        SELECT * FROM hub.message_delivery_attempts WHERE id = '${prefix}-attempt';
      INSERT INTO an.message_inbox
        SELECT * FROM hub.message_inbox WHERE id = '${prefix}-inbox';
      INSERT INTO an.dataspace_exchanges
        SELECT * FROM hub.dataspace_exchanges WHERE id = '${prefix}-exchange';

      UPDATE ag.message_outbox SET payload = '{"source":"ag-conflict"}'
        WHERE id = '${prefix}-conflict';
      ALTER TABLE ag.message_outbox DROP COLUMN last_attempt_at;
      ALTER TABLE an.message_inbox ADD COLUMN legacy_only text;

      DELETE FROM hub.message_delivery_attempts WHERE id = '${prefix}-attempt';
      DELETE FROM hub.message_inbox WHERE id = '${prefix}-inbox';
      DELETE FROM hub.dataspace_exchanges WHERE id = '${prefix}-exchange';
      DELETE FROM hub.message_outbox WHERE id = '${prefix}-outbox';
    `);

    try {
      execFileSync("bash", ["scripts/setup-shared-database.sh"], {
        cwd: rootDir,
        env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
        stdio: "pipe",
        timeout: 120_000,
      });

      const result = await hubDb.execute(sql`
        SELECT
          (SELECT count(*)::int FROM hub.message_outbox
             WHERE id IN (${`${prefix}-outbox`}, ${`${prefix}-conflict`})) AS outbox_count,
          (SELECT payload->>'source' FROM hub.message_outbox
             WHERE id = ${`${prefix}-conflict`}) AS conflict_source,
          (SELECT count(*)::int FROM hub.message_inbox
             WHERE id = ${`${prefix}-inbox`}) AS inbox_count,
          (SELECT count(*)::int FROM hub.message_delivery_attempts
             WHERE id = ${`${prefix}-attempt`}) AS attempt_count,
          (SELECT count(*)::int FROM hub.dataspace_exchanges
             WHERE id = ${`${prefix}-exchange`}) AS exchange_count,
          EXISTS (SELECT 1 FROM pg_tables
            WHERE schemaname = 'ag' AND tablename = 'message_outbox') AS ag_outbox,
          EXISTS (SELECT 1 FROM pg_tables
            WHERE schemaname = 'ag' AND tablename = 'message_delivery_attempts') AS ag_attempts,
          EXISTS (SELECT 1 FROM pg_tables
            WHERE schemaname = 'an' AND tablename = 'message_inbox') AS an_inbox,
          EXISTS (SELECT 1 FROM pg_tables
             WHERE schemaname = 'an' AND tablename = 'dataspace_exchanges') AS an_exchanges,
           (SELECT count(*)::int
              FROM pg_constraint constraint_row
              JOIN pg_class child ON child.oid = constraint_row.conrelid
              JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
             WHERE constraint_row.contype = 'f'
               AND child_namespace.nspname = 'hub'
               AND child.relname IN (
                 'refresh_tokens', 'hub_admins',
                 'webhook_subscriptions', 'webhook_events'
               )
               AND constraint_row.confdeltype = 'c') AS hub_local_cascade_fks,
           (SELECT count(*)::int
              FROM pg_constraint constraint_row
              JOIN pg_class child ON child.oid = constraint_row.conrelid
              JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
              JOIN pg_class parent ON parent.oid = constraint_row.confrelid
             WHERE constraint_row.contype = 'f'
               AND child_namespace.nspname = 'hub'
               AND child.relname IN (
                 'hub_messages', 'message_outbox', 'message_inbox',
                 'dataspace_exchanges', 'dataspace_access_grants'
               )
               AND parent.relname IN ('organizations', 'users')) AS transport_identity_fks
      `);
      expect(result.rows[0]).toMatchObject({
        outbox_count: 2,
        conflict_source: "hub",
        inbox_count: 1,
        attempt_count: 1,
        exchange_count: 1,
        ag_outbox: false,
        ag_attempts: false,
        an_inbox: false,
        an_exchanges: false,
        hub_local_cascade_fks: 4,
        transport_identity_fks: 0,
      });
    } finally {
      cleanup();
    }
  });
});
import pg from "../../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js";

const connectionString = process.env.AG_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("AG_DATABASE_URL or DATABASE_URL is required for test cleanup");
}

// Cleanup is intentionally allowlisted. The test suite uses one shared
// logical database, so a broad "T<number>" match could remove a real
// development organization's data. Keep this list in sync with the fixture
// prefixes used by the API tests and preserve all canonical/shared rows.
const testFixtureNumbers = [
  "4", "24", "26", "32", "34", "35", "36", "37", "38", "42", "43",
  "44", "45", "47", "48", "49", "52", "54", "62", "63", "64", "65",
  "66", "68", "69", "72", "73", "76", "77", "78", "79", "80", "81",
  "82", "83", "84", "85", "90", "92", "104", "105", "112", "116",
  "120", "135", "177", "185", "212", "239", "240", "300",
].join("|");
const testFixtureNamePattern =
  `^(?:T(?:${testFixtureNumbers})(?:$|[- ])|ODRL-SC|Task 239)`;
const testFixtureIdOrEmailPattern =
  `^(?:t(?:${testFixtureNumbers})(?:$|[-_@])|odrl-sc|task[-_]?239)`;
const testMessageIdPattern =
  "^(?:"
  + "t(?:"
  + testFixtureNumbers
  + ")(?:[-_])"
  + "|project-invitation-t239-"
  + "|project-invitation-message-1$"
  + "|project-invitation-serialization-mutation$"
  + "|coordination-decision-message-1$"
  + "|an-local-inbound-message$"
  + "|message-(?:request|response|decision|invitation|invitation-response)$"
  + "|mock-msg-id$"
  + ")";

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("CREATE TEMP TABLE cleanup_ids (id text PRIMARY KEY) ON COMMIT DROP");
  await client.query(`
    INSERT INTO cleanup_ids (id)
    SELECT id::text FROM organizations
    WHERE name ~* '${testFixtureNamePattern}'
       OR id::text ~* '${testFixtureIdOrEmailPattern}'
    UNION
    SELECT id::text FROM projects
    WHERE name ~* '${testFixtureNamePattern}'
       OR id::text ~* '${testFixtureIdOrEmailPattern}'
    UNION
    SELECT id::text FROM users
    WHERE name ~* '${testFixtureNamePattern}'
       OR id::text ~* '${testFixtureIdOrEmailPattern}'
       OR email ~* '${testFixtureIdOrEmailPattern}'
  `);

  const { rows: foreignKeys } = await client.query(`
    SELECT
      child.relname AS child_table,
      child_col.attname AS child_column,
      parent_col.attname AS parent_column,
      pk_col.attname AS primary_key
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = child.relnamespace
    JOIN pg_attribute child_col
      ON child_col.attrelid = child.oid AND child_col.attnum = constraint_row.conkey[1]
    JOIN pg_attribute parent_col
      ON parent_col.attrelid = parent.oid AND parent_col.attnum = constraint_row.confkey[1]
    JOIN pg_index primary_index
      ON primary_index.indrelid = child.oid AND primary_index.indisprimary
    JOIN pg_attribute pk_col
      ON pk_col.attrelid = child.oid AND pk_col.attnum = primary_index.indkey[0]
    WHERE constraint_row.contype = 'f'
      AND namespace_row.nspname = 'public'
      AND array_length(constraint_row.conkey, 1) = 1
      AND array_length(primary_index.indkey, 1) = 1
  `);

  const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
  let idsAdded = true;
  let rounds = 0;
  while (idsAdded && rounds < 12) {
    idsAdded = false;
    rounds += 1;
    for (const foreignKey of foreignKeys) {
      const result = await client.query(
        `INSERT INTO cleanup_ids (id)
         SELECT child.${quote(foreignKey.primary_key)}::text
         FROM ${quote(foreignKey.child_table)} child
         WHERE child.${quote(foreignKey.child_column)}::text = ANY(
           ARRAY(SELECT id FROM cleanup_ids)
         )
         ON CONFLICT DO NOTHING`,
      );
      idsAdded ||= result.rowCount > 0;
    }
  }

  // Delivery attempts are append-only and intentionally have no foreign key
  // to message_outbox: the outbox row may be removed while its history is
  // retained in production. Test cleanup must nevertheless remove attempts
  // for test messages, or a rerun can collide on (message_id, attempt_number).
  const { rows: deliveryAttemptTable } = await client.query(
    "SELECT to_regclass('public.message_delivery_attempts') AS table_name",
  );
  if (deliveryAttemptTable[0]?.table_name) {
    await client.query(`
      DELETE FROM message_delivery_attempts attempts
      WHERE attempts.message_id ~* '${testMessageIdPattern}'
         OR attempts.message_id IN (
           SELECT outbox.message_id
           FROM message_outbox outbox
           WHERE outbox.sender_org_id::text = ANY(ARRAY(SELECT id FROM cleanup_ids))
              OR outbox.recipient_org_id::text = ANY(ARRAY(SELECT id FROM cleanup_ids))
         )
    `);
  }

  // All matching rows are now identified. Disable FK enforcement only inside
  // this transaction, then remove exactly those rows and commit atomically.
  await client.query("SET LOCAL session_replication_role = replica");
  let deleted = 0;
  for (const foreignKey of foreignKeys) {
    const result = await client.query(
      `DELETE FROM ${quote(foreignKey.child_table)}
       WHERE ${quote(foreignKey.child_column)}::text = ANY(ARRAY(SELECT id FROM cleanup_ids))`,
    );
    deleted += result.rowCount;
  }
  const { rows: primaryTables } = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.key_column_usage
    WHERE constraint_schema = 'public'
      AND constraint_name IN (
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'public' AND constraint_type = 'PRIMARY KEY'
      )
  `);
  for (const table of primaryTables) {
    const result = await client.query(
      `DELETE FROM ${quote(table.table_name)}
       WHERE ${quote(table.column_name)}::text = ANY(ARRAY(SELECT id FROM cleanup_ids))`,
    );
    deleted += result.rowCount;
  }
  await client.query("COMMIT");
  console.log(`Removed ${deleted} stale test rows.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
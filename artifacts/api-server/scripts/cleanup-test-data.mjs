import pg from "../../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js";

const connectionString = process.env.AG_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("AG_DATABASE_URL or DATABASE_URL is required for test cleanup");
}
const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("CREATE TEMP TABLE cleanup_ids (id text PRIMARY KEY) ON COMMIT DROP");
  await client.query(`
    INSERT INTO cleanup_ids (id)
    SELECT id::text FROM organizations
    WHERE name ~* '^(T[0-9]+|ODRL-SC|Task 239)'
    UNION
    SELECT id::text FROM projects
    WHERE name ~* '^(T[0-9]+|ODRL-SC|Task 239)'
    UNION
    SELECT id::text FROM users
    WHERE name ~* '^(T[0-9]+|ODRL-SC|Task 239)'
       OR email ~* '(t[0-9]+|odrl-sc|task239).*(@test\\.|@test$)'
    UNION
    SELECT id::text FROM policy_templates
    WHERE code <> 'SCHEDULE_COORDINATION'
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
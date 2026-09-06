/**
 * Complete physical table shape used by the shared-database migration tool.
 *
 * Each invocation of Drizzle is pointed at a different role schema. The
 * runtime clients use the role-specific schema compositions and PostgreSQL
 * ACLs decide which tables each effective role can actually access.
 *
 * Keeping the migration shape complete avoids missing transitive foreign-key
 * declarations while creating isolated schemas. It does not grant cross-role
 * access; the bootstrap allowlist is the security boundary.
 */
export * from "./index";
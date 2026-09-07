---
name: Physical database boundaries
description: Durable rules for maintaining one PostgreSQL database with isolated AG, AN, and Hub schemas
---

AG, AN, and Hub must use one PostgreSQL database with separate `ag`, `an`, and
`hub` schemas and least-privilege NOLOGIN roles. The application must fail
closed when the role sessions do not resolve to the same database, effective
role, schema, or schema usage. Cross-domain business data must travel through
the Dataspace exchange; the Hub may retain transport metadata, not full domain
records.

**Why:** A shared physical database is the deployment constraint, so logical
schema and ACL boundaries must replace database-level separation without
allowing route-level organisation checks to become the only privacy control.

**How to apply:** Use named role handles, `SET ROLE`, and role-specific
`search_path` values. Role-specific URLs are allowed only when they resolve to
the same physical database. Never add SQL joins/transactions between AG and AN
schemas; treat cross-domain workflows as idempotent message projections/sagas.

The shared-boundary test suite runs with one `DATABASE_URL` (or three URLs that
resolve to the same database). It verifies identical database identity,
effective role/schema, and denied cross-schema access.

**Why:** Testing the actual ACL boundary catches accidental cross-domain reads
while preserving the single-database deployment model.

**How to apply:** Keep the normal test path on the shared `DATABASE_URL`; never
reintroduce an opt-in shared-database flag or a requirement for three physical
databases.

Bilateral coordination endpoints are a deliberate exception to the canonical
AG planning-path guard: proposal history and actions are public coordination
data owned by the AG-side coordination service, while ordinary Leistungsanfrage
planning paths must remain AG-only and AN users must use local projections.

**Why:** Coordination needs both parties to exercise proposal/counter/decision
authorization against the shared AG-owned coordination record without exposing
private AN planning data.

**How to apply:** When tightening the canonical route guard, keep only
`coordination` and `change-proposals` paths in this exception; do not broaden it
to general requests, Leistung data, or dependencies.

Transport ownership must be enforced twice: role-specific Drizzle schema compositions must omit Hub transport tables from AG/AN, and PostgreSQL ACLs must deny direct `hub.*` access to those roles. Re-running the boundary migration must repair grants from older installations.

**Why:** Removing imports alone does not protect an already-migrated database, while ACL-only protection still lets future schema pushes recreate unauthorized tables.

**How to apply:** Keep `schema/ag.ts` and `schema/an.ts` transport-free, keep transport access behind the Hub facade, and add direct cross-role SQL denial assertions to the shared-boundary suite.

Boundary migrations must recover legacy transport rows into Hub before dropping obsolete AG/AN copies. Copy in dependency order using shared columns, preserve canonical Hub rows on conflicts, and only then enforce the owner allowlists.

**Why:** Older shared-schema deployments can contain pending deliveries or idempotency history exclusively in a now-foreign role schema; dropping those copies first silently loses transport state.

**How to apply:** Any migration that removes a role-owned table must include an upgrade fixture with source-only rows and conflicts, proving canonical ownership retains all recoverable data across repeated bootstrap runs.

Hub transport participant IDs are external and must not reference the local identity directory, but Hub-internal ownership links are different: refresh tokens, Hub admins, webhook subscriptions, and webhook events retain their local cascade FKs.

**Why:** Treating every Hub FK as an external-identity constraint removes cleanup and integrity guarantees for authentication and webhook records.

**How to apply:** Filter FK removal by both child-table purpose and identity parent; regression checks must assert transport identity FKs are absent while Hub-local cascade FKs remain.
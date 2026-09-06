---
name: Shared post-merge schema order
description: Ordering rules for initializing and migrating the shared AG, AN, and Hub PostgreSQL schemas
---

Fresh shared-database targets must create the complete role-local schema with
Drizzle before running the raw domain migrations. Existing schemas skip that
push and run the same migrations idempotently. Raw migrations use the
role-local schema first and `public` only as a compatibility lookup for
historical enum types.

**Why:** Some legacy migrations alter Dataspace enums that were historically
created in `public`; running them before schema creation or with only the
logical schema in `search_path` makes post-merge setup fail on fresh or
partially migrated targets.

**How to apply:** Keep `scripts/post-merge.sh` non-interactive and ordered as
shared bootstrap → push empty schemas → role migrations → ACL reapply →
typecheck. Do not solve missing enum visibility by granting AG/AN access to
other domain tables.
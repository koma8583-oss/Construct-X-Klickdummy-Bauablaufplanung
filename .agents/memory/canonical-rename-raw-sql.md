---
name: Canonical schema rename and raw SQL
description: Direct SQL bypasses Drizzle adapters and must be migrated with canonical database names.
---

When renaming a physical database domain while keeping TypeScript legacy adapters, update every direct SQL query, test fixture, cleanup statement, and aggregate query to the canonical table and column names.

**Why:** Drizzle adapters preserve legacy property names only for ORM calls. Raw SQL still addresses PostgreSQL relations directly and otherwise fails at runtime after `ALTER TABLE ... RENAME`.

**How to apply:** After a schema rename, scan production code and tests for SQL `FROM`, `JOIN`, `INSERT`, `UPDATE`, and `DELETE` references to former relation names. Keep legacy HTTP routes and transport fields at their compatibility boundary rather than restoring obsolete physical tables.
---
name: Non-interactive database setup
description: Safe database setup rules for post-merge runs when Drizzle detects data-loss prompts.
---

When post-merge setup runs with stdin closed, do not rely on `drizzle-kit push` for schema changes that Drizzle classifies as potentially destructive. Apply idempotent, non-destructive SQL with `psql` instead, and only add a unique constraint after checking for duplicate values.

**Why:** Drizzle can require a TTY confirmation even with `--force` when a populated table is involved, which makes automated post-merge setup fail or could encourage unsafe truncation.

**How to apply:** Keep post-merge scripts fail-fast and non-interactive. Guard table/constraint creation with catalog checks, preserve existing data, and run the workspace library rebuild after the SQL step.
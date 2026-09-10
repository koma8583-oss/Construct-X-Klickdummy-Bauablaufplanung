---
name: Migration role boundaries
description: Shared-database schema migrations and API-role backfills run under different PostgreSQL privileges.
---

Privileged DDL belongs in the shared database setup migration; service-level data backfills must remain executable by the normal role and use conditional updates for idempotence.

**Why:** The AG API role can update policy rows but cannot alter ownership of role-owned tables, so executing an additive `ALTER TABLE` from an API test or repair job fails.

**How to apply:** Keep schema changes in `scripts/setup-shared-database.sh` migrations, and test or repair the data transformation through the corresponding service under `agDb`.
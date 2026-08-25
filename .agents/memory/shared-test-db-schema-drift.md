---
name: Shared test database schema drift
description: The shared PostgreSQL test database can lag behind the Drizzle schema after additive project-membership changes.
---

When a test fails because project_memberships lacks data_publication_id, treat it as schema drift in the shared database rather than a product behavior failure.

**Why:** The current ORM model selects the additive column, while the existing physical table may not have received the migration; raw fixture SQL alone cannot fix ORM reads in routes and services.

**How to apply:** Keep test-only fixture SQL limited to physical columns when appropriate, but report or separately migrate the database before treating membership-route failures as code regressions.
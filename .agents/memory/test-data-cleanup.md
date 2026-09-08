---
name: Test data cleanup
description: Test policy and fixture cleanup must run after the complete Vitest process.
---

Test database cleanup belongs in a post-run process, not a Vitest `afterAll` in setup files. It must also explicitly remove append-only records whose parent fixture rows may already be gone.

**Why:** Vitest setup teardown runs once per worker; parallel workers can delete another worker's fixtures while its tests are still running. Delivery-attempt history has no parent-row foreign key, so deleting an outbox row alone leaves fixed message IDs unable to run again.

**How to apply:** Keep fixtures on the canonical seeded policy and run the narrowly allowlisted cleanup script after Vitest exits, preserving the original test exit status. Suite teardown must delete append-only history before deleting fixed outbox rows; central cleanup should cover both surviving outbox ownership and explicitly allowlisted fixed message IDs. For reliable whole-suite runs, also avoid concurrent files sharing mutable fixture identities.

Transport cleanup is Hub-only in the shared-schema layout; fixtures that resolve Dataspace participants may also need a Hub organization-directory row in addition to AG-owned organization data.

**Why:** AG/AN roles must not probe or mutate Hub transport copies, while participant discovery is intentionally sourced from the Hub directory.

**How to apply:** Point outbox/inbox/delivery/exchange cleanup at `hub`, and seed/clean the Hub directory explicitly in suites that exercise Dataspace participant resolution.

Central cleanup must also discover test rows through stable external-reference columns, not only primary keys. Historical rows created before FK repair can have random IDs and no surviving parent while still carrying a test-prefixed source request, message, or correlation ID.

**Why:** Orphaned idempotency rows can make a clean rerun look like a retry even after all visibly related fixtures were deleted.

**How to apply:** Seed cleanup traversal from narrowly allowlisted test patterns in both root IDs and semantic external-reference columns, then follow role-local FKs and delete in dependency order.
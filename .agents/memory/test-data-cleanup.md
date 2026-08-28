---
name: Test data cleanup
description: Test policy and fixture cleanup must run after the complete Vitest process.
---

Test database cleanup belongs in a post-run process, not a Vitest `afterAll` in setup files. It must also explicitly remove append-only records whose parent fixture rows may already be gone.

**Why:** Vitest setup teardown runs once per worker; parallel workers can delete another worker's fixtures while its tests are still running. Delivery-attempt history has no parent-row foreign key, so deleting an outbox row alone leaves fixed message IDs unable to run again.

**How to apply:** Keep fixtures on the canonical seeded policy and run the narrowly allowlisted cleanup script after Vitest exits, preserving the original test exit status. Suite teardown must delete append-only history before deleting fixed outbox rows; central cleanup should cover both surviving outbox ownership and explicitly allowlisted fixed message IDs. For reliable whole-suite runs, also avoid concurrent files sharing mutable fixture identities.
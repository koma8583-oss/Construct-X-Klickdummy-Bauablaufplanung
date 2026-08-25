---
name: Test data cleanup
description: Test policy and fixture cleanup must run after the complete Vitest process.
---

Test database cleanup belongs in a post-run process, not a Vitest `afterAll` in setup files.

**Why:** Vitest setup teardown runs once per worker; parallel workers can delete another worker's fixtures while its tests are still running.

**How to apply:** Keep fixtures on the canonical seeded policy and run the narrowly allowlisted cleanup script after Vitest exits, preserving the original test exit status.
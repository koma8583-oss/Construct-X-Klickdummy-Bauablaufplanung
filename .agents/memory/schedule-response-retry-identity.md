---
name: Schedule-response retry identity
description: Stable idempotency identity for AN responses to schedule-change children addressed through a root request URL.
---

AN response retries addressed through a root Leistungsanfrage URL must continue resolving to the same schedule-change child after the first response moves that child into a terminal state. Response identity is the external request ID plus version, not a mutable AN-local projection ID.

**Why:** If resolution falls back from the schedule child to the root after the first acceptance, an identical retry is treated as a new root response and returns 201 instead of the contractual idempotent 200.

**How to apply:** Any route that aliases a schedule-child response through a root request ID must keep terminal responded/confirmed children in its retry resolution and preserve payload-hash conflict checks on the external request/version key.
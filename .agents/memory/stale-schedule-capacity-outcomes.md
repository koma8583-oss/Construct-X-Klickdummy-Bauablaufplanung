---
name: Stale schedule capacity outcomes
description: Public and retry-safe handling when an accepted schedule no longer fits AN capacity.
---

When AN rejects an accepted schedule after its final transactional capacity check, publish only the generic `NO_CAPACITY` outcome and a request for a new time window. Do not expose resource IDs, conflict assignments, or internal availability details. On AG, preserve the current agreement, record the proposal as rejected with the public reason, and keep replacement-window coordination possible.

**Why:** The AG can commit its side of an acceptance before AN performs the final booking replacement. Treating the resulting conflict as a transport failure hides a business decision and makes a planner retry an action that can never create the booking.

**How to apply:** Use a deterministic response identity so a failed delivery retry reuses the same outcome. Keep the booking transaction atomic; only create the rejection response after its rollback, and let the inbound exchange claim prevent duplicate processing.
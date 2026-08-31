---
name: AN-local projections
description: Boundary rule for AN performance-request data, responses, availability, and resource bookings.
---

AN-facing Leistungsanfrage data must resolve from the immutable `an_leistungsanfragen` projection by external request ID, never from AG request, takt, project, or snapshot tables. Availability history is likewise attached to the local projection and evaluates only local resource requirements, AN resources, and AN bookings.

**Why:** Sharing a PoC database must not allow an AN URL or service path to bypass Dataspace delivery and inspect or mutate AG-owned planning state.

**How to apply:** Add AN-facing request endpoints only below `/api/an`; block AN tokens from the shared AG routers. Use external IDs solely as compatibility references and resolve them to the AN-local projection before reads, status transitions, responses, availability checks, or booking-source ownership checks.

AN-local list projections may intentionally omit AG-side coordination fields such as `scheduleDelta`; shared AN UI consumers must normalize optional coordination data before filtering or rendering.

**Why:** The AN projection is the data-sovereignty boundary, so it cannot be assumed to have every enriched AG list field even when a shared client type does.

**How to apply:** Treat absent coordination metadata as an explicit neutral state in AN inboxes and preserve the local projection shape instead of joining AG planning data just to satisfy the shared UI.
---
name: AN-local projections
description: Boundary rule for AN performance-request data, responses, availability, and resource bookings.
---

AN-facing Leistungsanfrage data must resolve from the immutable `an_leistungsanfragen` projection by external request ID, never from AG request, takt, project, or snapshot tables. Availability history is likewise attached to the local projection and evaluates only local resource requirements, AN resources, and AN bookings.

**Why:** Sharing a PoC database must not allow an AN URL or service path to bypass Dataspace delivery and inspect or mutate AG-owned planning state.

**How to apply:** Add AN-facing request endpoints only below `/api/an`; block AN tokens from the shared AG routers. Use external IDs solely as compatibility references and resolve them to the AN-local projection before reads, status transitions, responses, availability checks, or booking-source ownership checks.
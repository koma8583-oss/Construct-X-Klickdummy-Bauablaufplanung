---
name: Timeline and dependency authority
description: Durable rules for business timeline events, dependency sources, and coordination mutation semantics.
---

The initial agreement event is emitted only when a real initial acceptance decision timestamp exists. Accepted change proposals always produce change-proposal events and never replace or create the initial agreement event.

**Why:** Using proposal resolution or request creation as an agreement timestamp invents or rewrites business history.

**How to apply:** Keep all proposal, response, constraint, clarification, readiness, and decision events in one timeline builder, attach organization roles rather than internal user IDs, and sort once at the end.

Canonical project dependencies are Leistung-to-Leistung relations. Service-request dependency endpoints may remain as compatibility adapters, but they must translate request IDs to Leistung IDs and read/write the canonical relation.

**Why:** Change Impact, boards, planning, and legacy compatibility endpoints must not disagree about successor relationships.

**How to apply:** Resolve requests within the same project before dependency operations; count board impacts from canonical successor relations; never mutate successors automatically during an accepted schedule change.

Permission failures are 403, while a race against an already closed constraint or clarification is 409. Resolve is limited to the responsible organization; cancel is limited to the reporting/asking organization.

**Why:** Authorization and state concurrency are different failure classes and clients need to handle them differently.
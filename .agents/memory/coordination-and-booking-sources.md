---
name: Coordination and booking sources
description: Durable rules for objective coordination state and confirmed resource booking persistence.
---

Coordination state is an objective property of the request, not of the viewer. Detail views, boards, lists, and task cockpits must use the same priority-ordered state derivation and must not infer response or decision facts from request status alone.

**Why:** Role-specific UI should only decide whether the current party acts or waits; duplicating state derivation causes contradictory coordination surfaces.

**How to apply:** Load real latest responses and request-scoped decisions, derive action and owner centrally, and use `actionRequiredBy` for action-specific deadlines.

Confirmed resource bookings must be persisted from unaggregated booking requirement segments. Availability summaries such as `availableResources` are not a booking source because they can merge segments, hide utilization, or lose residual demand and concrete-resource multiplicity.

**Why:** Booking persistence needs to preserve requirement periods, qualifications, utilization, quantities, and concrete assignments exactly as evaluated.

**How to apply:** Reuse the central requirements-to-bookings helper for initial and changed acceptance; use an explicit fallback window only for legacy requirement records whose segment dates are absent.
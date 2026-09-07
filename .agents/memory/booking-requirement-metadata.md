---
name: Booking requirement metadata
description: Auto-created resource bookings must retain DTC requirement quantity, utilization, and shifted sub-periods.
---

The availability result is the source for auto-booking metadata: DTC entries carry the original required capacity, utilization percentage, and effective requirement dates. When an accepted window shifts, requirement sub-periods move by the same calendar-day offset and booking end timestamps remain exclusive of the inclusive end date.

**Why:** Rechecking an alternative against the original sub-period or booking only the outer Takt window produces reservations that do not match the actual requirement.

**How to apply:** Reuse the shared requirement-shifting helper for alternative generation and acceptance re-evaluation; never reconstruct DTC booking quantity as effective capacity or reset utilization to 100%.

For schedule-change acceptance, evaluate the projection's requirement periods on the proposed target window; only shift a copy backward when matching those requirements to bookings from the prior window.

**Why:** Schedule-change projections already carry sub-periods anchored to the proposed window. Evaluating a backward-shifted copy against the target dates makes overlapping demand invisible and can admit an over-capacity replacement.

**How to apply:** Keep separate `targetRequirements` and `oldRequirements` representations in the acceptance path. Use the former for peak-capacity feasibility and the latter only for concrete-assignment restoration.
---
name: DTC resource semantics
description: Durable rules for DTC-backed resource capacity, qualification, and booking behavior.
---

Type-level resource bookings represent capacity reservations, not a concrete resource assignment: resourceId stays null, resourceTypeId identifies the capacity pool, and quantity is positive. Concrete bookings consume capacity using resource capacity multiplied by utilizationPercent.

**Why:** Availability and auto-booking need the same accounting model, otherwise a feasible DTC check can create an invalid or misleading reservation.

**How to apply:** Treat booking periods as inclusive at the date boundary, apply requirement-specific periods when present, and keep DTC mappings explicit. MACHINE maps to normal equipment; OTHER must remain unmapped unless the user selects an explicit classification.
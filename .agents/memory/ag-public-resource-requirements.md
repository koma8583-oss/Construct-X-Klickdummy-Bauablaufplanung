---
name: AG public requirement boundary
description: The source of resource requirements allowed in AG outbound coordination messages
---

AG outbound SERVICE_REQUEST and SCHEDULE_CHANGE messages must derive resource requirements from the immutable public Takt/request snapshot. They must not resolve AN-owned resource types, concrete resources, availability, or bookings.

**Why:** AG and AN share physical schema objects in the current compatibility setup, so a convenient join can silently cross the ownership boundary and leak or couple AG behavior to AN-local catalog data.

**How to apply:** Use stable type-derived public contract fields and the relevant planned/proposed window when mapping snapshot requirements. Keep AN catalog resolution in inbound AN projection flows only.
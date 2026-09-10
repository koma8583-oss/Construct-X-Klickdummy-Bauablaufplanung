---
name: Inbound membership compatibility
description: Security and compatibility boundary for AN-local SERVICE_REQUEST delivery.
---

Reject an inbound SERVICE_REQUEST when a matching AN-local project invitation exists but is not accepted. Continue to allow legacy locally prepared flows where no AN invitation projection exists.

**Why:** Enforcing a hard missing-projection rejection broke established transport and legacy preparation flows. AG-originated request creation is already gated by active canonical membership, while a known pending or rejected AN invitation must never be bypassed.

**How to apply:** Preserve the accepted-status check whenever a matching AN invitation projection is present. Do not reinterpret a pending or rejected projection as an absent legacy projection.
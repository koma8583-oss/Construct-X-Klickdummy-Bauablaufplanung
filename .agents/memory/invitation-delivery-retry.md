---
name: Invitation delivery retry
description: Durable retry rules for outbound project invitation and invitation response messages.
---

## Rule
Project invitation delivery is separate from project membership state. Persist the outbound envelope before dispatch, and retry the failed outbox row using its stored message ID and payload.

**Why:** Membership and invitation decisions must remain idempotent even when a connector is unavailable or a delivery attempt is repeated.

**How to apply:** Scope operational retry actions to the sending AG, allow only FAILED invitation message types, and record each attempt's final DELIVERED or FAILED state with a bounded-exhaustion error.
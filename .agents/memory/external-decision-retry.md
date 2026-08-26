---
name: External Dataspace decision retry
description: Reliability boundary for externally delivered AG coordination decisions.
---

External AG coordination decisions must be persisted in the outbox before the connector call. A retry reuses the persisted public envelope and original message ID; it must not rebuild the payload from current domain state or invoke local inbound processing.

**Why:** Connector delivery can fail after the AG decision is committed. Recreating the message risks changed public facts, while local loopback would apply AN bookings in the wrong transport path. The AN inbound claim remains the idempotency boundary when the connector eventually delivers.

**How to apply:** Keep a dedicated retry operation on the Dataspace exchange abstraction. Use the saved outbox row for `messageType` and payload, allow retries only for `FAILED`, and leave AN-side application to the actual inbound delivery.
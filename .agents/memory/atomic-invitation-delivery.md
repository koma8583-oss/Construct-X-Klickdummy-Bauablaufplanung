---
name: Atomic invitation delivery
description: Constraint for domain changes that pre-create invitation messages transactionally.
---

When an invitation or invitation response writes its outbox row in the same transaction as the membership change, the transport's first delivery attempt may encounter a PENDING row that already exists. The retry path must accept PENDING as well as FAILED; otherwise the atomic outbox cannot be delivered.

**Why:** Idempotent transport normally treats an existing PENDING row as already claimed, but the domain transaction intentionally creates that row before the adapter runs.

**How to apply:** Keep the persisted envelope payload identical to the adapter payload and make the follow-up transport operation transition PENDING to SENT/DELIVERED without recreating the business row. For local Dataspace mode, a successful retry must also invoke the local inbound-domain handler; technical delivery alone does not create the AN-side projection.
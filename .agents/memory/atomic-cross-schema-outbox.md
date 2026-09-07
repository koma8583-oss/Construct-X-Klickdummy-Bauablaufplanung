---
name: Atomic cross-schema outbox
description: How domain transactions safely pre-create Hub transport envelopes in the shared PostgreSQL database.
---

AG and AN must pre-create Hub outbox envelopes through a narrowly scoped `SECURITY DEFINER` function executed on their existing domain transaction; they must never receive direct Hub table privileges.

**Why:** Separate AG/AN/Hub pools cannot make independent Drizzle transactions atomic. A post-commit outbox write can leave a committed business change with no durable retry envelope.

**How to apply:** Keep delivery post-commit and idempotent. The pre-created payload must exactly match the payload that the transport adapter would otherwise derive (especially service responses and coordination decisions), or idempotency correctly rejects the retry as tampered.
---
name: Optional JSON outbox fields
description: Keep optional object fields absent, not undefined, when comparing in-memory envelopes with JSONB outbox rows.
---

JSONB outbox payloads drop `undefined` keys, so transport idempotency comparisons must destructure optional fields before rebuilding payload objects rather than spreading them through.

**Why:** Stable envelope comparisons see an in-memory `undefined` property but not the same property after PostgreSQL JSONB serialization.

**How to apply:** When adding optional fields to an outbound payload, update both the transactional outbox projection and transport envelope projection with the same omission rule.
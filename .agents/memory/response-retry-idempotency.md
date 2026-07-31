---
name: Response retry idempotency
description: Why the NU response retry path must query the outbox directly instead of calling transport.send() again.
---

## Rule
On a retry (existing TaktResponse found with same decision), **do NOT call `transport.send()` again**.
Instead, query `messageOutboxTable` by `messageId` directly and return its `status`:

```typescript
const [existingOutbox] = await db
  .select()
  .from(messageOutboxTable)
  .where(eq(messageOutboxTable.messageId, msgId))
  .limit(1);

const transportStatus = existingOutbox?.status ?? "DELIVERED";
```

## Why
`LocalHubTransport.send()` performs an idempotency check: if the messageId already exists in the outbox, it calls `envelopeMatchesRow()` which compares `stableStringify(payload)` of the new envelope vs. the stored row.

The retry reconstructs the payload from DB data (e.g., `a.proposedStart.toISOString()` → `"2026-09-22T00:00:00.000Z"`), but the original payload stored date-only strings (`"2026-09-22"` from the alternative generator's `formatDate = toISOString().slice(0, 10)`). The strings differ → `envelopeMatchesRow` returns false → `InvalidEnvelopeError` is thrown → unhandled in the route → 500.

## How to apply
Any route that implements idempotent re-send via deterministic messageIds should look up the outbox row directly on retry, not rebuild and re-send the envelope. The message was already delivered on the first call; querying the outbox gives the accurate transport status without re-triggering delivery logic.

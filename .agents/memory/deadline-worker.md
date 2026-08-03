---
name: Deadline worker architecture
description: Key design rules for the deadline evaluation service and worker; transport/transaction constraints.
---

## Rule: transport.send() must be called AFTER the transaction commits

Calling `transport.send()` inside a `db.transaction(async (tx) => {...})` causes connection conflicts because `LocalHubTransport.send()` acquires its own connection from the pool and the outer transaction holds the original connection. Pattern:

```typescript
const committed = await db.transaction(async (tx) => {
  // all DB writes including outbox inserts
  return true;
});
if (committed) {
  await transport.send(...); // safe — outbox rows are now visible
}
```

**Why:** Drizzle node-postgres transactions hold one connection. Nested pool.connect() inside that tx can deadlock or see uncommitted rows.

**How to apply:** Any service that writes outbox rows and dispatches them in the same operation must split into two phases.

---

## Rule: MessageEnvelope.createdAt is `Date`, not `string`

```typescript
// WRONG
await transport.send({ ..., createdAt: now.toISOString(), ... });

// CORRECT
await transport.send({ ..., createdAt: now, ... });
```

**Why:** The `MessageEnvelope` interface (lib/api-zod generated) types `createdAt` as `Date`.

---

## Rule: inArray with typed enum columns needs a tuple cast

```typescript
// WRONG — type error
inArray(taktRequestsTable.status, [...STATUSES] as string[])

// CORRECT
inArray(taktRequestsTable.status, STATUSES as unknown as [TaktRequestStatus, ...TaktRequestStatus[]])
```

**Why:** Drizzle's `inArray` overload requires a non-empty tuple matching the column's type, not a plain string[].

---

## Evaluation service: key behaviours

- `UNDER_REVIEW` requests are intentionally NOT auto-expired — only get an overdue reminder.
- Reminder dedup key: `"<requestNumber>:<reminderType>:<YYYY-MM-DD UTC>"`
- `revertTaktIfNoOpenRequests()` uses `DbTx` type (not `typeof db`) to work inside transactions.
- PostgreSQL advisory lock key: `7272727272` ("deadline-worker").
- Worker timer is `unref()`'d so it doesn't keep the test process alive.

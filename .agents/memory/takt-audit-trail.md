---
name: TaktRequest audit trail — atomic first-access guarantee
description: Design decision for DETAILS_RETRIEVED deduplication under concurrency; audit service rules
---

## Atomic first-access transition (critical design rule)

`DETAILS_RETRIEVED` audit events must ONLY be written by the caller that wins the `DELIVERED → DETAILS_RETRIEVED` status transition. Use `transitionToDetailsRetrievedAtomic()` (takt-request-repository.ts), which issues a single conditional UPDATE:

```sql
UPDATE takt_requests
   SET status='DETAILS_RETRIEVED', details_retrieved_at=NOW()
 WHERE id=? AND status='DELIVERED'
RETURNING *
```

Non-null return = this caller won. Null return = another concurrent caller already transitioned it; skip audit write.

**Why:** `updateTaktRequestStatus()` is read-validate-update (non-atomic). Two concurrent callers can both read `DELIVERED`, both pass validation, both update, and both write the audit event. The conditional UPDATE collapses read+validate+write into one DB round-trip, making it atomic.

**How to apply:** Any route that transitions DELIVERED → DETAILS_RETRIEVED and wants to write a DETAILS_RETRIEVED audit event must use `transitionToDetailsRetrievedAtomic()`, not `updateTaktRequestStatus()`.

## Audit service rules

- `writeAuditEvent()` is fire-and-forget in production (catches and console.errors all DB failures).
- In `NODE_ENV=test` it rethrows so test failures are visible.
- GU preview accesses to `/details` do NOT write DETAILS_RETRIEVED — only NU first access does.
- Subsequent NU re-reads after first access do NOT write a second event.

## Not-yet-written event types

`AVAILABILITY_CHECK_DONE`, `REQUEST_EXPIRED`, `REQUEST_CANCELLED` are defined in the enum but no code writes them yet (follow-up task).

---
name: Sprint 7 deadline system
description: Architecture and pitfalls for the TaktRequest deadline/reminder system built in Sprint 7 (Tasks 7.1–7.8).
---

## Key decisions

### DeadlineConfig field names (NOT invented names)
```typescript
interface DeadlineConfig {
  workerEnabled: boolean;
  workerIntervalMinutes: number;
  firstReminderHoursBeforeDue: number;   // RESPONSE_DUE_SOON window
  secondReminderHoursBeforeDue: number;  // RESPONSE_DUE_TODAY window
  overdueReminderHoursAfterDue: number;  // RESPONSE_OVERDUE fires N hours after due
  expirationGracePeriodHours: number;
  guDecisionReminderHours: number;
  maxRemindersPerType: number;
}
```

### Two-phase evaluation
1. `REMINDER_ELIGIBLE` = `SENT | DELIVERED | DETAILS_RETRIEVED | UNDER_REVIEW` — NU response reminders
2. `GU_DECISION_ELIGIBLE` = `ACCEPTED | ALTERNATIVES_PROPOSED` — GU decision reminders (Phase 2 loop)

### UNDER_REVIEW → never auto-expired
§5.4 of docs/deadlines-and-reminders.md: NU has started reviewing, auto-expire would discard their work. Only `SENT | DELIVERED | DETAILS_RETRIEVED` are in AUTO_EXPIRABLE.

### transport.send() outside db.transaction()
Must be called AFTER the transaction commits. Inside = nested-connection deadlock. This is a hard architectural rule.

### hub_messages schema changes
- Added `correlation_id TEXT` (nullable) column
- Added `TAKT_REQUEST_EXPIRED` and `TAKT_REQUEST_REMINDER` to `hubMessageTypeEnum`
- Migration applied via psql ADD COLUMN IF NOT EXISTS + ADD VALUE IF NOT EXISTS

### deduplicationKey format
`"<requestNumber>:<reminderType>:<YYYY-MM-DD>"` — uses the `windowDate` (due or guDue), not `now`.

### Test fixture teardown FK order for message_outbox
Must delete `message_outbox` (and `message_inbox`) rows before deleting organizations, because `message_outbox.recipient_org_id` has a FK to `organizations`. Symptom: FK violation on org delete in afterAll.

### upsertReminder idempotency
`if (existing) return "exists"` — any status (including FAILED) blocks a new row. The unique constraint on `(takt_request_id, reminder_type, deduplication_key)` provides DB-level protection too.

### OpenAPI codegen
After updating `TaktRequestListItem` in openapi.yaml, always run `pnpm --filter @workspace/api-spec run codegen`.

**Why:** The generated hooks in `@workspace/api-client-react` only update after codegen; stale generated code causes TS errors in the frontend.

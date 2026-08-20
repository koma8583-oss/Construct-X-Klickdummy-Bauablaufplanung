---
name: Response unification & hash idempotency
description: Both TaktRequest create routes use createTaktRequestWithSnapshot(); unified response processing via processNuResponse() with SHA-256 payload hash idempotency.
---

# Response Unification & Hash Idempotency

## Rules

**TaktRequest creation:**
- Both `POST /takt-requests` and `POST /projects/:id/takt-requests` call `createTaktRequestWithSnapshot()`.
- `requestNumber` is optional on the legacy route — auto-generated (`TKR-${Date.now().toString(36)}`) if omitted.
- `/send` handler: no lazy snapshot fallback; returns 422 if no snapshot exists.

**processNuResponse() service** (`artifacts/api-server/src/services/nu-response-service.ts`):
- All response processing goes through this service (both `/response` and `/responses` endpoints).
- Computes SHA-256 over canonical public payload (sorted-key JSON, no internal NU fields).
- Idempotency: same hash → 200 idempotent return; different hash → `ResponseConflictError` → 409.
- Single DB transaction: response insert/update + alternatives replacement + request status update (atomically).
- Revision rounds update the single response row in place because `takt_responses.takt_request_id` is UNIQUE; the immutable GU decision and audit events retain the coordination history.
- Transport call (`transport.send()`) happens AFTER commit (per deadline-worker architecture rule).

**responsePayloadHash column** on `takt_responses`:
- TEXT UNIQUE, nullable (legacy rows before this column are NULL).
- Legacy rows with NULL hash: if retried, the `null !== newHash` comparison will throw 409. This is acceptable (legacy coordination rounds should be complete). A backfill task is proposed.

**Idempotency return:**
- `transportStatus: existingOutbox?.status ?? "UNKNOWN"` — never defaults to "DELIVERED" when outbox row is missing (bug fixed from prior code).

**Why:** Eliminates dual code paths for response processing; ensures business objects (response + request status) are always consistent even if transport fails. The schema models one current response per request, so revisions must not insert a second row.

**How to apply:** Any future endpoint that accepts a NU response must call `processNuResponse()` — never insert into `taktResponsesTable` directly.

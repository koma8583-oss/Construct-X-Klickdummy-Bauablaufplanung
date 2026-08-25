---
name: Response unification & hash idempotency
description: TaktRequest creation and response idempotency rules, including the AN-owned Dataspace response boundary.
---

# Response Unification & Hash Idempotency

## Rules

**TaktRequest creation:**
- Both `POST /takt-requests` and `POST /projects/:id/takt-requests` call `createTaktRequestWithSnapshot()`.
- `requestNumber` is optional on the legacy route — auto-generated (`TKR-${Date.now().toString(36)}`) if omitted.
- `/send` handler: no lazy snapshot fallback; returns 422 if no snapshot exists.

**Response ownership:**
- NU answers are created only in `an_leistungsantworten`, against an existing `an_leistungsanfragen` projection.
- The AG response and request status are created/changed only by `applyIncomingServiceResponseOnAg()` after successful Dataspace delivery.
- Legacy `/response` and canonical `/responses` endpoints are compatibility adapters to this AN-native flow.
- `processNuResponse()` remains the AG-side inbound processor; it must not be called by NU HTTP routes.
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

**Legacy Dataspace bridge:**
- The external response contract flattens alternative `conditions` into one `"; "`-joined string. When a locally pre-existing response must be recognized as the same inbound response, compare this external representation with `(storedConditions ?? []).join("; ")`; do not split the inbound text back into an array.

**Why:** A condition itself may contain semicolons, so splitting the external text changes its meaning and turns an otherwise idempotent inbound response into a false payload conflict.

**How to apply:** Keep the comparison at the serialization boundary whenever an internal array is checked against an externally normalized response payload.

**Why:** Eliminates dual code paths for response processing; ensures business objects (response + request status) are always consistent even if transport fails. The schema models one current response per request, so revisions must not insert a second row.

**How to apply:** Any future endpoint that accepts a NU response must create an AN-owned response and publish its external payload; never insert into `taktResponsesTable` from the NU path.

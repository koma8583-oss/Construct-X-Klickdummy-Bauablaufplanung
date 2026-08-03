# State Models — TaktLifecycleStatus and TaktRequestStatus

This document defines the two new status enums introduced in Task 2.2, their permitted state transitions, and the business rules that govern them.

---

## 1 — Why Two Separate Enums?

The existing `takt_status` enum conflates the lifecycle of a Takt with the progress of individual coordination requests. This creates problems:

- A technically delivered (but not yet reviewed) request should not mark the Takt as confirmed.
- A rejected alternative from one request should not permanently mark the Takt as rejected.
- The Takt status should reflect the overall coordination outcome, not the current transport state of any single request.

**Solution**: Two separate enums on two separate database columns.

| Enum | Describes | Level |
|------|-----------|-------|
| `TaktLifecycleStatus` | The overall lifecycle of the Takt itself | Takt |
| `TaktRequestStatus` | The state of one specific coordination request | TaktRequest |

---

## 2 — `TaktLifecycleStatus`

Defined in OpenAPI as `TaktLifecycleStatus`. Stored in DB column `lifecycle_status` on the `takte` table.

| Value | Meaning |
|-------|---------|
| `DRAFT` | Takt is being edited; not yet ready for coordination |
| `PLANNED` | Takt is planningsseitig prepared; no active coordination |
| `IN_COORDINATION` | At least one coordination request with a NU is active |
| `CONFIRMED` | Execution was confirmed by the GU accepting a NU response |
| `CANCELLED` | The Takt was cancelled; no further coordination |

### Transitions (TaktLifecycleStatus)

Managed by domain logic — not directly set by the client.

```
DRAFT       → PLANNED, CANCELLED
PLANNED     → IN_COORDINATION, CANCELLED, DRAFT
IN_COORDINATION → CONFIRMED, PLANNED, CANCELLED
CONFIRMED   → CANCELLED       (exceptional; e.g. scope change)
CANCELLED   → (terminal)
```

### Mapping from existing `takt_status`

| Existing `takt_status` | New `lifecycleStatus` | Reasoning |
| ---------------------- | --------------------- | --------- |
| `GEPLANT`              | `PLANNED`             | Takt prepared, no delegation active |
| `VERGEBEN`             | `IN_COORDINATION`     | A delegation was sent to an AN |
| `ALTERNATIV`           | `IN_COORDINATION`     | AN proposed alternatives — still coordinating |
| `BESTAETIGT`           | `CONFIRMED`           | AN confirmed execution |
| `ABGELEHNT`            | `PLANNED`             | AN rejected one delegation, Takt not cancelled |
| `STORNIERT`            | `CANCELLED`           | Takt was cancelled |

**The old `status` column is retained unchanged.** The new `lifecycleStatus` column is added in parallel.

---

## 3 — `TaktRequestStatus`

Defined in OpenAPI as `TaktRequestStatus`. Stored in DB column `status` on the `takt_requests` table (new table, does not affect `delegations`).

| Value | Category | Meaning |
|-------|----------|---------|
| `DRAFT` | Internal | Request is being prepared; not yet sent |
| `SENT` | Transport | Notification was sent to the NU |
| `DELIVERED` | Transport | Notification was technically delivered |
| `DETAILS_RETRIEVED` | Transport | NU pulled the released Takt details |
| `UNDER_REVIEW` | Process | NU has started reviewing the request |
| `ACCEPTED` | Business | NU confirmed the requested time window |
| `ALTERNATIVES_PROPOSED` | Business | NU proposed one or more alternative time windows |
| `REJECTED` | Business | NU cannot fulfil this request |
| `REVISION_REQUIRED` | Business | GU requested a revision after reviewing the response |
| `CANCELLED` | Lifecycle | Request was cancelled by the GU |
| `EXPIRED` | Lifecycle | Response deadline passed without a response |
| `SUPERSEDED` | Lifecycle | A newer version of the request has been created |

### Terminal states

These states cannot be transitioned away from:

```
ACCEPTED
CANCELLED
EXPIRED
SUPERSEDED
```

### Permitted transitions

```
DRAFT               → SENT, CANCELLED

SENT                → DELIVERED, CANCELLED, EXPIRED

DELIVERED           → DETAILS_RETRIEVED, UNDER_REVIEW, CANCELLED, EXPIRED

DETAILS_RETRIEVED   → UNDER_REVIEW, ACCEPTED, ALTERNATIVES_PROPOSED,
                       REJECTED, CANCELLED, EXPIRED

UNDER_REVIEW        → ACCEPTED, ALTERNATIVES_PROPOSED, REJECTED,
                       CANCELLED, EXPIRED

ALTERNATIVES_PROPOSED → ACCEPTED, REVISION_REQUIRED, SUPERSEDED

REJECTED            → REVISION_REQUIRED, SUPERSEDED

REVISION_REQUIRED   → SUPERSEDED

ACCEPTED            → (terminal)
CANCELLED           → (terminal)
EXPIRED             → (terminal)
SUPERSEDED          → (terminal)
```

---

## 4 — Business Rules

### DELIVERED is not ACCEPTED

> `DELIVERED` means the message arrived at the NU's system. It says nothing about whether the NU has reviewed or accepted the request.

A technically delivered request that is never responded to will eventually become `EXPIRED`.

### REJECTED is not a Takt-level outcome

> `REJECTED` on a `TaktRequest` means the NU rejected this specific request. The Takt itself is not cancelled — the GU can send a new request to the same or a different NU.

The Takt's `lifecycleStatus` is only set to `CANCELLED` when the GU explicitly cancels the Takt, not when an AN rejects a single request.

### ALTERNATIVES_PROPOSED does not confirm the Takt

> `ALTERNATIVES_PROPOSED` means the NU offered alternatives but has not confirmed the original window. The Takt is not confirmed until the GU accepts one of the alternatives.

When the GU accepts an alternative, the TaktRequest moves to `ACCEPTED` and the Takt may then move to `CONFIRMED`.

### REVISION_REQUIRED follows non-acceptance

> A GU that does not accept the NU's alternatives or rejection can set the request to `REVISION_REQUIRED` to signal that a new request will follow.

This signals to the NU that the GU is preparing a revised request rather than abandoning coordination.

### SUPERSEDED marks replaced requests

> When the GU sends a new (revised) request for the same Takt, the previous request moves to `SUPERSEDED`.

The `takt_requests.supersedesRequestId` field links the new request back to the one it replaces.

### A new request can restore IN_COORDINATION

> After `REJECTED` or `ALTERNATIVES_PROPOSED`, the GU may create a new TaktRequest. This moves the Takt's `lifecycleStatus` back to `IN_COORDINATION`.

---

## 5 — GU Decision and Revision Flows (implemented Tasks 6.3–6.6)

### GU decisions (`POST /api/takt-requests/:id/gu-decisions`)

After a NU responds, the GU makes one of four decisions:

| Decision type | From status | Request → | Takt lifecycle → |
|---|---|---|---|
| `CONFIRM_ACCEPTED` | `ACCEPTED` | stays `ACCEPTED` | `CONFIRMED` |
| `ACCEPT_ALTERNATIVE` | `ALTERNATIVES_PROPOSED` | → `ACCEPTED` | `CONFIRMED` |
| `REQUEST_REVISION` | any open status | → `REVISION_REQUIRED` | unchanged |
| `CLOSE_WITHOUT_AGREEMENT` | any open status | → `CANCELLED` | → `PLANNED` |

Service: `artifacts/api-server/src/services/gu-decision-service.ts`  
Version logic: `artifacts/api-server/src/services/takt-version-service.ts`

`CONFIRM_ACCEPTED` creates a new `takt_versions` entry only when the accepted window differs from current takt dates.  
`ACCEPT_ALTERNATIVE` always creates a new `takt_versions` entry (sourceType = `ACCEPTED_ALTERNATIVE`).

### Revision round (`POST /api/takt-requests/:id/revisions`)

After `REQUEST_REVISION`, the GU starts a new coordination round:

```
Old TaktRequest (REVISION_REQUIRED) → SUPERSEDED
New TaktRequest (DRAFT) created, supersedesRequestId = old ID
New takt_versions entry (sourceType = REVISION)
takte.version++, planned_start/end updated
takte.lifecycle_status → IN_COORDINATION
```

`sendImmediately=true`: new request is sent immediately → status → `DELIVERED`.

Service: `artifacts/api-server/src/services/revision-service.ts`

---

## 6 — Implementation Location

### Transition validation function

File: `artifacts/api-server/src/lib/takt-request-transitions.ts`

```ts
import { TaktRequestStatus } from "@workspace/db";

export function isValidTaktRequestTransition(
  current: TaktRequestStatus,
  next: TaktRequestStatus
): boolean

export function assertValidTaktRequestTransition(
  current: TaktRequestStatus,
  next: TaktRequestStatus
): void  // throws Error on invalid transition
```

The function is **framework-independent** — no Express, no Drizzle, no HTTP context. It uses the string union type `TaktRequestStatus` inferred from the Drizzle schema.

### Usage

`updateTaktRequestStatus()` in the repository layer calls `assertValidTaktRequestTransition()` before writing to the database. Invalid transitions throw a `DomainError`.

The function is **not yet wired** to existing delegation endpoints. Those continue to use the old `delegation_status` enum directly.

---

## 6 — Tests

File: `artifacts/api-server/src/__tests__/takt-request-transitions.test.ts`

Test categories:
1. Valid forward transitions (e.g. `DRAFT → SENT`)
2. Invalid backward transitions (e.g. `DELIVERED → DRAFT`)
3. Transitions out of terminal states
4. The `DELIVERED` ≠ `ACCEPTED` boundary
5. All terminal states are truly terminal

Run: `pnpm --filter @workspace/api-server run test`

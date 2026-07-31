# Transport Architecture — Current State and Target Design

This document describes the existing hub/message implementation, its coupling characteristics, and the target transport architecture for the TaktRequest coordination flow.

---

## 1 — Existing Implementation

### 1.1 `hub_messages` table (`lib/db/src/schema/hub.ts`)

The central message log for coordination events.

| Column         | Type                    | Notes                                                   |
| -------------- | ----------------------- | ------------------------------------------------------- |
| `id`           | text (UUID)             | PK                                                      |
| `type`         | enum `hub_message_type` | NOT NULL                                                |
| `senderOrgId`  | text                    | NOT NULL — triggering organisation                      |
| `recipientOrgId`| text                   | NOT NULL — receiving organisation                       |
| `delegationId` | text                    | nullable — plain text, **no FK** (avoids circular deps) |
| `payload`      | json                    | nullable — full event payload                           |
| `createdAt`    | timestamptz             | NOT NULL DEFAULT now()                                  |

**Storage type:** `json` (not `jsonb`) — not indexable by field.

**No status field:** once written, a `hub_message` has no `PENDING` / `DELIVERED` / `FAILED` state. It is an append-only audit log, not a delivery queue.

**No FK on `delegationId`:** intentional design decision to avoid circular dependencies between the hub and delegation tables.

**No retry logic, no idempotency key.**

### 1.2 `hub_message_type` enum (7 values)

All existing message types are delegation-scoped:

```text
DELEGATION_CREATED
DELEGATION_CONFIRMED
DELEGATION_REJECTED
DELEGATION_ALTERNATIVE
DELEGATION_CANCELLED
AG_ACCEPTED_ALTERNATIVE
AG_REJECTED_ALTERNATIVE
```

### 1.3 `writeHubMessage` helper (`artifacts/api-server/src/lib/hubMessageWriter.ts`)

```ts
export async function writeHubMessage(
  type: HubMessageType,
  senderOrgId: string,
  recipientOrgId: string,
  delegationId: string,
  payload: Record<string, unknown>,
): Promise<void>
```

- **Non-fatal:** the entire function is wrapped in a `try/catch`; failures are logged but never propagate to the caller or roll back the business transaction.
- **Fire-and-forget:** single synchronous insert, no queue, no retry.
- **Not transactional:** called *after* the main Drizzle transaction commits — if the insert fails, the hub log is silently missing.

### 1.4 Where hub messages are created (`artifacts/api-server/src/routes/delegations.ts`)

| Route handler | Event written | Line (approx.) |
| --- | --- | --- |
| `POST /delegations` | `DELEGATION_CREATED` | 170 |
| `PATCH /delegations/:id` | `DELEGATION_CANCELLED` | 328 |
| `POST /delegations/:id/responses` | `DELEGATION_CONFIRMED` / `DELEGATION_REJECTED` / `DELEGATION_ALTERNATIVE` | 540 |
| `PATCH /delegations/:id/responses/:responseId` | `AG_ACCEPTED_ALTERNATIVE` / `AG_REJECTED_ALTERNATIVE` | 660 |

**Direct coupling:** business logic (route handler) calls `writeHubMessage` directly. The route handler knows which hub message type to emit.

### 1.5 Webhook system (`lib/db/src/schema/webhooks.ts`)

| Table | Purpose |
| --- | --- |
| `webhook_subscriptions` | Org-owned subscriptions with URL, event filter, and optional secret |
| `webhook_events` | Outbox-like log: `PENDING` / `DELIVERED` / `FAILED`, `attempts` counter, `lastAttemptAt` |

The webhook dispatcher (`artifacts/api-server/src/lib/webhookDispatcher.ts`) sets `attempts: 1` and writes a terminal status — there is no background retry worker. Delivery is synchronous and single-attempt.

### 1.6 Hub routes (`artifacts/api-server/src/routes/hub/`)

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `GET /api/hub/messages` | List messages for current org (sender OR recipient) | JWT + org filter |
| `GET /api/hub/messages/timeline/:delegationId` | Chronological event history for one delegation | JWT + org filter |
| `GET /api/hub/admin/users` | All users — Hub Admins only | JWT + hub-admin check |
| `GET /api/hub/admin/orgs` | All orgs — Hub Admins only | JWT + hub-admin check |

**Org filtering:** non-admin users see only rows where `senderOrgId = req.user.orgId OR recipientOrgId = req.user.orgId`.

### 1.7 `hub_admins` table

Marks individual users as Hub Admins (cross-org read access). Plain join to `users.id` with CASCADE delete.

---

## 2 — Current Coupling Analysis

```
Route handler (delegations.ts)
    │
    ├── opens DB transaction
    │       └── inserts/updates delegation row
    │       └── dispatches webhook (webhookDispatcher)
    │
    ├── commits transaction
    │
    └── calls writeHubMessage()          ← direct call, outside transaction
            └── inserts hub_message row  ← fire-and-forget, no rollback on failure
```

**Problems with this pattern for TaktRequest transport:**

| Problem | Impact |
| --- | --- |
| Route handler owns message type selection | Adding transport requires changing route handlers |
| Hub insert is outside the DB transaction | Hub message can be lost if the process crashes between commit and insert |
| `hub_messages` has no delivery status | Cannot know whether the NU has seen the message |
| Payload contains full business data | Violates data minimality; NU should pull details separately |
| No idempotency key | Retrying a failed send would create duplicate messages |
| `json` column (not `jsonb`) | Payload not indexable; filtering by payload fields requires full table scan |

---

## 3 — What Can Be Reused

| Component | Reusable? | Notes |
| --- | --- | --- |
| `hub_messages` table | ✅ Partially | Can be extended with new message types for TaktRequest flow; existing delegation types remain |
| Hub routes (`/api/hub/messages`) | ✅ Yes | Already org-filtered; can display TaktRequest events alongside delegation events |
| `webhook_events` table schema | ✅ Yes | The `status` + `attempts` + `lastAttemptAt` pattern is exactly what an Outbox needs |
| `writeHubMessage` helper | ⚠️ PoC only | Useful as reference; not suitable as-is for TaktRequest flow (no idempotency, no tx) |
| Hub-admin access control | ✅ Yes | Cross-org oversight already implemented |
| JWT org filtering | ✅ Yes | `requireJwt` middleware + `req.user.orgId` pattern |

| Component | Will become legacy | Notes |
| --- | --- | --- |
| `writeHubMessage` (delegation-coupled) | ✅ Eventually | New transport layer replaces direct calls; delegation flow preserved until migration |
| `hub_message_type` enum (delegation values) | ✅ Eventually | New enum values for TaktRequest types needed; old values stay until delegation routes migrate |
| Direct route → hub coupling | ✅ Yes | Target: route → domain service → transport interface |

---

## 4 — Target Architecture

### 4.1 Flow diagram

```
GU-System
    │
    │  1. creates TaktRequest + Snapshot (domain layer)
    ▼
Message Outbox (PENDING)
    │
    │  2. LocalHubTransport.send()
    ▼
Simulated Hub (hub_messages)
    │
    │  3. Delivery recorded
    ▼
Message Inbox / Delivery log (NU side)
    │
    │  4. Notification contains only: requestId, taktId, deadline, detailsUrl
    ▼
NU pulls TaktRequestSnapshot from GU endpoint
    │
    │  5. TaktRequest status → DETAILS_RETRIEVED
    ▼
NU reviews and responds
```

### 4.2 Status sequence

```text
TaktRequest   DRAFT
                ↓  (GU sends)
Outbox entry  PENDING
                ↓  (LocalHubTransport delivers)
TaktRequest   SENT
Outbox entry  SENT
                ↓  (Hub delivers to NU inbox)
TaktRequest   DELIVERED
                ↓  (NU pulls snapshot)
TaktRequest   DETAILS_RETRIEVED
                ↓  (NU reviews)
TaktRequest   UNDER_REVIEW
                ↓  (NU decides)
TaktRequest   ACCEPTED | ALTERNATIVES_PROPOSED | REJECTED
```

### 4.3 Architecture principles

1. **Business logic never calls the Hub directly.** Domain services use an abstract `MessageTransport` interface.
2. **Abstract transport interface** — `LocalHubTransport` for PoC; `EdcTransport` later; same interface.
3. **Outbox pattern** — messages are written to an outbox table *inside the same DB transaction* as the domain change. The transport dispatches from the outbox asynchronously.
4. **Inbox / delivery log** — delivery to the NU side is recorded separately from the send event.
5. **Notification payload is minimal** — contains only identifiers, deadline, and a `detailsUrl`. No Takt data in the hub message body.
6. **NU pulls full details** — the snapshot is served via a dedicated GU endpoint; the NU fetches it using the reference in the notification.
7. **Hub stores no snapshots** — `hub_messages.payload` for TaktRequest events contains only metadata.
8. **Technical delivery ≠ business acceptance** — `TaktRequest.status = DELIVERED` means the message arrived; `ACCEPTED` requires an explicit NU business decision.
9. **Idempotency** — each outbox entry has an idempotency key; retrying delivery does not create duplicate messages.
10. **Retry capability** — outbox entries track status and attempts, enabling a background worker to retry failed deliveries.

---

## 5 — Target Components

| Component | Responsibility | Planned location |
| --- | --- | --- |
| `MessageTransport` | Abstract interface: `send(message): Promise<void>` | `artifacts/api-server/src/lib/transport/message-transport.ts` |
| `LocalHubTransport` | PoC implementation: writes to `hub_messages` transactionally, updates outbox entry | `artifacts/api-server/src/lib/transport/local-hub-transport.ts` |
| `MessageOutboxRepository` | Persist outbox entries; mark `SENT` / `FAILED`; query `PENDING` | `artifacts/api-server/src/lib/transport/outbox-repository.ts` |
| `MessageInboxRepository` | Record delivery on NU side; query unread notifications | `artifacts/api-server/src/lib/transport/inbox-repository.ts` |
| `MessageDeliveryService` | Orchestrate: read outbox → call transport → update statuses | `artifacts/api-server/src/lib/transport/delivery-service.ts` |
| `TaktRequestNotificationService` | Domain service: build notification payload, call transport, update TaktRequest status | `artifacts/api-server/src/lib/takt-request-notification-service.ts` |
| `TaktRequestSnapshotService` | Serve released snapshot to NU; update `detailsRetrievedAt`; validate schema version | `artifacts/api-server/src/lib/takt-request-snapshot-service.ts` |

File names may be adjusted to match actual project conventions when implemented.

---

## 6 — New DB Objects Required (not yet implemented)

| Table | Purpose |
| --- | --- |
| `message_outbox` | Transactional outbox: one row per pending send; `status`, `attempts`, `idempotencyKey`, `payload` (jsonb), `scheduledAt` |
| `message_inbox` | Delivery log on NU side: `taktRequestId`, `receivedAt`, `readAt` |

Both tables follow existing conventions: text UUID PKs, timestamptz timestamps.

Existing `hub_messages` is extended with two new enum values:

```text
TAKT_REQUEST_NOTIFICATION   (GU → NU)
TAKT_RESPONSE_RECEIVED      (NU → GU)
```

The existing 7 delegation-based values are retained unchanged.

---

## 7 — Migration Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `writeHubMessage` is called outside the DB transaction | Hub messages can be silently lost | New outbox pattern writes inside the transaction; old call sites preserved until delegation migration |
| `hub_messages.payload` uses `json` not `jsonb` | Existing rows not indexable; new rows should use `jsonb` | Add new outbox with `jsonb`; leave `hub_messages.payload` as-is to preserve backward compat |
| Route handlers own message type selection | Must update each route when migrating | Introduce domain service layer first; migrate route-by-route |
| Delegation routes still call `writeHubMessage` directly | Risk of duplicate messages if also writing via new transport | New TaktRequest flow uses only new transport; delegation flow stays on old path until explicit migration |
| No retry worker exists | Failed deliveries in PoC are silently dropped | PoC tolerance: `LocalHubTransport` delivers synchronously; retry worker deferred to production readiness |
| Hub message `delegationId` is not a FK | Hard to join with delegation data reliably | New `message_outbox` will use typed FK to `takt_requests.id`; `hub_messages.delegationId` remains as-is |

---

## 8 — Analysis Summary

**Existing hub/message components analysed:**
`hub_messages` (table + schema) · `hub_admins` · `hub_message_type` enum · `writeHubMessage` helper · `webhook_subscriptions` + `webhook_events` · hub routes (`/messages`, `/messages/timeline/:delegationId`, `/admin/users`, `/admin/orgs`) · `webhookDispatcher` · delegation route hub-call sites (4 locations)

**Direct coupling identified:**
Route handler (`delegations.ts`) → `writeHubMessage` → `hub_messages` insert. Message type selection and payload construction live in the route handler. The hub insert runs outside the business transaction.

**Reusable components:**
`hub_messages` table (extensible) · hub route org-filtering · `webhook_events` schema pattern (outbox model) · JWT middleware · hub-admin access control

**Target architecture documented:**
Abstract `MessageTransport` interface → `LocalHubTransport` (PoC) / `EdcTransport` (future) · transactional `message_outbox` · `message_inbox` delivery log · `TaktRequestNotificationService` · `TaktRequestSnapshotService` · minimal notification payload with detailsUrl

**Not implemented in this step:**
Database schema changes · transport code · new REST endpoints · snapshot endpoint · NU response flow · UI changes · EDC

# Dataspace Readiness — TaktKoord and Tractus-X EDC

This document describes how TaktKoord's coordination data exchange is designed
for a future migration to an Eclipse Dataspace Connector (EDC) based on the
Tractus-X standard. No EDC components are implemented today. This document
defines the architectural intent, the asset classification, and the Provider-Push
flow that the current transport abstraction is prepared to support.

---

## 1 — Why EDC / Tractus-X

TaktKoord coordinates between legally and organisationally independent parties:
the Generalunternehmer (GU) and Nachunternehmer (NU). In large construction
projects these parties may belong to different enterprises with separate IT
systems, distinct data governance obligations, and independent legal data
ownership.

The [Tractus-X](https://eclipse-tractusx.github.io/) initiative (Eclipse
Foundation, part of Catena-X) provides a dataspace connector (EDC) that enables
cross-enterprise data exchange under negotiated usage policies and verifiable
organisational identities — without requiring a central platform to hold the data.

TaktKoord's coordination flow maps naturally onto the EDC data transfer model:

| TaktKoord concept | EDC concept |
|---|---|
| TaktRequest notification | Data offer (`DataOffer`) initiated by GU connector |
| Takt snapshot pull by NU | Contract negotiation → data transfer (`DataTransfer`) |
| NU response delivery | NU connector pushes response asset to GU connector |
| GU decision delivery | GU connector pushes decision asset to NU connector |
| Hub (current PoC) | Dataspace Hub / connector registry |

---

## 2 — Current DataspaceExchange Boundary

Cross-organisation TaktRequest and TaktResponse publications flow through
`DataspaceExchange`. Domain routes map internal values to whitelisted external
DTOs before publishing. `MessageTransport` remains the lower-level legacy
message delivery contract used by the REST adapter.

```
Domain service / route
    │
    ▼ calls
DataspaceExchange
    │
    ▼
createDataspaceExchange()
    │
    ├── RestDataspaceExchange → LocalHubTransport (current PoC)
    └── TractusXEdcExchange (stub, future)
```

`DATASPACE_TRANSPORT=rest` selects the current REST adapter. Setting
`DATASPACE_TRANSPORT=tractusx-edc` reaches the explicit
`Tractus-X EDC adapter not configured` stub; no EDC protocol logic exists yet.

See `docs/transport-architecture.md` for the full interface specification and
current PoC implementation details.

---

## 3 — Data Exchange Operations and their EDC Equivalents

### 3.1 Complete operation map

| Step | Operation | Direction | Today (PoC) | Future (EDC Provider-Push) |
|------|-----------|-----------|-------------|---------------------------|
| 1 | TaktRequest notification | GU → NU | `DataspaceExchange.publishTaktRequest()` → `RestDataspaceExchange` → `LocalHubTransport` | GU connector pushes `TaktRequestNotification` asset to NU connector endpoint |
| 2 | Takt snapshot retrieval | NU pulls from GU | `GET /api/an/takt-requests/:id/details` | Contract negotiation → EDC pull transfer; GU endpoint serves snapshot under access policy |
| 3 | Availability check | NU internal | Local DB query (no external message) | Remains internal; no EDC transfer |
| 4 | NU response delivery | NU → GU | `DataspaceExchange.publishTaktResponse()` → `RestDataspaceExchange` → `LocalHubTransport` | NU connector pushes `TaktResponse` asset to GU connector endpoint |
| 5 | GU decision delivery | GU → NU | existing legacy decision path | GU connector pushes `TaktDecision` asset to NU connector endpoint |
| 6 | Revision notification | GU → NU | `LocalHubTransport.send()` (new envelope) | GU connector pushes `TaktRevisionNotification` asset |

### 3.2 Provider-Push flow (future EDC)

In the EDC Provider-Push pattern the data **provider initiates** the transfer
to a known consumer endpoint. This replaces the current Consumer-Pull model
(NU polls `GET /details`):

```
Current (Consumer-Pull):
  NU app → GET /api/an/takt-requests/:id/details → GU server returns snapshot

Future (Provider-Push via EDC):
  1. GU connector creates DataOffer for the TaktRequest snapshot asset
  2. NU connector detects offer (via catalog query or push notification)
  3. Contract negotiation: NU connector accepts usage policy
  4. GU connector pushes snapshot to NU connector's data endpoint
  5. NU connector stores snapshot locally → no further pull needed
```

From TaktKoord's perspective, `EdcTransport.send()` would:
1. Create or reference the DataOffer for the asset
2. Initiate a transfer process to the NU connector URL
3. Return a `TransportResult` once the DSP transfer is confirmed

The NU's `DETAILS_RETRIEVED` status transition and audit event are written
by the same service layer regardless of transport mechanism.

---

## 4 — Asset Classification

Each piece of data exchanged is classified as a distinct Dataspace asset type.
Asset IDs follow the pattern `urn:taktkoord:asset:<type>:<requestId>`.

| Asset type | Asset ID pattern | Producer | Consumer | Contains |
|---|---|---|---|---|
| `TaktRequestNotification` | `urn:taktkoord:asset:notification:<requestId>` | GU | NU | Reference IDs, deadline, detailsRef — no full Takt |
| `TaktRequestSnapshot` | `urn:taktkoord:asset:snapshot:<requestId>` | GU | NU | Whitelisted Takt fields (see `docs/data-ownership.md`) |
| `TaktResponse` | `urn:taktkoord:asset:response:<requestId>` | NU | GU | Decision, reason code, alternatives (no internal NU data) |
| `TaktDecision` | `urn:taktkoord:asset:decision:<requestId>` | GU | NU | Accepted/revision decision, acceptedAlternativeId |
| `TaktRevision` | `urn:taktkoord:asset:revision:<requestId>` | GU | NU | New requestId superseding previous (reference only) |

### 4.1 Data minimality principle (enforced today, carried forward)

The notification asset contains **only reference identifiers and a detailsRef
URL** — not the full Takt data. This maps directly to the EDC principle that
the data offer is a reference to the asset, not the asset itself.

The snapshot is served separately (pull or push) only after contract
negotiation and policy enforcement. This separation is already enforced by the
`buildTaktRequestSnapshot()` whitelist in the current PoC.

---

## 5 — Contract and Policy Placeholders

The `DataspaceExchange` interface accepts neutral external DTOs. The
`MessageTransport` interface is designed to accept optional contract/policy
context without changing any domain service. The current `MessageEnvelope` already
carries:

| Envelope field | EDC equivalent |
|---|---|
| `messageId` | DSP transfer process correlationId |
| `schemaVersion` | Asset schema version in DataCatalog |
| `senderOrgId` | Provider connector BPN (Business Partner Number) |
| `recipientOrgId` | Consumer connector BPN |
| `correlationId` | Business process identifier (TaktRequest ID) |
| `causationId` | Parent transfer process reference |

When `EdcTransport` is implemented it will extend the envelope (or use a
side-channel) to carry:
- `contractAgreementId` — the EDC contract negotiation result
- `policyId` — the usage policy that governs this data offer
- `providerConnectorUrl` — the GU's DSP endpoint
- `consumerConnectorUrl` — the NU's DSP endpoint

These fields do **not** appear in the current `MessageEnvelope` schema because
they are transport-layer concerns. Domain services must not inspect them.

---

## 6 — Audit Trail and EDC

Each data exchange operation writes an entry to `takt_request_audit_events`
(see schema: `lib/db/src/schema/takt-request-audit-events.ts`). This table is
transport-agnostic: the `EdcTransport` implementation will write the same event
types as `LocalHubTransport`, so the coordination history is identical regardless
of which transport is active.

| Audit event | Written by | EDC equivalent trigger |
|---|---|---|
| `NOTIFICATION_SENT` | Route handler after `transport.send()` ✅ | DSP TransferProcess initiated |
| `NOTIFICATION_DELIVERED` | Route handler on DELIVERED result ✅ | DSP TransferProcess COMPLETED |
| `DETAILS_RETRIEVED` | `/details` route — transition winner only ✅ | DSP pull completed / push confirmed |
| `AVAILABILITY_CHECK_DONE` | **Not yet written** — availability-check-service.ts does not call writeAuditEvent (see Task #91) | (internal, no EDC event) |
| `RESPONSE_SUBMITTED` | Response route handler ✅ | NU connector push initiated |
| `RESPONSE_DELIVERED` | After transport.send() in response flow ✅ | DSP push to GU COMPLETED |
| `GU_DECISION_MADE` | GU decision service, non-idempotent path ✅ | GU connector push initiated |
| `REVISION_CREATED` | Revision service, written on old request ✅ | New TaktRequest lifecycle begins |
| `REQUEST_EXPIRED` | **Not yet written** — deadline worker does not call writeAuditEvent (see Task #91) | (system event, no external push) |
| `REQUEST_CANCELLED` | **Not yet written** — cancellation path does not call writeAuditEvent (see Task #91) | (system/GU event) |

---

## 7 — What is NOT Implemented (Explicit Out-of-Scope)

The following EDC/Tractus-X components are **not implemented** in TaktKoord and
are out of scope until an explicit EDC integration task is started:

| Component | Status |
|---|---|
| Eclipse Dataspace Connector (EDC) runtime | ❌ Not implemented |
| DSP (Dataspace Protocol) HTTP endpoints | ❌ Not implemented |
| Managed Identity Wallet / Verifiable Credentials | ❌ Not implemented |
| Contract negotiation protocol | ❌ Not implemented |
| Policy enforcement (ODRL / AAS) | ❌ Not implemented |
| External Schema Registry / DCAT catalog | ❌ Not implemented |
| BPN (Business Partner Number) directory | ❌ Not implemented |
| EDC management API integration | ❌ Not implemented |
| Tractus-X Portal onboarding | ❌ Not implemented |

The `EdcTransport` class itself does not yet exist. When it is built it will
implement the `MessageTransport` interface and no other code will need to change.

---

## 8 — Implementation Checklist for EDC Migration (future reference)

When the EDC migration task is started, the following steps apply:

1. Provision two EDC connector instances (GU-side, NU-side) — or one per
   organisation in multi-tenant mode.
2. Implement `EdcTransport implements MessageTransport` using the EDC
   management API and DSP protocol.
3. Register asset types (§4) in the EDC catalog for each TaktRequest.
4. Map `senderOrgId` / `recipientOrgId` to BPNs via a directory service.
5. Replace `new LocalHubTransport()` in `artifacts/api-server/src/routes/takt-requests.ts`
   with `new EdcTransport(config)` — or use a factory / DI container.
6. Verify audit events still write correctly (`takt_request_audit_events`).
7. Remove `LocalHubTransport` usage from production paths (keep for tests).

No domain services, route handlers, or database schema changes are required for
steps 1–6 other than the transport factory swap (step 5).

---

## 9 — Related Documents

- `docs/transport-architecture.md` — Current `MessageTransport` interface,
  `LocalHubTransport` implementation, and target architecture.
- `docs/message-flow.md` — End-to-end coordination flow with current PoC
  and future EDC migration notes.
- `docs/data-ownership.md` — Field-level data ownership and NU data privacy rules.
- `docs/json-contracts.md` — JSON payload schemas for all message types.
- `lib/db/src/schema/takt-request-audit-events.ts` — Audit event DB schema.
- `artifacts/api-server/src/lib/transport/message-transport.ts` — The abstract
  `MessageTransport` interface that `EdcTransport` will implement.

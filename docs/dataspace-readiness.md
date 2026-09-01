# Dataspace Readiness

This document describes the current neutral exchange boundary for construction
service coordination and project data offers. No EDC, DSP, RDF, AAS, DTR,
catalog, negotiation, or data-plane implementation is included.

## Current architecture

```text
Domain service / route
        ↓
DataspaceExchange
        ↓
createDataspaceExchange()
        ↓
┌──────────────────────────────────────┐
│ RestDataspaceExchange                │
│ → LocalHubTransport (REST PoC)       │
└──────────────────────────────────────┘

or explicitly unavailable

┌──────────────────────────────────────┐
│ TractusXEdcExchange                  │
│ → explicit NOT_CONFIGURED boundary   │
└──────────────────────────────────────┘
```

The active implementation is selected by `DATASPACE_TRANSPORT`. The default
is `rest`. The `tractusx-edc` setting reaches the intentional
`NOT_CONFIGURED` error. It never falls back to the local transport, calls a
generic `/messages` endpoint, or reports simulated delivery success.

## Exchange contract

The external boundary uses only:

- `ExternalServiceRequest`
- `ExternalServiceResponse`
- `ExternalAlternativeProposal`
- `ExternalResourceRequirement`
- `ExternalDataOffer`
- `ExchangeMetadata`
- `ExchangePolicy` for coordination
- separate access and usage policy snapshots for data offers
- `DataspaceParticipant`

The external identifiers are neutral:

```text
requestId
requestVersion
correlationId
messageId
```

`messageId` identifies one exchange message. `correlationId` remains stable
for the complete request/response workflow. The local organisation identifier
is used only by the local preparation directory; it is not emitted as a BPNL
or DID. Participant discovery and connector identifiers are intentionally not
implemented.

The policy purpose is centralized as:

```text
construction-service-coordination
```

The mappers enforce data minimality. They do not export concrete resources,
resource bookings, employee or equipment identities, internal projects,
costs, or internal notes.

## Current operations

| Operation | Direction | Current implementation |
|---|---|---|
| Service Request | AG → AN | `publishServiceRequest()` → REST adapter → local hub |
| Service Response | AN → AG | `publishServiceResponse()` → REST adapter → local hub |
| Project invitation | AG → AN | `publishProjectInvitation()` → REST adapter → local hub |
| Project invitation response | AN → AG | `publishProjectInvitationResponse()` → REST adapter → local hub |
| Data offer | AG → AN | `publishDataOffer()` → REST adapter → local hub |
| Snapshot/details retrieval | AN → AG | Existing protected REST endpoint |
| Internal availability check | AN | Local domain operation |

The German UI may continue to use `Leistungsanfrage` and `Leistungsantwort`.
Those labels are not part of the technical exchange contract.

## Membership and data publication boundary

Project invitations create only a pending membership relationship. They do not
create a `DataPublication`, start an EDC negotiation, or transfer project data.
The AN must actively accept the invitation before the AG can publish selected
data under its own publication policy.

`DATA_OFFER_PUBLISHED` is a separate message type and contract. It contains
publication metadata and immutable policy snapshots, with access policy and
usage policy represented separately. The current AN data-offer projection is a
compatibility adapter for the local PoC; it is not an invitation.

The legacy combined onboarding operation is intentionally disabled and fails
explicitly rather than recreating membership and data release in one operation.

## Audit and retry state

Every outbound service request or service response creates one row in
`dataspace_exchanges`:

```text
CREATED → PUBLISHED
```

Transport failures result in:

```text
CREATED → FAILED
```

The row stores exchange metadata and the technical external reference only.
Payloads are never copied into the audit table.

For outbox-backed invitation, data-offer, and decision messages, an unavailable
Tractus-X connector leaves the persisted envelope in `FAILED` with
`NOT_CONFIGURED`. A retry reads the persisted payload and message ID; it does
not rebuild or locally deliver the message.

Inbound processing is centralized in:

- `handleIncomingServiceRequest()`
- `handleIncomingServiceResponse()`

These functions validate metadata, apply message-ID idempotency, create the
inbound audit record, call the supplied domain handler, and record
`PROCESSED` or `FAILED`.

## Explicitly out of scope

- Asset registration
- Policy definitions
- Contract definitions
- Catalog discovery
- Contract negotiation
- EDRs
- Transfer processes
- Data-plane communication
- BPN/DID discovery
- Production connector configuration and notification delivery
- Digital Twin Registry
- AAS
- Legacy route or database renaming
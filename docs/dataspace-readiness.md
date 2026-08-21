# Dataspace Readiness

This document describes the current neutral exchange boundary for construction
service coordination. No EDC, DSP, RDF, AAS, DTR, catalog, negotiation, or
data-plane implementation is included.

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

or later

┌──────────────────────────────────────┐
│ TractusXEdcExchange                  │
│ → explicit not-configured stub       │
└──────────────────────────────────────┘
```

The active implementation is selected by `DATASPACE_TRANSPORT`. The default
is `rest`. The `tractusx-edc` setting reaches the intentional
`Tractus-X EDC adapter not configured` error.

## Exchange contract

The external boundary uses only:

- `ExternalServiceRequest`
- `ExternalServiceResponse`
- `ExternalAlternativeProposal`
- `ExternalResourceRequirement`
- `ExchangeMetadata`
- `ExchangePolicy`
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
is currently used by `resolveDataspaceParticipant`; participant discovery and
connector identifiers are intentionally not implemented.

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
| Snapshot/details retrieval | AN → AG | Existing protected REST endpoint |
| Internal availability check | AN | Local domain operation |

The German UI may continue to use `Leistungsanfrage` and `Leistungsantwort`.
Those labels are not part of the technical exchange contract.

## Audit

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
- Digital Twin Registry
- AAS
- Legacy route or database renaming
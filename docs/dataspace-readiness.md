# Dataspace Readiness

This document describes the current neutral exchange boundary for construction
service coordination and project onboarding. No EDC, DSP, RDF, AAS, DTR,
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

or later

┌──────────────────────────────────────┐
│ TractusXEdcExchange                  │
│ → explicit not-configured stub       │
└──────────────────────────────────────┘
```

The active implementation is selected by `DATASPACE_TRANSPORT`. The default
is `rest`. The `tractusx-edc` setting reaches the intentional
`Tractus-X EDC adapter not configured` error.

## Project invitation preparation

The click dummy deliberately separates **project invitation** from **project
data publication**. An AG can invite a prepared dataspace participant without
publishing schedule, BIM, BoQ, logistics, resource, or other project data.

The local lifecycle is:

```text
PROJECT KNOWN
     ↓
INVITED
     ↓ AN accepts                ↓ AN rejects
ACTIVE PROJECT MEMBER           REJECTED
     ↓
AG may create a separate data publication
     ↓
Project data becomes available according to the selected policy
```

The invitation itself contains only the minimal project-membership fields:

- project reference
- project name
- project status
- project location / construction project
- invitation message and validity, if configured
- intended participant identifier
- policy template/version and policy snapshot

Creating an invitation does **not**:

- register an EDC asset
- publish project data
- create a catalog offer
- execute a contract negotiation
- create an EDR
- start a transfer process
- send data through an EDC data plane

The current implementation uses the local participant identifier and the local
REST exchange as a deterministic mock transport. The invitation and the AN
response are executable in the click dummy; the real dataspace infrastructure
is intentionally absent.

### Current mock flow

```text
AG project UI
    ↓ select prepared AN identity
ProjectInvitationWizard
    ↓
ExternalProjectInvitation
    ↓
RestDataspaceExchange / local transport
    ↓
AN project-invitation inbox
    ↓ accept / reject
ExternalProjectInvitationResponse
    ↓
AG project membership
    ↓
ACTIVE only after acceptance
    ↓
separate DataPublication flow
```

Normal project data publication remains restricted to active project members.
This ensures that the invitation is not used as an implicit data-release
mechanism.

### Future Tractus-X mapping

The current mock objects are intentionally designed so that infrastructure can
be replaced later without changing the domain process.

| Current click-dummy concept | Later Tractus-X/EDC integration |
|---|---|
| local `participantId` | BPNL + DID + participant/connector discovery |
| selectable prepared participant | dataspace identity resolved to the AN connector |
| local invitation delivery | receiver-side notification endpoint/asset + negotiated POST delivery |
| `ExternalProjectInvitation` | Industry Core-style notification with `header` / `content` |
| `allowedConsumerParticipantId` | BPN-based access-policy constraint |
| policy template + snapshot | ODRL usage policy / contract policy |
| invitation acceptance | project-membership activation in the AG domain |
| separate `DataPublication` | provider asset + contract definition for project data |
| local retrieval | catalog → contract negotiation → transfer process / data plane |

For a later push-notification integration the technical EDC roles differ from
the business direction: the AN would provide the notification endpoint as an
asset, while the AG would consume that endpoint to POST the invitation. For the
subsequent project-data exchange the AG becomes the provider and the AN the
consumer.

The `tractusx-edc` adapter remains intentionally not configured. Enabling that
transport before connector identity, discovery, policy and transfer handling
exist must fail explicitly rather than silently falling back to the local mock.

## Exchange contract

The external boundary uses only:

- `ExternalServiceRequest`
- `ExternalServiceResponse`
- `ExternalAlternativeProposal`
- `ExternalResourceRequirement`
- `ExternalProjectInvitation`
- `ExternalProjectInvitationResponse`
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
is currently used by `resolveDataspaceParticipant`; BPNL/DID discovery and
connector identifiers are intentionally not implemented.

The service-coordination policy purpose is centralized as:

```text
construction-service-coordination
```

Project invitations use the dedicated project-membership policy template and
carry its version/snapshot so that the later EDC adapter can translate the
same domain decision into connector policies.

The mappers enforce data minimality. They do not export concrete resources,
resource bookings, employee or equipment identities, internal projects,
costs, or internal notes as part of a project invitation.

## Current operations

| Operation | Direction | Current implementation |
|---|---|---|
| Project Invitation | AG → AN | invitation package → local REST/mock transport → AN inbox |
| Invitation Response | AN → AG | accept/reject → local response/outbox → membership update |
| Project Data Publication | AG → active AN | separate publication flow; only after membership activation |
| Service Request | AG → AN | `publishServiceRequest()` → REST adapter → local hub |
| Service Response | AN → AG | `publishServiceResponse()` → REST adapter → local hub |
| Snapshot/details retrieval | AN → AG | Existing protected REST endpoint |
| Internal availability check | AN | Local domain operation |

The German UI may continue to use `Projekteinladung`, `Leistungsanfrage` and
`Leistungsantwort`. Those labels are not part of the technical exchange
contract.

## Audit

Outbound exchanges create audit/outbox state before delivery. The service
request/response exchange uses:

```text
CREATED → PUBLISHED
```

Transport failures result in:

```text
CREATED → FAILED
```

Project invitations and invitation responses use their existing delivery and
outbox state so retries do not create additional project memberships. Message
and idempotency identifiers remain the technical correlation mechanism.

The audit rows store exchange metadata and technical external references only.
Payloads are not duplicated into the generic audit table.

Inbound processing is centralized in the corresponding exchange/domain
handlers. These validate metadata, apply message-ID/idempotency handling, call
the domain handler, and record success or failure.

## Explicitly out of scope for the current mock

- Real EDC asset registration
- Real connector policy enforcement
- Contract definitions
- Catalog discovery
- Contract negotiation
- EDRs
- Transfer processes
- Data-plane communication
- BPNL/DID discovery
- Digital Twin Registry
- AAS
- Legacy route or database renaming

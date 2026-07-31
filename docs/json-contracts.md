# JSON Message Contracts

Canonical JSON examples for all TaktKoord message types. All examples conform to the OpenAPI schemas defined in `lib/api-spec/openapi.yaml`.

---

## Example 1 — Takt-request notification (GU → NU)

`messageType: TAKT_REQUEST_NOTIFICATION`

The notification contains only references and metadata. No full Takt details are included. The NU uses `detailsRef` to pull the released Takt data separately.

```json
{
  "messageId": "MSG-2026-000001",
  "schemaVersion": "1.0",
  "messageType": "TAKT_REQUEST_NOTIFICATION",
  "senderOrgId": "GU-001",
  "recipientOrgId": "NU-017",
  "correlationId": "REQ-2026-0042",
  "causationId": null,
  "createdAt": "2026-07-31T09:00:00Z",
  "expiresAt": "2026-08-07T09:00:00Z",
  "status": "DELIVERED",
  "payload": {
    "taktRequestId": "REQ-2026-0042",
    "projectReference": "PROJ-2026-HH-001",
    "taktReference": "TAKT-A3-ELT",
    "taktVersion": 1,
    "responseRequiredBy": "2026-08-05T17:00:00Z",
    "detailsRef": "/api/delegations/f4aa8c5a-ebb3-4e4e-94d0-100011aa6bf7",
    "subject": "Taktanfrage: Elektroinstallation Zone A3",
    "message": "Bitte prüfen Sie den Termin und bestätigen Sie bis zum 05.08."
  }
}
```

**What this payload must NOT contain:**
- Full Takt schedule or list of all project Takte
- Data of other NU organisations
- Full Leistungsverzeichnis or BIM model
- Internal GU comments
- NU resource data

---

## Example 2 — Confirmation (NU → GU)

`messageType: TAKT_RESPONSE_SUBMITTED`, `decision: ACCEPTED`

The `correlationId` matches the original notification. The `causationId` references the notification's `messageId`.

```json
{
  "messageId": "MSG-2026-000002",
  "schemaVersion": "1.0",
  "messageType": "TAKT_RESPONSE_SUBMITTED",
  "senderOrgId": "NU-017",
  "recipientOrgId": "GU-001",
  "correlationId": "REQ-2026-0042",
  "causationId": "MSG-2026-000001",
  "createdAt": "2026-08-03T14:22:00Z",
  "expiresAt": null,
  "status": "DELIVERED",
  "payload": {
    "taktRequestId": "REQ-2026-0042",
    "decision": "ACCEPTED",
    "acceptedTimeWindow": {
      "start": "2026-09-01T07:00:00Z",
      "end": "2026-09-05T16:00:00Z"
    },
    "comment": "Termin wird wie geplant ausgeführt."
  }
}
```

---

## Example 3 — Alternative proposals (NU → GU)

`messageType: TAKT_RESPONSE_SUBMITTED`, `decision: ALTERNATIVES_PROPOSED`

Two ranked alternatives with different crew sizes and conditions. No internal NU project or resource names are included.

```json
{
  "messageId": "MSG-2026-000003",
  "schemaVersion": "1.0",
  "messageType": "TAKT_RESPONSE_SUBMITTED",
  "senderOrgId": "NU-017",
  "recipientOrgId": "GU-001",
  "correlationId": "REQ-2026-0042",
  "causationId": "MSG-2026-000001",
  "createdAt": "2026-08-04T10:05:00Z",
  "expiresAt": null,
  "status": "DELIVERED",
  "payload": {
    "taktRequestId": "REQ-2026-0042",
    "decision": "ALTERNATIVES_PROPOSED",
    "reasonCode": "RESOURCE_CONFLICT",
    "comment": "Im angefragten Zeitraum besteht ein Ressourcenkonflikt. Zwei Alternativtermine werden vorgeschlagen.",
    "alternatives": [
      {
        "alternativeId": "ALT-001",
        "rank": 1,
        "timeWindow": {
          "start": "2026-09-08T07:00:00Z",
          "end": "2026-09-12T16:00:00Z"
        },
        "crewSize": 4,
        "conditions": ["Zugang via Südeingang erforderlich", "Kernarbeitszeit 07:00–15:00 Uhr"]
      },
      {
        "alternativeId": "ALT-002",
        "rank": 2,
        "timeWindow": {
          "start": "2026-09-15T07:00:00Z",
          "end": "2026-09-19T16:00:00Z"
        },
        "crewSize": 6,
        "conditions": ["Vollständige Kolonne verfügbar", "Keine Einschränkungen"]
      }
    ]
  }
}
```

**Note:** The payload contains no information about which internal project or client caused the conflict.

---

## Example 4 — Rejection (NU → GU)

`messageType: TAKT_RESPONSE_SUBMITTED`, `decision: REJECTED`

Generic reason code and optional next-available date. No information about which other project blocks the capacity.

This example shows a **separate** TaktRequest (`correlationId: REQ-2026-0043`). The `causationId` references the notification message that belongs to the same coordination chain (`MSG-2026-000009`), not a message from a different request.

```json
{
  "messageId": "MSG-2026-000010",
  "schemaVersion": "1.0",
  "messageType": "TAKT_RESPONSE_SUBMITTED",
  "senderOrgId": "NU-017",
  "recipientOrgId": "GU-001",
  "correlationId": "REQ-2026-0043",
  "causationId": "MSG-2026-000009",
  "createdAt": "2026-08-05T08:30:00Z",
  "expiresAt": null,
  "status": "DELIVERED",
  "payload": {
    "taktRequestId": "REQ-2026-0043",
    "decision": "REJECTED",
    "reasonCode": "NO_CAPACITY",
    "comment": "Im gesamten angefragten Zeitraum steht keine ausreichende Kapazität zur Verfügung.",
    "nextAvailableDate": "2026-10-01"
  }
}
```

**Note:** The `nextAvailableDate` indicates the earliest possible availability without revealing why capacity is unavailable or which other party has booked it.

---

## Schema validation notes

All four examples above are validated against the following OpenAPI schemas in `lib/api-spec/openapi.yaml`:

- `MessageEnvelope` — envelope structure, required fields, enum values
- `DataspaceMessageType` — `messageType` enum
- `DataspaceMessageStatus` — `status` enum
- `TaktRequestNotificationPayload` — Example 1 payload
- `TaktResponsePayload` — Examples 2–4 payload
- `TaktDecision` — `decision` enum
- `TaktResponseReasonCode` — `reasonCode` enum
- `TaktResponseAlternative` — alternatives array items
- `TimeWindow` — `acceptedTimeWindow` and alternative `timeWindow` fields

Zod schemas generated from these OpenAPI definitions are available in `lib/api-zod/src/generated/`.

### Key constraints checked

| Constraint                          | Rule                                    |
| ----------------------------------- | --------------------------------------- |
| `messageId`                         | Non-empty string                        |
| `schemaVersion`                     | Matches pattern `\d+\.\d+` (e.g. `1.0`) |
| `createdAt`, `expiresAt`            | ISO 8601 date-time                      |
| `taktVersion`                       | Integer ≥ 1                             |
| `alternatives`                      | Maximum 3 items                         |
| `crewSize`                          | Integer ≥ 1                             |
| `comment`                           | Maximum 2000 characters                 |
| `nextAvailableDate`                 | ISO 8601 date (`YYYY-MM-DD`)            |
| Internal NU data                    | Must not appear in any payload          |

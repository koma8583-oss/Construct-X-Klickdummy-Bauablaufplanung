# Message Flow

This document describes the end-to-end coordination flow between Generalunternehmer (GU), Nachunternehmer (NU), and Hub.

---

## Process overview

```
Step 1 — GU sends Takt-request notification
GU → Hub → NU
  messageType: TAKT_REQUEST_NOTIFICATION
  Payload: TaktRequestNotificationPayload
  Contains: reference IDs and detailsRef only — no full Takt data

Step 2 — NU retrieves released Takt details
NU → GU  (direct pull via detailsRef)
  messageType: TAKT_DETAILS_RETRIEVED
  The NU fetches only the data released for them.

Step 3 — NU checks locally
NU (internal)
  The NU checks the Takt against its local resource plan.
  This step is internal and produces no external message.
  Only generic reason codes may leave the NU.

Step 4 — NU sends Takt response
NU → Hub → GU
  messageType: TAKT_RESPONSE_SUBMITTED
  Payload: TaktResponsePayload
  Contains: decision, optional reason code, optional alternatives

Step 5 — GU confirms or requests revision
GU → Hub → NU
  messageType: TAKT_RESPONSE_ACCEPTED  or  TAKT_RESPONSE_REVISION_REQUESTED
```

---

## Message envelope fields

| Field            | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `messageId`      | Unique identifier for this single message.                                  |
| `schemaVersion`  | Version of the message schema in `major.minor` format (e.g. `1.0`). Enables future schema evolution without breaking existing consumers. |
| `messageType`    | Typed message kind — see `DataspaceMessageType` enum.                       |
| `senderOrgId`    | Organisation ID of the sender.                                              |
| `recipientOrgId` | Organisation ID of the intended recipient.                                  |
| `correlationId`  | Ties all messages of one TaktRequest process together. Set on the first notification and copied to every subsequent message in the same process. |
| `causationId`    | References the `messageId` of the message that directly caused this one. Null on the initial notification. |
| `createdAt`      | ISO 8601 UTC timestamp of when the message was created.                     |
| `expiresAt`      | ISO 8601 UTC timestamp of the message's business validity. After this time the response window is closed. |
| `status`         | Technical delivery status only — see below.                                 |
| `payload`        | Typed payload object. Schema depends on `messageType`.                      |

---

## Status vs. decision — important distinction

```
DELIVERED means only that the message was technically delivered to the recipient.

ACCEPTED means that the Nachunternehmer has confirmed the Takt in business terms.
```

`DataspaceMessageStatus` values (`PENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`) describe the **technical transport state** of the message envelope. They are not business decisions.

`TaktDecision` values (`ACCEPTED`, `ALTERNATIVES_PROPOSED`, `REJECTED`) describe the **business outcome** carried in the `TaktResponsePayload`. A message with `status: DELIVERED` and `decision: REJECTED` means: the message arrived, and the NU declined the Takt.

---

## Correlation and causation example

```
Message 1 (GU → NU):
  messageId:      MSG-001
  correlationId:  REQ-2026-0042   ← assigned by GU, identifies the whole TaktRequest
  causationId:    null            ← initial message, no cause

Message 2 (NU → GU):
  messageId:      MSG-002
  correlationId:  REQ-2026-0042   ← same correlation ID
  causationId:    MSG-001         ← caused by the notification
```

---

## Current PoC implementation

In the PoC, messages are stored in the `hub_messages` table and delivered synchronously via REST. The `correlationId` corresponds to the `delegationId`. The Hub provides a read-only message timeline per delegation.

The `MessageEnvelope`, `TaktRequestNotificationPayload`, and `TaktResponsePayload` schemas are defined in the OpenAPI spec and generated as Zod schemas. They are not yet used for actual message routing in the PoC — they define the target contract.

---

## Future migration (EDC)

When the local transport is replaced by EDC:

- Each step above becomes an EDC transfer process or contract-negotiated data pull.
- `messageId`, `correlationId`, and `causationId` remain unchanged.
- JSON payload schemas remain unchanged.
- Digital identities and policy enforcement are added at the transport layer only.
- Domain logic (steps 1–5) is not affected.

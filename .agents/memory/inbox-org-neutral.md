---
name: Inbox org-neutral auth change
description: The message inbox was extended from NU-only to accept both AG and AN organisations.
---

## Change
`requireNuOrg` in `artifacts/api-server/src/routes/messages.ts` was renamed/replaced by `requireOrg` which accepts `orgType === "AG" || orgType === "AN"`. The old name is kept as a deprecated alias.

## Access rules post-change

| Caller | Inbox list (GET /inbox) | Inbox message (GET /inbox/:id) | Mark read (POST /inbox/:id/read) |
|--------|------------------------|-------------------------------|----------------------------------|
| NU (own org) | 200 — own messages | 200 — own message | 200 — own message |
| GU (own org) | 200 — own messages (often empty) | 404 — NU message not found for GU | 403 — RecipientForbiddenError |
| Hub-admin (orgId: null) | 403 | 403 | 403 |
| Foreign NU | 200 — own empty inbox | 404 | 403 |

**Note:** GET /inbox/:id and mark-as-read return different codes for GU:
- GET/:id → 404 (message not in GU's namespace)
- POST/:id/read → 403 (RecipientForbiddenError from transport layer)

## Why
Task 4.8 required delivering TAKT_RESPONSE_SUBMITTED messages to GU's inbox. GU needed to read their own inbox to receive these messages, so the NU-only restriction was lifted.

## How to apply
Tests that previously verified GU gets 403 on the inbox list must be updated to expect 200 (GU reads their own empty inbox). Tests for GET/:id with a NU-owned message should expect 404. Tests for mark-as-read with a NU message should still expect 403.

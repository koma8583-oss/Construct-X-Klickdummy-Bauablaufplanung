---
name: Dataspace policy gate
description: Rules and pitfalls for the T116 dataspace policy gate on GET /takt-requests/:id/details
---

## The rule
`GET /takt-requests/:id/details` checks TWO things when `isAddressedNu` is true:
1. `request.dataPublicationId` must not be null → else 403 LEGACY_NO_PUBLICATION
2. The recipient row must have `status = "ACCEPTED"` AND `policyAcceptedAt IS NOT NULL` → else 403 POLICY_ACCEPTANCE_REQUIRED

**Why:** Both conditions must be satisfied — `status` alone is insufficient.

## Test token pitfall
If a `makeToken(userId, orgId, roles)` helper omits `orgType` from the JWT payload, endpoints that check `user.orgType !== "AN"` return 403 even though the caller IS an AN.

**Fix:** Infer `orgType` from role prefix (`AG_*` → "AG", `AN_*` → "AN") and include it in the JWT payload alongside `hubAdmin: false`.

## Column name
The recipient table column is `policyAcceptedAt` (drizzle) / `policy_accepted_at` (SQL). NOT `acceptedAt`. Passing the wrong field name is silently ignored by drizzle, leaving `policyAcceptedAt = null` → 403.

## Test fixture cleanup order
When a test creates a TaktRequest with `dataPublicationId`, the `takt_requests` row must be deleted BEFORE the `data_publications` row (FK constraint). Use `finally` blocks that track `reqId` and delete the request first.

## Idempotency tests
Hash-based idempotency (same canonical JSON hash → 200, different → 409) requires the retry to send the EXACT same payload as the original. Tests that send a different body with the same decision type still get 409.

## Backfilling existing tests
Any test that creates a TaktRequest via DB insert (direct) or API (POST /api/takt-requests) and then has the NU call `GET /details` must:
1. Look up an existing policy template (3 seed templates exist: PROJECT_COORDINATION_READ_ONLY, TAKT_EXECUTION_USE, EXTENDED_PROJECT_COLLABORATION)
2. Insert a `data_publications` row (status: PUBLISHED, selectedTaktIds: [taktId], policyTemplateId from step 1)
3. Insert a `data_publication_recipients` row (status: ACCEPTED, policyAcceptedAt: now)
4. Set `dataPublicationId` on the TaktRequest (in the values object or POST body)
5. Clean up publication AFTER takt_requests in afterAll

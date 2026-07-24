---
name: TaktKoord backend architecture
description: Session auth, schema layout, route organization, and key decisions for TaktKoord
---

## Auth
- Session-based: `express-session` + `connect-pg-simple` (PostgreSQL session store, table `session` auto-created)
- Password hashing: `bcryptjs` (pure JS, no native build)
- Session stores `{ userId: string, orgId: string }` — orgId is the user's currently active org
- Declared in `express-session` module augmentation in `app.ts`
- `SESSION_SECRET` env var used; falls back to dev string if missing

## Schema (lib/db/src/schema/)
- `users.ts` — users table
- `organizations.ts` — organizations + userOrganizations join (orgTypeEnum: AG|AN, orgRoleEnum: ADMIN|MEMBER)
- `projects.ts` — projects (owned by AG org) + projectContractors join
- `takte.ts` — individual Takt rows with buffer fields (earliestStart, latestEnd)
- `delegations.ts` — delegations + delegationResponses with isWithinBuffer calculation
- `resources.ts` — AN resources + resourceAssignments
- `webhooks.ts` — webhookSubscriptions + webhookEvents

Schema uses `zod/v4` (via drizzle-zod). Routes use plain `zod`.

## Routes (artifacts/api-server/src/routes/)
All mounted at `/api/` prefix in app.ts:
- `auth.ts` — /auth/register, /auth/login, /auth/me, /auth/logout, /auth/switch-org
- `organizations.ts` — /organizations, /organizations/me, /organizations/:id, members sub-routes, /users/me, /users/me PATCH
- `projects.ts` — /projects CRUD + /projects/:id/contractors sub-routes
- `takte.ts` — /projects/:projectId/takte CRUD
- `delegations.ts` — /delegations CRUD + /delegations/:id/responses CRUD with buffer check + webhook dispatch
- `resources.ts` — /resources CRUD + /resource-assignments CRUD
- `webhooks.ts` — /webhooks CRUD + /webhooks/events
- `dashboard.ts` — /dashboard/ag, /dashboard/an

## Webhook Dispatcher
`lib/webhookDispatcher.ts` — fire-and-forget, HMAC-SHA256 signature via `X-TaktKoord-Signature` header, 10s timeout, stores delivery result in webhookEvents table.

**Why session auth, not JWT:** User requested own user management per app, no Clerk. Session cookies work well with the same-origin fetch pattern used in both frontends.

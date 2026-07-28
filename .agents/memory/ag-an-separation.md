---
name: AG/AN App Separation Architecture
description: How the AG-App and AN-App are kept fully isolated with separate sessions, cookies, and API namespaces.
---

## Rule
The two apps must stay fully isolated — separate session cookies, separate API namespaces, no cross-contamination.

## How it works

### Session isolation
- AG-App uses `connect.sid` cookie (Express default)
- AN-App uses `tk_an_sid` cookie
- Both cookies can coexist in the same browser at the same time
- Configured in `artifacts/api-server/src/app.ts`:
  - `app.use('/api/an', anSession, anRouter)` — AN-specific session
  - `app.use('/api', agSession, agRouter)` — AG session

### API namespace separation
- AG routes: `/api/…` (unchanged)
- AN routes: `/api/an/…` (separate Express sub-router)
- AN sub-router in `artifacts/api-server/src/routes/an/index.ts`
- Reuses existing route handlers (delegations, resources, orgs, webhooks) since they filter by `req.session.orgId`
- AN-specific routes: `routes/an/auth.ts`, `routes/an/dashboard.ts`

### Client-side URL rewriting
- `artifacts/an-app/src/main.tsx` installs a `globalThis.fetch` interceptor BEFORE any imports
- Rewrites `/api/X` → `/api/an/X` for all calls that don't already start with `/api/an/`
- This means no generated hook code needs to be changed
- AN auth context calls `/api/an/auth/*` directly (already correct prefix, not rewritten)

### Auth enforcement
- `POST /api/an/auth/login` rejects accounts with `orgType !== 'AN'` with a clear error message
- `GET /api/an/auth/me` verifies DB orgType before returning user data
- AN registration always creates `type: 'AN'` orgs

**Why:** User requirement for truly independent applications where the same person can have one AG account and one AN account and be logged into both simultaneously in the same browser.

**How to apply:** Any new AN-App feature should use existing api-client-react hooks (they get auto-rewritten to `/api/an/`). Any new backend route needed only by AN should be added to `routes/an/index.ts`.

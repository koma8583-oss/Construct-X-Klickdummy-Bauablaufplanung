---
name: JWT Auth Service
description: How the centralized JWT auth service works and key implementation decisions.
---

# JWT Auth Service — TaktKoord

## Architecture
- Auth routes live in the existing api-server, mounted at `/auth-service/*`
- Artifact.toml `paths` includes both `"/api"` and `"/auth-service"` so the proxy routes both to port 8080
- Access token: 15-min JWT, signed with `JWT_SECRET` env var (falls back to dev secret)
- Refresh token: 7-day opaque UUID stored in DB (`refresh_tokens` table) + httpOnly cookie `tk_refresh`

## Token flow
1. Login/Register → returns `{ accessToken, user }` + sets `tk_refresh` httpOnly cookie
2. On app mount → `POST /auth-service/refresh` to restore session from cookie
3. All API requests → `Authorization: Bearer <accessToken>` header (injected by fetch interceptor in each app's `main.tsx`)
4. Backend → `requireJwt` middleware verifies Bearer token, sets `req.user = { userId, orgId, orgType, hubAdmin }`

## Frontend pattern (all three apps)
- `src/lib/auth-token.ts` — module-level `getToken()`/`setToken()` store
- `main.tsx` — fetch interceptor reads `getToken()` at call time and injects `Authorization: Bearer` for `/api/*` calls (not `/auth-service/*`)
- `src/contexts/auth*.tsx` — calls `/auth-service/{login,register,refresh,logout}`; on mount calls refresh to restore session

## AN-App orgType enforcement
- Done in the frontend after login: if `userData.orgType !== "AN"`, throw error and log out
- NOT enforced server-side (auth-service is shared)

## Express req.user typing
- Global `Express.Request` namespace augmentation in `src/types/express.d.ts`
- Must use `export {};` at top to make it a module, then `declare global { namespace Express { interface Request {...} } }`
- The `express-serve-static-core.Request` extends `Express.Request`, so this works in Express v5
- DO NOT use `declare module "express-serve-static-core" { interface Request {...} }` — this approach doesn't work reliably with `types: ["node"]` and `isolatedModules: true`
- DO NOT add `declare namespace Express` as a bare ambient declaration (no import/export) — this corrupts the Express namespace

**Why:** Standard module augmentation on `express-serve-static-core` fails silently when `types: ["node"]` is in tsconfig. The global namespace is the correct and reliable extension point for Express v5.

## lib/db declarations
- After adding new schema files to `lib/db/src/schema/`, run `pnpm exec tsc -p lib/db/tsconfig.json` to regenerate `lib/db/dist/*.d.ts`
- The api-server uses project references (`composite: true` in lib/db tsconfig), so TypeScript reads compiled declarations, not source

## Old session auth cleanup
- Old `routes/auth.ts`, `routes/an/auth.ts`, `routes/hub/auth.ts`, `middlewares/requireAuth.ts` deleted
- Old session middleware (connect-pg-simple + express-session) removed from `app.ts`
- Hub routes: old `hub/auth.ts` router removed from `routes/hub/index.ts`
- AG/AN routes: old auth routers removed from their index files

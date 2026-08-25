---
name: AN API namespace routing
description: AN frontend API calls are rewritten to the /api/an namespace and require matching server mounts.
---

The AN application's fetch interceptor rewrites generic `/api/*` calls to `/api/an/*`; every AN-facing route used by raw fetches must therefore be mounted in the AN sub-router as well as any shared router.

**Why:** A route existing only under the shared `/api` router returns 404 from the AN app even though the frontend source appears to request `/api/...`.

**How to apply:** When adding or debugging an AN endpoint, check the browser/workflow URL after namespace rewriting and mount the organisation-guarded handler under `routes/an/index.ts`.

Router-level ownership guards must also be scoped to that router's URL prefixes. **Why:** A router mounted at `/api` runs an unprefixed `router.use(...)` for every later `/api/*` request, so a legacy AN block can accidentally deny reports or other unrelated handlers. **How to apply:** Guard explicit legacy/canonical path prefixes (for example, request and project subpaths), never every request entering a shared router.
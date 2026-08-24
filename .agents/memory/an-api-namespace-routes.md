---
name: AN API namespace routing
description: AN frontend API calls are rewritten to the /api/an namespace and require matching server mounts.
---

The AN application's fetch interceptor rewrites generic `/api/*` calls to `/api/an/*`; every AN-facing route used by raw fetches must therefore be mounted in the AN sub-router as well as any shared router.

**Why:** A route existing only under the shared `/api` router returns 404 from the AN app even though the frontend source appears to request `/api/...`.

**How to apply:** When adding or debugging an AN endpoint, check the browser/workflow URL after namespace rewriting and mount the organisation-guarded handler under `routes/an/index.ts`.
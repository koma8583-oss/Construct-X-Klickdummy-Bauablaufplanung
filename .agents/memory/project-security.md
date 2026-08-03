---
name: Project endpoint security patterns
description: Ownership check pattern for project routes; soft-delete requirement; internal endpoint token auth
---

## Ownership guard in project routes

`requireProjectOwner(req, res, projectId)` in `routes/projects.ts` — checks `orgType === "AG"` and `agOrgId === caller.orgId`. Returns 403 for non-AG callers, 404 for unknown or cross-tenant projects (never 403 for cross-tenant — avoids leaking existence). All six legacy project endpoints use it.

**Why:** GET/PATCH/DELETE /projects/:id and contractor endpoints had no tenant guard; any AG could access any other AG's data by guessing the UUID.

## Soft-delete requirement

DELETE /projects/:id → sets `status = "ARCHIVED"` (not a physical delete). DELETE /projects/:id/contractors/:anOrgId → sets `assignmentStatus = "INACTIVE"` on ACTIVE rows. Returns 200 with `{ok: true, status}` not 204.

**Why:** Historical TaktRequests reference project and contractor rows by FK; physical deletes orphan them.

## Internal endpoint auth

`/internal/jobs/deadlines/run` (mounted at `/internal`, NOT `/api/internal`) — guarded by `requireInternalToken` middleware reading `INTERNAL_JOB_TOKEN` env var. Uses `crypto.timingSafeEqual` for constant-time comparison. Fail-closed: if env var is not set, all requests are rejected with 401.

**Why:** Prevent unauthorized triggering of deadline evaluation; timing-safe comparison avoids token enumeration.

## Vitest env var pitfall

Vitest `env` section in `defineConfig` does NOT inject into `process.env` (at least in v4). Use `setupFiles: ["./src/__tests__/setup.ts"]` with an explicit `process.env.X = ...` assignment instead. The setup file runs in each worker before test files are imported.

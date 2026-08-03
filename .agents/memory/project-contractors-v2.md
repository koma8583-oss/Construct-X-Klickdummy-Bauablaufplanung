---
name: project_contractors schema v2
description: Extended project_contractors table (Task 9.2) — new columns, new PK, trade-aware unique index, ACTIVE-only TaktRequest guard.
---

## Schema changes (Task 9.2)

Old PK: composite (project_id, an_org_id).
New PK: `id` UUID (gen_random_uuid()).

New columns added via psql migration (all nullable except assignment_status):
- `id` text — new PK
- `trade` text
- `work_package_reference` text
- `assignment_status` enum `project_contractor_status` (PLANNED/ACTIVE/INACTIVE/COMPLETED/CANCELLED), default ACTIVE
- `valid_from` date
- `valid_to` date
- `created_by_user_id` text FK → users(id) ON DELETE SET NULL
- `updated_at` timestamptz

## Unique index

```sql
CREATE UNIQUE INDEX project_contractors_project_an_trade_uniq
  ON project_contractors (project_id, an_org_id, COALESCE(trade, ''), COALESCE(work_package_reference, ''));
```

Same AN can be assigned to the same project for different trades (one row per trade).
Duplicate: same AN + same project + same trade + same work_package_reference.

## TaktRequest guard

`takt-request-snapshot-service.ts` Step 4 now checks both:
1. Contractor row exists for (projectId, nuOrgId)
2. `assignmentStatus === 'ACTIVE'`
Throws `NuNotContractorError` on either failure.

## New routes (artifacts/api-server/src/routes/ag/projects.ts)

Registered at `/api` prefix:
- `GET /ag/projects/overview` — all-projects KPI summary for authenticated AG
- `GET /ag/projects/:projectId/overview` — single-project detail (assignedAn + coordination + recentRequests)
- `GET /ag/projects/:projectId/subcontractors` — list all assignments
- `POST /ag/projects/:projectId/subcontractors` — create assignment (409 on duplicate)
- `PATCH /ag/projects/:projectId/subcontractors/:assignmentId` — update assignment
- `POST /ag/projects/:projectId/subcontractors/:assignmentId/deactivate` — soft-deactivate

**Why:**
- `DELETE` endpoint kept for test backward compat; new soft-delete is via deactivate
- Physical deletion of historically used assignments is prohibited (set INACTIVE/CANCELLED instead)

## Join pattern for project-level request queries

`takt_requests` has NO `projectId` column. Always join:
```sql
takt_requests JOIN takte ON takt_requests.takt_id = takte.id
```
to get `takte.project_id`.

# Resource Planning — Architecture Analysis & Target Design

_Document created by Task 4.1. No database, API, or UI changes were made here._

---

## 1. Existing Resource Model

### 1.1 `resources` table (`lib/db/src/schema/resources.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | `crypto.randomUUID()` |
| `anOrgId` | `text` FK → `organizations.id` | ON DELETE CASCADE |
| `type` | `resource_type` enum | `EMPLOYEE \| EQUIPMENT \| MACHINE \| OTHER` |
| `name` | `text` NOT NULL | |
| `qualification` | `text` nullable | Free-text, singular — predates the typed `qualifications` array |
| `dailyCapacityHours` | `doublePrecision` nullable | Coarse capacity — predates typed `capacity`/`capacityUnit` |
| `color` | `text` nullable | UI display hint |
| `createdAt` | `timestamptz` NOT NULL DEFAULT NOW() | |

**Missing fields (to be added in Task 4.3):** `trade`, `skills`, `qualifications`, `capacity`, `capacityUnit`, `calendarId`, `active`, `updatedAt`.

**Missing type:** `CREW` — to be added to the `resource_type` enum in Task 4.3.

### 1.2 `resource_assignments` table

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | `crypto.randomUUID()` |
| `resourceId` | `text` FK → `resources.id` | ON DELETE CASCADE |
| `delegationId` | `text` FK → `delegations.id` | ON DELETE CASCADE — **hard-coupled to delegation workflow** |
| `fromDate` | `date` mode "string" | Date-only, not timestamp |
| `toDate` | `date` mode "string" | Date-only, not timestamp |
| `note` | `text` nullable | |
| `createdAt` | `timestamptz` | |

**Assessment:** `resource_assignments` is tightly coupled to the legacy delegation workflow and is not suitable for multi-project resource planning. It must be **retained** for backward compatibility (existing delegation views depend on it) but is superseded by `resource_bookings` for all new coordination flows.

### 1.3 Relationship summary

```
organizations (AN)
    │
    ├─ resources (many)
    │       │
    │       └─ resource_assignments (many) ──→ delegations
    │
    ├─ nu_local_projects (many) [Task 4.2 — new]
    │
    └─ resource_bookings (many) [Task 4.2 — new]
           ├─ resourceId → resources
           └─ localProjectId → nu_local_projects (nullable)
```

---

## 2. Existing REST Endpoints

All resource endpoints are in `artifacts/api-server/src/routes/resources.ts`.

| Method | Path | Auth | Org Scoping |
|---|---|---|---|
| `GET` | `/resources` | JWT | `WHERE anOrgId = req.user.orgId` ✅ |
| `POST` | `/resources` | JWT | inserts with `anOrgId = req.user.orgId` ✅ |
| `PATCH` | `/resources/:resourceId` | JWT | **No org ownership check** ⚠️ |
| `DELETE` | `/resources/:resourceId` | JWT | **No org ownership check** ⚠️ |
| `GET` | `/resource-assignments` | JWT | **No org scope — joins resources + delegations but no anOrgId filter** ⚠️ |
| `POST` | `/resource-assignments` | JWT | No org validation — accepts any resourceId + delegationId ⚠️ |
| `PATCH` | `/resource-assignments/:assignmentId` | JWT | **No org ownership check** ⚠️ |
| `DELETE` | `/resource-assignments/:assignmentId` | JWT | **No org ownership check** ⚠️ |

### Security gaps identified

1. **`PATCH /resources/:resourceId`** — no check that the resource belongs to the caller's org. Any authenticated user can mutate any resource by guessing the ID.
2. **`DELETE /resources/:resourceId`** — same issue; any authenticated user can delete any resource.
3. **`GET /resource-assignments`** — no `anOrgId` filter; returns cross-org data if both resourceId + delegationId are known.
4. **`POST /resource-assignments`** — no validation that `resourceId` belongs to the caller's org.
5. **No GU/hub-admin guard on any resource endpoint** — a GU user can call `GET /resources` and receive all resources of their own org (since their `orgId` is an AG org, the result is empty, but the endpoint does not reject them). More critically, if an AG org ever has a resource row (data error), it would be returned. The endpoint should explicitly require `orgType === "AN"`.

These gaps must be closed before `resource_bookings` are exposed via API (Task 4.x).

---

## 3. Gantt / Calendar Data

The AN-app has a Gantt view (`artifacts/an-app/src/pages/resources.tsx`) that renders resources with their assignments against the delegation timeline. The data source is `GET /resource-assignments` with `fromDate`/`toDate` range filters.

No calendar abstraction (working hours, public holidays, shift patterns) exists in the current model. The `calendarId` field (to be added in Task 4.3) is a placeholder for future integration — no calendar engine is implemented.

---

## 4. Conflict / Overlap Logic

No server-side conflict detection exists. The AN-app renders overlapping assignments visually but does not prevent them via API validation. `AvailabilityCheck`, `AvailabilityConflict`, and `AvailabilityAlternative` are **not yet implemented** — documented below as target models.

---

## 5. Seed Data

`scripts/src/seed-takt-data.ts` seeds `takt_requests`, snapshots, responses, and alternatives but **does not seed** resources or resource assignments. Existing resources are created manually through the AN-app UI.

---

## 6. GU / NU Permissions Summary

| Actor | Current Behaviour | Required Behaviour |
|---|---|---|
| NU (AN org) | Can read/write own resources | ✅ correct |
| GU (AG org) | No explicit rejection — reads return empty (own orgId is AG) | Should receive `403` |
| Hub admin | No explicit rejection | Should receive `403` |
| Different NU | `GET /resources` scoped to caller orgId — safe ✅ | Maintain |
| Any caller on `PATCH/DELETE` | **No org ownership check** ⚠️ | Must add ownership check |

---

## 7. Target Models (to be implemented in subsequent tasks)

### 7.1 `NuLocalProject`

> A project record managed internally by the NU. Never exposed to GU or Hub.
> Used to book resources against work that spans multiple GU relationships.

| Field | Type | Constraints |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()` |
| `nuOrgId` | text FK → organizations | NOT NULL |
| `localProjectCode` | text | NOT NULL; UNIQUE within org |
| `displayName` | text | NOT NULL |
| `customerAlias` | text | Nullable; anonymised alias (e.g. "Kunde A") — never sent externally |
| `startDate` | date | Nullable |
| `endDate` | date | Nullable; must be ≥ startDate when both set |
| `status` | enum | `PLANNED \| ACTIVE \| COMPLETED \| CANCELLED` |
| `createdAt` | timestamptz | NOT NULL DEFAULT NOW() |
| `updatedAt` | timestamptz | NOT NULL DEFAULT NOW() |

### 7.2 `Resource` (extended — Task 4.3)

Extends the existing `resources` table. New fields are additive (non-breaking):

| New Field | Type | Notes |
|---|---|---|
| `trade` | text nullable | e.g. `DRYWALL`, `MEP`, `CONCRETE` |
| `skills` | jsonb | Default `[]`; deduplicated string list |
| `qualifications` | jsonb | Default `[]`; replaces free-text `qualification` long-term |
| `capacity` | doublePrecision | Must be > 0 when set |
| `capacityUnit` | enum | `PERSONS \| UNITS \| HOURS_PER_DAY \| PERCENT` |
| `calendarId` | text nullable | Placeholder; no calendar engine yet |
| `active` | boolean | NOT NULL DEFAULT true |
| `updatedAt` | timestamptz | NOT NULL DEFAULT NOW() |

New enum value for `resource_type`: `CREW`.

Retained for backward compatibility: `qualification` (text), `dailyCapacityHours` (doublePrecision), `color`.

### 7.3 `ResourceBooking`

> General-purpose booking record. Replaces `resource_assignments` for new
> coordination flows. Supports multi-project planning across multiple GUs.

| Field | Type | Constraints |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()` |
| `nuOrgId` | text FK → organizations | NOT NULL; ensures org isolation |
| `resourceId` | text FK → resources | NOT NULL; must share nuOrgId |
| `localProjectId` | text FK → nu_local_projects | Nullable; required when sourceType = LOCAL_PROJECT |
| `sourceType` | enum | `LOCAL_PROJECT \| TAKT_REQUEST \| MANUAL_BLOCK \| ABSENCE \| MAINTENANCE` |
| `sourceReferenceId` | text | Nullable; e.g. taktRequestId — no FK to allow polymorphism |
| `startAt` | timestamptz | NOT NULL |
| `endAt` | timestamptz | NOT NULL; must be after startAt |
| `utilizationPercent` | integer | NOT NULL DEFAULT 100; range 1–100 |
| `status` | enum | `TENTATIVE \| CONFIRMED \| CANCELLED` |
| `note` | text | Nullable |
| `createdAt` | timestamptz | NOT NULL DEFAULT NOW() |
| `updatedAt` | timestamptz | NOT NULL DEFAULT NOW() |

### 7.4 `AvailabilityCheck` (future — not implemented)

Represents a server-side availability assessment triggered when a NU reviews a TaktRequest.

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `nuOrgId` | text FK | |
| `taktRequestId` | text FK | |
| `status` | enum | `PENDING \| COMPLETE \| FAILED` |
| `result` | enum | `AVAILABLE \| CONFLICT \| PARTIAL \| UNAVAILABLE` |
| `internalResultPayload` | jsonb | Full conflict detail — never sent externally |
| `publicResultPayload` | jsonb | Redacted: only result code, approved windows, crewSize, conditions |
| `checkedAt` | timestamptz | |
| `createdByUserId` | text FK | |
| `createdAt` | timestamptz | |

`AvailabilityConflict` and `AvailabilityAlternative` are child records of `AvailabilityCheck` and will be defined when the conflict detection service is built.

---

## 8. Existing Model Assessment

### Tables that can be reused

| Table | Reuse Decision | Notes |
|---|---|---|
| `resources` | ✅ Extend in place | Add CREW, new fields; keep old fields |
| `resource_assignments` | ✅ Keep untouched | Required for legacy delegation views |

### Tables to add

| Table | Task |
|---|---|
| `nu_local_projects` | 4.2 |
| `resource_bookings` | 4.2 |

### Fields to add to `resources`

`trade`, `skills`, `qualifications`, `capacity`, `capacityUnit`, `calendarId`, `active`, `updatedAt` (Task 4.3).

### Delegation coupling

`resource_assignments.delegationId` is a hard FK to `delegations`. This makes it impossible to use `resource_assignments` for bookings against TaktRequests or local projects (different FK target). The new `resource_bookings.sourceReferenceId` uses a nullable plain-text reference ID to support polymorphic sources without a hard FK.

### Local projects from other GUs

The NU uses `customerAlias` (e.g. "Kunde A") to anonymise GU identity in local project records. `displayName` is the NU's own internal label. Neither field is transmitted in TaktRequest snapshots or responses.

### Compatible endpoints

All existing endpoints under `/resources` and `/resource-assignments` must remain functional. `resource_bookings` will be accessed through new endpoints added in a later task.

---

## 9. Data Sovereignty Rules (Binding)

The following rules govern all future implementation decisions:

1. **NU resources are visible only within their own NU organisation.** `anOrgId` scope must be enforced on every read and write.
2. **GU users receive `403` on all NU resource endpoints.** An explicit `orgType === "AN"` check must be added.
3. **Hub admins receive `403` on all NU resource endpoints.**
4. **Resources of other NU organisations are never visible.** Cross-org reads are prevented by the `anOrgId` filter; cross-org writes are prevented by ownership checks on PATCH/DELETE.
5. **Internal conflicts are never transmitted in TaktRequest responses.** `internalResultPayload` from `AvailabilityCheck` stays local; only `publicResultPayload` is sent.
6. **Other NU projects are never named externally.** `customerAlias` provides anonymisation; `displayName` never leaves the NU's own API surface.
7. **Internal costs and priorities remain local.** No cost or priority field is included in snapshot payloads or TaktRequest notification payloads.
8. **Only explicitly released results are transmitted externally.** The NU response carries only: `ACCEPTED \| ALTERNATIVES_PROPOSED \| REJECTED`, a generic `reasonCode`, approved time windows, optional crew size, and general conditions.

---

## 10. Components to Replace or Extend

| Component | Action | Reason |
|---|---|---|
| `resource_assignments` | Keep; eventually supersede with `resource_bookings` | Delegation coupling limits reuse |
| `PATCH/DELETE /resources/:id` | Add org ownership check | Security gap |
| `GET /resource-assignments` | Add `anOrgId` filter via resource join | Security gap |
| `POST /resource-assignments` | Validate resource org matches caller | Security gap |
| Resource endpoints | Add `orgType === "AN"` guard | Currently accepts GU and hub tokens |
| `qualification` (text) | Keep; long-term retire in favour of `qualifications` (jsonb) | Backward compat |
| `dailyCapacityHours` | Keep; long-term consolidate into `capacity`/`capacityUnit` | Backward compat |

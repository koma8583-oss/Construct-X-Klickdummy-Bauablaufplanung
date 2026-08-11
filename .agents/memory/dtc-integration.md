---
name: DTC resource planning integration
description: Semantic alignment of AN resource model to DTC-Ontology v2 classes — schema, routing, check-service, and UI changes.
---

## What was done

DTC (Digital Twin Construction Ontology v2) integration added to the AN resource-planning module.

**Why:** Provides semantic alignment of AN resource types to standard DTC class URIs, enabling interoperability with BIM/EDC-based systems without breaking existing data or adding RDF/SPARQL.

## Schema changes (non-destructive)

`resource_types` table: 4 new columns (all nullable, added via `ALTER TABLE … ADD COLUMN IF NOT EXISTS`):
- `code TEXT` — short internal code (e.g. "LAB-DRYWALL")
- `dtc_class TEXT` — full DTC v2 URI
- `classification_system TEXT`
- `classification_code TEXT`

`resource_bookings` table:
- `resource_id` changed from NOT NULL → nullable (supports type-level capacity bookings)
- `resource_type_id TEXT FK → resource_types.id ON DELETE SET NULL` (added)
- `quantity INTEGER` (added — units consumed by type-level booking)

Drizzle schema files updated to match. No columns removed.

## DTC class constants (4 values)

| Key | URI suffix | Legacy category |
|-----|-----------|-----------------|
| WORKER | `#AsPlannedWorker` | PERSONNEL |
| WORKER_CREW | `#AsPlannedWorkerCrew` | CREW |
| EQUIPMENT | `#AsPlannedEquipment` | EQUIPMENT |
| TEMPORARY_EQUIPMENT | `#AsPlannedTemporaryEquipment` | MACHINE |

Base: `https://dtc-ontology.cms.ed.tum.de/ontology/v2`

`DTC_CLASS_TO_CATEGORY` mapping lives in `artifacts/api-server/src/routes/nu.ts`; same mapping exported from `lib/api-client-react/src/resource-types.ts` as `DTC_TO_CATEGORY` / `CATEGORY_TO_DTC` / `DTC_CLASSES` / `DTC_CLASS_LABELS`.

## Availability check service — two-path logic

`executeCheckRules()` now has two paths (in `availability-check-service.ts`):
1. **DTC path** (new): fires when `takt_request_resource_requirements` has rows with `resourceTypeId` set. Checks `totalCapacity(RT) - usedCapacity(RT) >= requiredCapacity` per requirement. Type-level bookings use `quantity`; resource-level bookings use `capacity × utilizationPercent / 100`.
2. **Legacy path**: snapshot-based type classification (CREW/EQUIPMENT/EMPLOYEE/MACHINE). Unchanged. Fires when no DTC requirements exist.

`generateAlternatives()` / `toPublicAlternative()` still used by both paths.

## API route changes (nu.ts)

Resource-types POST/PATCH: accept `dtcClass`, `code`, `classificationSystem`, `classificationCode`. Auto-derive `category` from `dtcClass` when provided. Validates against `VALID_DTC_CLASSES` list.

Resource-bookings POST: `resourceId` now optional. Business rule: at least one of `resourceId` or `resourceTypeId` required. `quantity` accepted. If `resourceId` provided and `resourceTypeId` not, auto-fills `resourceTypeId` from `resource.resourceTypeId`.

Resources POST: `type` is now optional; derived from linked ResourceType's category when not supplied. Default: "EMPLOYEE". Logic: `CAT_TO_TYPE` map in route.

## AN-App UI (resources.tsx)

ResourceTypeDialog: category/qualification/defaultDailyCapacity fields removed. Replaced with DTC class dropdown (4 German-labelled options) + optional code input.

ResourceDialog: `type` select removed; `resourceTypeId` made required with warning when no types exist. `capacity` field added (numeric units); `qualification` / `dailyCapacityHours` fields removed.

ResourceTypes table: Kategorie → DTC-Klasse column, Qualifikation/Std/Tag replaced by Code column.
Resources table: Typ/Qualifikation/Std/Tag columns removed; Kapazität column added.

## Tests

9 tests in `artifacts/api-server/src/__tests__/dtc-resource-check.test.ts` (fixture prefix `dtc-`). All pass. All 22 existing availability-check-service tests still pass.

## Known constraint

The generated OpenAPI `CreateResourceRequestType` enum is missing CREW and OTHER (only EMPLOYEE, EQUIPMENT, MACHINE). Workaround: `deriveType()` returns a plain string, cast to `any` in the API call. The backend accepts all 5 values. Fix when the openapi spec is regenerated.

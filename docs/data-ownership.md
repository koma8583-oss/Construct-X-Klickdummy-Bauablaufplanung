# Roles and Data Ownership

This document defines the target roles, organisation types, data sovereignty rules, and privacy constraints for TaktKoord.

---

## Organisation types

| Domain term | Current code term | Description                                                              |
| ----------- | ----------------- | ------------------------------------------------------------------------ |
| `GU`        | `AG`              | Generalunternehmer or Generalplaner. Owns the complete Takt schedule.    |
| `NU`        | `AN`              | Nachunternehmer. Owns the local resource plan. Executes Takte.           |
| `HUB`       | `HUB`             | Coordination hub. Holds only messages and transport metadata.            |

The current codebase uses `AG` and `AN` as `orgType` values. These map exactly to `GU` and `NU` as shown above. No code rename is performed in this step.

---

## User roles

### Target roles (future)

| Role              | Organisation | Description                                                                            |
| ----------------- | ------------ | -------------------------------------------------------------------------------------- |
| `GU_ADMIN`        | GU           | Manages projects, Takt schedules, and NU assignments. Full access within their GU org. |
| `GENERAL_PLANNER` | GU           | Creates and edits the Takt plan. A user within the GU organisation, not a separate org. |
| `NU_ADMIN`        | NU           | Manages the NU organisation, resources, and incoming Takt requests.                    |
| `NU_DISPATCHER`   | NU           | Processes and responds to individual Takt requests. Assigns resources.                 |
| `HUB_ADMIN`       | HUB          | Monitors coordination messages and organisations. No access to project or resource data.|

### Current implementation mapping

The current system uses a simplified role model:

- Any user belonging to an `AG`-type org acts as a GU user (equivalent to `GU_ADMIN` + `GENERAL_PLANNER`).
- Any user belonging to an `AN`-type org acts as a NU user (equivalent to `NU_ADMIN` + `NU_DISPATCHER`).
- Hub admins are flagged via `hubAdmin: true` in the JWT claim.

The detailed role distinction (`GU_ADMIN` vs `GENERAL_PLANNER`, `NU_ADMIN` vs `NU_DISPATCHER`) is planned for a later iteration.

---

## Data ownership table

| Data object                       | Owner | GU visible      | NU visible                  | Hub visible        |
| --------------------------------- | ----- | --------------- | --------------------------- | ------------------ |
| Complete Takt schedule            | GU    | Yes             | No                          | No                 |
| Released Takt snapshot            | GU    | Yes             | Only the addressed NU       | No                 |
| Takt-request notification         | GU    | Yes             | Only the addressed NU       | Small payload only |
| Complete resource plan            | NU    | No              | Yes (own data only)         | No                 |
| Internal conflict analysis        | NU    | No              | Yes                         | No                 |
| Reduced Takt response             | NU    | Yes             | Yes                         | Small payload only |
| Other projects of the NU          | NU    | No              | Yes (own data only)         | No                 |
| Employee and equipment details    | NU    | No              | Yes (own data only)         | No                 |

---

## Takt field classification

Every column in the `takte` database table is classified as either **GU-internal** (never leaves the GU) or **AN-visible via snapshot** (included in the `TaktRequestSnapshotPayload` released to the addressed NU).

The classification is enforced technically by the **whitelist principle** in `buildTaktRequestSnapshot()` (`artifacts/api-server/src/lib/takt-request-snapshot-service.ts`): only fields explicitly copied into the snapshot payload are released. Any field not referenced in that function is excluded automatically — no blacklist required.

### AN-visible fields (released in TaktRequestSnapshot)

| `takte` column      | Snapshot field              | Notes                                    |
| ------------------- | --------------------------- | ---------------------------------------- |
| `gewerk`            | `trade`                     | Trade / Gewerk                           |
| `takt_bezeichnung`  | `workPackage`               | Work package name                        |
| `zone`              | `location.zone`             | Physical zone; building/storey reserved  |
| `planned_start`     | `plannedTimeWindow.start`   | Date-only ISO string                     |
| `planned_end`       | `plannedTimeWindow.end`     | Date-only ISO string                     |
| `earliest_start`    | `bufferTimeWindow.earliestStart` | Only included when non-null         |
| `latest_end`        | `bufferTimeWindow.latestEnd`     | Only included when non-null         |
| `description`       | `requiredOutput`            | Free-text work-scope description         |
| `required_resources`| `resourceRequirements[].notes` | Wrapped as `{ resourceType: "CREW", notes }` |
| `lv_reference`      | `documentReferences.lvReference` | Document identifier only            |
| `bim_reference`     | `documentReferences.bimReference` | Document identifier only           |
| *(derived)*         | `predecessors[]`            | From `takt_dependencies`                 |
| *(derived)*         | `successors[]`              | From `takt_dependencies`                 |

### GU-internal fields (permanently excluded from snapshot)

These fields are stored in the `takte` table and visible only to the owning GU organisation. They are **never** included in a `TaktRequestSnapshot` and therefore never reach an NU.

| `takte` column          | UI label             | Type                    | Description                                   |
| ----------------------- | -------------------- | ----------------------- | --------------------------------------------- |
| `internal_note`         | Interne Notiz        | free text               | Internal notes for the GU planning team       |
| `cost_estimate`         | Kostenschätzung      | free text               | Internal budget or cost estimate              |
| `procurement_priority`  | Vergabepriorität     | enum: HIGH/MEDIUM/LOW   | Internal priority for procurement scheduling  |
| `risk_classification`   | Risikoklasse         | enum: A/B/C             | Internal risk classification of the Takt      |

Additionally, the following scheduling and status columns are GU-internal (not in snapshot):

| `takte` column     | Notes                                              |
| ------------------ | -------------------------------------------------- |
| `status`           | Workflow status (GEPLANT/VERGEBEN/…) — GU-internal |
| `lifecycle_status` | Coordination lifecycle — GU-internal               |
| `version`          | Takt version counter — GU-internal                 |
| `project_id`       | Project FK — never released                        |
| `created_at`       | Internal audit timestamp                           |
| `updated_at`       | Internal audit timestamp                           |

### How exclusion is enforced

`buildTaktRequestSnapshot()` constructs the payload by **explicit field assignment only**. The full `Takt` database row is passed as an argument but never spread (`...takt`) into the output. Every field in the snapshot must be mentioned by name. This means:

- Adding a new column to `takte` does **not** automatically expose it to NUs.
- To release a new field to NUs, it must be **explicitly added** to `buildTaktRequestSnapshot()` and documented in the AN-visible table above.
- To keep a field GU-internal, no code change is required — omission is the default.

---

## Information that must never leave the NU

The following information must never appear in any response sent to the GU or in any Hub message:

- Name of another Generalunternehmer or client
- Name of another project
- Local project ID
- Employee name
- Employee ID
- Internal resource name or identifier
- Internal cost figures
- Internal priorities
- Complete conflict list
- Full internal capacity or utilisation plan

### Example field names that must not be transmitted externally

```
customerName
customerId
otherGuName
otherProjectName
localProjectId
employeeName
employeeId
resourceName
internalCost
internalPriority
internalConflicts
```

A Takt response may only contain generic reason codes (e.g. `RESOURCE_CONFLICT`, `NO_CAPACITY`) and availability windows — never the root cause in internal terms.

---

## Principle for external responses

The Nachunternehmer transmits to the Generalunternehmer only the necessary business result. There are exactly three possible outcomes:

1. **Takt is possible** — the NU accepts the requested time window.
2. **Takt is possible with alternatives** — the NU cannot fulfil the requested window but proposes up to three alternative time windows.
3. **Takt is not possible** — the NU rejects the request.

Optionally, a generic conflict reason code may be included (e.g. `RESOURCE_CONFLICT`, `NO_CAPACITY`, `QUALIFICATION_MISSING`). This reason code must be generic — it describes the category of the problem, not the internal root cause.

The underlying internal resource and conflict analysis remains exclusively with the Nachunternehmer and is never transmitted.

---

## Data flow rules

1. The GU sends only a notification with a reference — no full Takt details in the push.
2. The NU pulls the released Takt details explicitly and stores them locally.
3. The NU performs the availability check locally and does not transmit the result beyond a generic reason code.
4. The Hub routes messages but does not store full project or resource data.
5. All external responses use the minimum necessary payload.

---

## Project-scoped AN assignment rules

An AN may be assigned to multiple projects. However, the assignment is always project-specific — not global per AG.

### Rules

1. A GU may only assign ANs to a project that they own (enforced via `project.agOrgId = jwt.orgId`).
2. Only ANs with `assignmentStatus = ACTIVE` may be selected when creating a TaktRequest.
3. When a GU creates a TaktRequest, the backend verifies the NU is an ACTIVE contractor for that project (enforced in `takt-request-snapshot-service.ts`).
4. The GU may view all AN assignments for their own projects. They may NOT view another GU's project assignments.
5. Historical assignments (INACTIVE/CANCELLED) are preserved — no physical deletion.

### Data visible to the GU per project

| Field | Visible to GU |
|---|---|
| AN name | Yes |
| Trade / Gewerk | Yes |
| Work package reference | Yes |
| Assignment status | Yes |
| Validity period | Yes |
| Coordination KPIs (request counts, acceptance rates) | Yes — project-scoped only |
| Other projects of the AN | **No** |
| Other GU clients of the AN | **No** |
| AN-internal project codes | **No** |
| Resource bookings | **No** |
| Employee/equipment names | **No** |
| Internal conflict analysis | **No** |
| Internal costs | **No** |
| Internal priorities | **No** |

---

## Planned extensions (not in PoC)

- Per-field access policies enforced at the transport layer via EDC
- Verifiable Credentials per organisation for identity and authorisation
- Fine-grained GU user roles (`GU_ADMIN` vs `GENERAL_PLANNER`) with field-level write permissions

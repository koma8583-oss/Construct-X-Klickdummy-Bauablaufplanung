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

## Data flow rules

1. The GU sends only a notification with a reference — no full Takt details in the push.
2. The NU pulls the released Takt details explicitly and stores them locally.
3. The NU performs the availability check locally and does not transmit the result beyond a generic reason code.
4. The Hub routes messages but does not store full project or resource data.
5. All external responses use the minimum necessary payload.

---

## Planned extensions (not in PoC)

- Formal `TaktRequestSnapshot` — immutable copy of released Takt data at request time
- `AvailabilityCheck` record — NU-internal, never transmitted
- Per-field access policies enforced at the transport layer via EDC
- Verifiable Credentials per organisation for identity and authorisation

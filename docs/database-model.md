# Database Model — Current State and Target Model

This document describes the existing database schema as implemented, and the planned additions for the federated Takt coordination domain objects.

---

## 1 — Existing Tables

### 1.1 `users`

| Column         | Type              | Constraints              |
| -------------- | ----------------- | ------------------------ |
| `id`           | text (UUID)       | PK, `crypto.randomUUID()` |
| `name`         | text              | NOT NULL                 |
| `email`        | text              | NOT NULL, UNIQUE         |
| `passwordHash` | text              | NOT NULL                 |
| `createdAt`    | timestamptz       | NOT NULL, DEFAULT now()  |

No `updatedAt`. No soft-delete column.

---

### 1.2 `organizations`

| Column         | Type              | Constraints                      |
| -------------- | ----------------- | -------------------------------- |
| `id`           | text (UUID)       | PK                               |
| `name`         | text              | NOT NULL                         |
| `type`         | enum `org_type`   | NOT NULL — values: `AG`, `AN`    |
| `description`  | text              | nullable                         |
| `contactEmail` | text              | nullable                         |
| `createdAt`    | timestamptz       | NOT NULL, DEFAULT now()          |
| `updatedAt`    | timestamptz       | NOT NULL, DEFAULT now(), on update |

**Enum `org_type`**: `AG` (Generalunternehmer), `AN` (Nachunternehmer)

---

### 1.3 `user_organizations`

Junction table for user membership in organisations.

| Column     | Type        | Constraints                       |
| ---------- | ----------- | --------------------------------- |
| `userId`   | text (UUID) | PK part, FK → `users.id` CASCADE  |
| `orgId`    | text (UUID) | PK part, FK → `organizations.id` CASCADE |
| `role`     | enum `org_role` | NOT NULL — values: `ADMIN`, `MEMBER` |
| `joinedAt` | timestamptz | NOT NULL, DEFAULT now()           |

Composite PK: `(userId, orgId)`.

---

### 1.4 `projects`

| Column        | Type                   | Constraints                       |
| ------------- | ---------------------- | --------------------------------- |
| `id`          | text (UUID)            | PK                                |
| `agOrgId`     | text (UUID)            | NOT NULL, FK → `organizations.id` CASCADE |
| `name`        | text                   | NOT NULL                          |
| `description` | text                   | nullable                          |
| `location`    | text                   | nullable                          |
| `status`      | enum `project_status`  | NOT NULL — values: `ACTIVE`, `COMPLETED`, `ARCHIVED` |
| `startDate`   | date (string mode)     | nullable                          |
| `endDate`     | date (string mode)     | nullable                          |
| `createdAt`   | timestamptz            | NOT NULL, DEFAULT now()           |
| `updatedAt`   | timestamptz            | NOT NULL, DEFAULT now(), on update |

---

### 1.5 `project_contractors`

Junction table linking AN organisations to a project.

| Column      | Type        | Constraints                          |
| ----------- | ----------- | ------------------------------------ |
| `projectId` | text (UUID) | PK part, FK → `projects.id` CASCADE  |
| `anOrgId`   | text (UUID) | PK part, FK → `organizations.id` CASCADE |
| `addedAt`   | timestamptz | NOT NULL, DEFAULT now()              |

Composite PK: `(projectId, anOrgId)`.

---

### 1.6 `takte`

The core schedule entries. One row per Takt.

| Column             | Type                  | Constraints                       |
| ------------------ | --------------------- | --------------------------------- |
| `id`               | text (UUID)           | PK                                |
| `projectId`        | text (UUID)           | NOT NULL, FK → `projects.id` CASCADE |
| `taktBezeichnung`  | text                  | NOT NULL                          |
| `zone`             | text                  | NOT NULL                          |
| `gewerk`           | text                  | NOT NULL                          |
| `description`      | text                  | nullable                          |
| `plannedStart`     | date (string mode)    | NOT NULL                          |
| `plannedEnd`       | date (string mode)    | NOT NULL                          |
| `earliestStart`    | date (string mode)    | nullable                          |
| `latestEnd`        | date (string mode)    | nullable                          |
| `lvReference`      | text                  | nullable                          |
| `bimReference`     | text                  | nullable                          |
| `requiredResources`| text                  | nullable                          |
| `status`           | enum `takt_status`    | NOT NULL, DEFAULT `GEPLANT`       |
| `createdAt`        | timestamptz           | NOT NULL, DEFAULT now()           |
| `updatedAt`        | timestamptz           | NOT NULL, DEFAULT now(), on update |

**Enum `takt_status`**: `GEPLANT`, `VERGEBEN`, `ALTERNATIV`, `BESTAETIGT`, `ABGELEHNT`, `STORNIERT`

No per-Takt versioning currently. Status conflates multiple concerns:
- `VERGEBEN` means "a delegation was sent" — a transport/routing state
- `BESTAETIGT` means "the AN confirmed" — a business decision
- This mixing is one of the problems the new model corrects.

---

### 1.7 `takt_dependencies`

Dependency relationships (Anordnungsbeziehungen) between Takte.

| Column          | Type              | Constraints                          |
| --------------- | ----------------- | ------------------------------------ |
| `id`            | text (UUID)       | PK                                   |
| `projectId`     | text (UUID)       | NOT NULL, FK → `projects.id` CASCADE |
| `predecessorId` | text (UUID)       | NOT NULL, FK → `takte.id` CASCADE    |
| `successorId`   | text (UUID)       | NOT NULL, FK → `takte.id` CASCADE    |
| `type`          | enum `takt_dependency_type` | NOT NULL, DEFAULT `EA`    |
| `lagDays`       | integer           | NOT NULL, DEFAULT 0                  |

**Enum `takt_dependency_type`**: `EA` (Finish-Start), `AA` (Start-Start), `EE` (Finish-Finish)

**Unique constraint**: `(predecessorId, successorId)` — prevents duplicate edges.

---

### 1.8 `delegations`

Current model for assigning a Takt to an AN organisation. Maps to the future `TaktRequest`.

| Column           | Type                       | Constraints                         |
| ---------------- | -------------------------- | ----------------------------------- |
| `id`             | text (UUID)                | PK                                  |
| `taktId`         | text (UUID)                | NOT NULL, FK → `takte.id` CASCADE   |
| `projectId`      | text (UUID)                | NOT NULL, FK → `projects.id` CASCADE |
| `agOrgId`        | text (UUID)                | NOT NULL, FK → `organizations.id`   |
| `anOrgId`        | text (UUID)                | NOT NULL, FK → `organizations.id`   |
| `requestedStart` | date (string mode)         | NOT NULL                            |
| `requestedEnd`   | date (string mode)         | NOT NULL                            |
| `earliestStart`  | date (string mode)         | nullable                            |
| `latestEnd`      | date (string mode)         | nullable                            |
| `status`         | enum `delegation_status`   | NOT NULL, DEFAULT `PENDING`         |
| `message`        | text                       | nullable                            |
| `createdAt`      | timestamptz                | NOT NULL, DEFAULT now()             |
| `updatedAt`      | timestamptz                | NOT NULL, DEFAULT now(), on update  |

**Enum `delegation_status_enum`**: `PENDING`, `CONFIRMED`, `ALTERNATIVE_PROPOSED`, `REJECTED`, `CANCELLED`

**No FK between `delegationId` and `taktId.status`** — Takt status is updated separately via route logic.

**Missing features vs. target model:**
- No version reference to the Takt version at delegation time
- No `requestNumber` (human-readable reference)
- No `sentAt`, `deliveredAt`, `detailsRetrievedAt` timestamps
- No `supersedesRequestId` for revision chains
- No `createdByUserId`
- No `responseRequiredBy` deadline
- Status conflates transport states (`PENDING`) with business outcomes (`CONFIRMED`, `REJECTED`)

---

### 1.9 `delegation_responses`

Current model for AN responses. Maps to the future `TaktResponse` + `TaktResponseAlternative`.

| Column          | Type                   | Constraints                             |
| --------------- | ---------------------- | --------------------------------------- |
| `id`            | text (UUID)            | PK                                      |
| `delegationId`  | text (UUID)            | NOT NULL, FK → `delegations.id` CASCADE |
| `type`          | enum `response_type`   | NOT NULL — `CONFIRMED`, `ALTERNATIVE`, `REJECTED` |
| `proposedStart` | date (string mode)     | nullable                                |
| `proposedEnd`   | date (string mode)     | nullable                                |
| `comment`       | text                   | nullable                                |
| `isWithinBuffer`| boolean                | NOT NULL, DEFAULT false                 |
| `agDecision`    | enum `ag_decision`     | NOT NULL, DEFAULT `PENDING`             |
| `agComment`     | text                   | nullable                                |
| `createdAt`     | timestamptz            | NOT NULL, DEFAULT now()                 |

**No `updatedAt`** on this table — technically immutable after creation.

**Missing vs. target model:**
- `type` collapses `ALTERNATIVE` and `CONFIRMED` where multiple alternatives could exist
- No `reasonCode` — no generic reason code taxonomy
- No `acceptedStart`/`acceptedEnd` distinguished from `proposedStart`/`proposedEnd`
- No `nextAvailableDate`
- No `createdByUserId`
- No `messageId` for transport correlation
- `agDecision` is on the response — mixing GU business decision with NU answer in one table

---

### 1.10 `resources`

AN-owned resources.

| Column               | Type                  | Constraints                          |
| -------------------- | --------------------- | ------------------------------------ |
| `id`                 | text (UUID)           | PK                                   |
| `anOrgId`            | text (UUID)           | NOT NULL, FK → `organizations.id` CASCADE |
| `type`               | enum `resource_type`  | NOT NULL                             |
| `name`               | text                  | NOT NULL                             |
| `qualification`      | text                  | nullable                             |
| `dailyCapacityHours` | double precision      | nullable                             |
| `color`              | text                  | nullable                             |
| `createdAt`          | timestamptz           | NOT NULL, DEFAULT now()              |

**Enum `resource_type`**: `EMPLOYEE`, `EQUIPMENT`, `MACHINE`, `OTHER`

---

### 1.11 `resource_assignments`

NU-internal assignment of a resource to a delegation period.

| Column        | Type            | Constraints                              |
| ------------- | --------------- | ---------------------------------------- |
| `id`          | text (UUID)     | PK                                       |
| `resourceId`  | text (UUID)     | NOT NULL, FK → `resources.id` CASCADE    |
| `delegationId`| text (UUID)     | NOT NULL, FK → `delegations.id` CASCADE  |
| `fromDate`    | date            | NOT NULL                                 |
| `toDate`      | date            | NOT NULL                                 |
| `note`        | text            | nullable                                 |
| `createdAt`   | timestamptz     | NOT NULL, DEFAULT now()                  |

---

### 1.12 `hub_messages`

Hub coordination message log.

| Column          | Type                    | Constraints              |
| --------------- | ----------------------- | ------------------------ |
| `id`            | text (UUID)             | PK                       |
| `type`          | enum `hub_message_type` | NOT NULL                 |
| `senderOrgId`   | text                    | NOT NULL (no FK)         |
| `recipientOrgId`| text                    | NOT NULL (no FK)         |
| `delegationId`  | text                    | nullable (no FK — avoids circular deps) |
| `payload`       | json                    | nullable                 |
| `createdAt`     | timestamptz             | NOT NULL, DEFAULT now()  |

**No FK on `delegationId`** — intentional to avoid circular dependencies between hub and delegation tables.

---

### 1.13 `hub_admins`

Marks users with hub-admin privileges.

| Column      | Type        | Constraints                    |
| ----------- | ----------- | ------------------------------ |
| `userId`    | text (UUID) | PK, FK → `users.id` CASCADE    |
| `createdAt` | timestamptz | NOT NULL, DEFAULT now()        |

---

### 1.14 `refresh_tokens`

Stored refresh tokens for JWT auth rotation.

| Column      | Type        | Constraints              |
| ----------- | ----------- | ------------------------ |
| `id`        | text (UUID) | PK                       |
| `token`     | text        | NOT NULL, UNIQUE         |
| `userId`    | text (UUID) | NOT NULL, FK → `users.id` CASCADE |
| `expiresAt` | timestamptz | NOT NULL                 |
| `createdAt` | timestamptz | NOT NULL, DEFAULT now()  |

---

## 2 — ID Types and Timestamps

### ID type
All tables use `text` primary keys populated with `crypto.randomUUID()` (UUID v4, generated in JavaScript at insert time). No DB-level `uuid` column type or sequence is used. The target model continues this convention.

### Timestamps
All timestamps use `timestamptz` (timestamp with timezone, stored as UTC in PostgreSQL). `createdAt` is always `NOT NULL DEFAULT now()`. `updatedAt` is `NOT NULL DEFAULT now()` with `$onUpdate(() => new Date())` on tables that support updates. The target model follows the same pattern.

### Date fields
Schedule dates (start, end) use `date` in `string` mode — stored as `YYYY-MM-DD` strings. This convention is retained in the target model.

---

## 3 — Current Status Problems

### Mixed concerns in `takt_status`

The existing `takt_status` enum conflates transport state, coordination state, and business decisions in a single field:

| Current value | Actual meaning          | Problem                                |
| ------------- | ----------------------- | -------------------------------------- |
| `GEPLANT`     | Takt created            | Fine                                   |
| `VERGEBEN`    | Delegation sent         | Transport/routing concern on the Takt  |
| `ALTERNATIV`  | Alternative proposed    | AN decision reflected on the Takt      |
| `BESTAETIGT`  | AN confirmed            | Business decision — correct concept    |
| `ABGELEHNT`   | AN rejected delegation  | Rejection of one request ≠ Takt rejected |
| `STORNIERT`   | Takt cancelled          | Fine                                   |

The new model separates these into:
- **`takt_status`** (unchanged) — preserved for backward compatibility with existing delegation routes
- **`lifecycleStatus`** (`takt_lifecycle_status`) — dedicated lifecycle enum for the Takt itself

### Mixed concerns in `delegation_status`

`PENDING` = transport state, `CONFIRMED`/`REJECTED`/`ALTERNATIVE_PROPOSED`/`CANCELLED` = business decisions. These belong in separate status dimensions in the new `TaktRequestStatus` model.

---

## 4 — Target Model

New tables introduced in parallel with existing delegation tables. No existing tables are removed in Task 2.

### 4.1 `takt_requests`

Replaces `delegations` for new coordination flows. Existing `delegations` remain active.

| Column               | Type                        | Constraints                              |
| -------------------- | --------------------------- | ---------------------------------------- |
| `id`                 | text (UUID)                 | PK, `crypto.randomUUID()`                |
| `taktId`             | text (UUID)                 | NOT NULL, FK → `takte.id` RESTRICT       |
| `taktVersion`        | integer                     | NOT NULL, min 1                          |
| `guOrgId`            | text (UUID)                 | NOT NULL, FK → `organizations.id`        |
| `nuOrgId`            | text (UUID)                 | NOT NULL, FK → `organizations.id`        |
| `requestNumber`      | text                        | NOT NULL, UNIQUE                         |
| `status`             | enum `takt_request_status`  | NOT NULL, DEFAULT `DRAFT`                |
| `responseRequiredBy` | timestamptz                 | nullable                                 |
| `sentAt`             | timestamptz                 | nullable                                 |
| `deliveredAt`        | timestamptz                 | nullable                                 |
| `detailsRetrievedAt` | timestamptz                 | nullable                                 |
| `supersedesRequestId`| text (UUID)                 | nullable, FK → `takt_requests.id`        |
| `createdByUserId`    | text (UUID)                 | NOT NULL, FK → `users.id`                |
| `createdAt`          | timestamptz                 | NOT NULL, DEFAULT now()                  |
| `updatedAt`          | timestamptz                 | NOT NULL, DEFAULT now(), on update       |

**FK on `taktId`**: `RESTRICT` — prevents cascade-deleting a Takt that has requests, preserving historical data.

### 4.2 `takt_request_snapshots`

Immutable point-in-time copy of released Takt data as seen by the NU.

| Column           | Type        | Constraints                               |
| ---------------- | ----------- | ----------------------------------------- |
| `id`             | text (UUID) | PK                                        |
| `taktRequestId`  | text (UUID) | NOT NULL, UNIQUE, FK → `takt_requests.id` CASCADE |
| `schemaVersion`  | text        | NOT NULL, DEFAULT `'1.0'`                 |
| `snapshotPayload`| jsonb       | NOT NULL                                  |
| `createdAt`      | timestamptz | NOT NULL, DEFAULT now()                   |

**UNIQUE on `taktRequestId`**: exactly one snapshot per request.
**No `updatedAt`**: snapshots are write-once and never updated.

### 4.3 `takt_responses`

Business response from a NU to a TaktRequest.

| Column              | Type                          | Constraints                                 |
| ------------------- | ----------------------------- | ------------------------------------------- |
| `id`                | text (UUID)                   | PK                                          |
| `taktRequestId`     | text (UUID)                   | NOT NULL, UNIQUE, FK → `takt_requests.id` CASCADE |
| `messageId`         | text                          | nullable, UNIQUE where not null             |
| `decision`          | enum `takt_decision`          | NOT NULL                                    |
| `reasonCode`        | enum `takt_response_reason_code` | nullable                                 |
| `comment`           | text                          | nullable, max 2000 chars (service-enforced) |
| `acceptedStart`     | timestamptz                   | nullable                                    |
| `acceptedEnd`       | timestamptz                   | nullable                                    |
| `nextAvailableDate` | date (string mode)            | nullable                                    |
| `createdByUserId`   | text (UUID)                   | NOT NULL, FK → `users.id`                   |
| `createdAt`         | timestamptz                   | NOT NULL, DEFAULT now()                     |

**UNIQUE on `taktRequestId`**: at most one response per request in PoC. A new coordination round creates a new TaktRequest.
**UNIQUE on `messageId`**: enforces deduplication of transport messages where set.

### 4.4 `takt_response_alternatives`

Ranked alternative time windows proposed by the NU.

| Column          | Type        | Constraints                                  |
| --------------- | ----------- | -------------------------------------------- |
| `id`            | text (UUID) | PK                                           |
| `responseId`    | text (UUID) | NOT NULL, FK → `takt_responses.id` CASCADE   |
| `alternativeId` | text        | NOT NULL                                     |
| `rank`          | integer     | NOT NULL, min 1                              |
| `proposedStart` | timestamptz | NOT NULL                                     |
| `proposedEnd`   | timestamptz | NOT NULL                                     |
| `crewSize`      | integer     | nullable, min 1 if set                       |
| `conditions`    | jsonb       | nullable (array of strings)                  |
| `createdAt`     | timestamptz | NOT NULL, DEFAULT now()                      |

**UNIQUE on `(responseId, alternativeId)`**: prevents duplicate alternative IDs within a response.
**UNIQUE on `(responseId, rank)`**: prevents duplicate ranks within a response.
**INDEX on `responseId`**: fast lookup of alternatives for a given response.

---

## 5 — Mapping: Existing → Target

### Fields that can be reused

| Existing field (`delegations`)  | Target field (`takt_requests`)  | Notes                                 |
| ------------------------------- | ------------------------------- | ------------------------------------- |
| `taktId`                        | `taktId`                        | Same reference, same FK pattern       |
| `agOrgId`                       | `guOrgId`                       | Rename only                           |
| `anOrgId`                       | `nuOrgId`                       | Rename only                           |
| `createdAt`                     | `createdAt`                     | Same convention                       |
| `updatedAt`                     | `updatedAt`                     | Same convention                       |
| `requestedStart`, `requestedEnd`| → snapshot payload              | Moved into the immutable snapshot     |

| Existing field (`delegation_responses`) | Target field (`takt_responses`) | Notes                             |
| --------------------------------------- | ------------------------------- | --------------------------------- |
| `type` (`CONFIRMED`)                    | `decision = ACCEPTED`           | Renamed, enum value changed       |
| `type` (`ALTERNATIVE`)                  | `decision = ALTERNATIVES_PROPOSED` | Alternatives moved to child table |
| `type` (`REJECTED`)                     | `decision = REJECTED`           | Same                              |
| `comment`                               | `comment`                       | Same                              |
| `createdAt`                             | `createdAt`                     | Same                              |

### New required fields (no equivalent in existing model)

`requestNumber`, `taktVersion`, `responseRequiredBy`, `sentAt`, `deliveredAt`, `detailsRetrievedAt`, `supersedesRequestId`, `createdByUserId` (on requests); `reasonCode`, `acceptedStart`, `acceptedEnd`, `nextAvailableDate`, `messageId` (on responses); full `takt_response_alternatives` table.

### Fields that mix multiple concerns (problem areas)

| Existing field       | Problem                                                      |
| -------------------- | ------------------------------------------------------------ |
| `delegations.status` | Conflates transport state (`PENDING`) with business outcomes  |
| `takte.status`       | Conflates routing (`VERGEBEN`) with business outcomes (`BESTAETIGT`) |
| `delegation_responses.proposedStart/End` | Used for both confirmed and alternative windows — ambiguous |
| `delegation_responses.agDecision` | GU decision stored on the NU response record          |

### Functions that must remain intact

The following delegation-based API endpoints must continue to work throughout Task 2 and beyond:

- `GET/POST /projects/{projectId}/delegations`
- `GET/PATCH /projects/{projectId}/delegations/{delegationId}`
- `POST /projects/{projectId}/delegations/{delegationId}/responses`
- `GET /projects/{projectId}/delegations/{delegationId}/responses`
- `PATCH /projects/{projectId}/delegations/{delegationId}/responses/{responseId}`
- All AN dashboard polling endpoints that use `delegations` and `delegation_responses`
- Hub message endpoints that reference `delegationId`

### Data eligible for later migration

After the new model is verified in production:

| Old table              | New table                      | Migration complexity |
| ---------------------- | ------------------------------ | -------------------- |
| `delegations`          | `takt_requests`                | Medium — need to generate `requestNumber`, populate timestamps from `createdAt`, create snapshots retroactively |
| `delegation_responses` | `takt_responses` + `takt_response_alternatives` | Medium — split ALTERNATIVE rows into child table |

### Tables not replaced in Task 2

All existing tables remain: `delegations`, `delegation_responses`, `resource_assignments`. New tables are additive only.

---

## 6 — Architecture Decision: Parallel Introduction

**Decision**: New tables (`takt_requests`, `takt_request_snapshots`, `takt_responses`, `takt_response_alternatives`) are introduced alongside the existing delegation tables without replacing them.

**Rationale**:
- Zero-risk rollout: existing delegation endpoints continue to function unchanged.
- Existing frontend code (AG-app, AN-app, Hub-app) is not broken.
- New features use only the new model from the start.
- Migration of historical delegation data is deferred to a later task.
- No existing IDs are changed; no existing data is lost.

---

## 7 — Analysis Summary

### Tables analysed

`users`, `organizations`, `user_organizations`, `projects`, `project_contractors`, `takte`, `takt_dependencies`, `delegations`, `delegation_responses`, `resources`, `resource_assignments`, `hub_messages`, `hub_admins`, `refresh_tokens`

### Status problems identified

1. `takt_status` conflates transport routing, coordination progress, and business decisions in one enum.
2. `delegation_status` mixes a transport state (`PENDING`) with business outcomes.
3. `delegation_responses.agDecision` co-locates the GU's decision on the NU's response record.
4. No version tracking on Takte — no way to know which version of a Takt was referenced at delegation time.

### ID and timestamp types in target model

- IDs: `text`, generated with `crypto.randomUUID()` (same as existing)
- `createdAt`, `updatedAt`, `sentAt`, `deliveredAt`, `detailsRetrievedAt`, `responseRequiredBy`: `timestamptz`
- `acceptedStart`, `acceptedEnd`, `proposedStart`, `proposedEnd`: `timestamptz` (not date, to support time-of-day precision)
- `nextAvailableDate`: `date` (string mode, YYYY-MM-DD)

### Migration risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Generating retroactive `requestNumber` for existing delegations | Medium | Use delegation ID as fallback reference; sequence can be generated during migration |
| Retroactive Takt snapshots | High | Cannot reconstruct the exact Takt state at delegation time; will need to flag migrated records as `MIGRATED` |
| `takt_status` rename | High | Column renamed would break all existing routes — keep old column, add new `lifecycleStatus` in parallel |
| `proposedStart/End` semantics | Medium | Old alternative rows have one time window; new model uses child table with multiple ranked alternatives |
| `agDecision` on response | Low | Can be handled at migration time; field belongs on TaktRequest in new model |

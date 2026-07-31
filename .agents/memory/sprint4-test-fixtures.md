---
name: Sprint 4 test fixture pitfalls
description: Common DB constraint failures when seeding takte and takt_requests in vitest integration tests.
---

## Rules

**takte table** — `planned_start` and `planned_end` are NOT NULL (no defaults). Always include them when seeding:
```typescript
await db.insert(takteTable).values({
  id, projectId, taktBezeichnung, zone, gewerk,
  plannedStart: "2026-09-15",   // mode:"string" → string literal, not new Date()
  plannedEnd:   "2026-09-20",
}).onConflictDoNothing();
```

**takt_requests table** — `created_by_user_id` is NOT NULL FK → usersTable. Seed a user first and pass `createdByUserId`:
```typescript
await db.insert(taktRequestsTable).values({
  id, taktId, taktVersion: 1,
  guOrgId, nuOrgId, requestNumber,
  status: "DETAILS_RETRIEVED" as const,
  createdByUserId: GU_USER,   // required
}).onConflictDoNothing();
```

**mode:"string" date columns** — drizzle `date("...", { mode:"string" })` expects a plain string (`"YYYY-MM-DD"`), not a `Date` object. Using `new Date(...)` causes `TS2769` and possibly runtime type errors.

**createTaktRequestWithSnapshot (E2E via API)** — the service checks `project_contractors` table. If the NU org isn't registered as a contractor, it throws `NuNotContractorError` → 403. Always seed:
```typescript
await db.insert(projectContractorsTable).values({ projectId, anOrgId: NU_ORG }).onConflictDoNothing();
```

**values([...]) overload resolution** — drizzle sometimes struggles to infer types for multi-row array inserts when enum fields are present. Prefer individual `values({...})` calls or use `as const` on enum string literals.

**Why:**
These all hit the constraint check layer (DB or TypeScript compiler) before any test logic runs, causing the entire `beforeAll` to throw and all tests in the file to fail.

**How to apply:**
Check every `db.insert(takteTable|taktRequestsTable)` in new test files for these fields before running.

---
name: Test fixture required (NOT NULL) fields
description: Which DB columns are NOT NULL and must be supplied in test inserts.
---

## users table

- `name` — NOT NULL
- NO `orgId` column (no foreign key to organizations)
- NO `role` column

```typescript
await db.insert(usersTable).values({
  id: "...", name: "Test User", email: "test@test.com", passwordHash: "x",
}).onConflictDoNothing();
```

## takte table

- `taktBezeichnung` — NOT NULL (not `name`)
- `zone` — NOT NULL
- `gewerk` — NOT NULL
- `plannedStart` — NOT NULL (string mode: `"2026-09-01"`)
- `plannedEnd` — NOT NULL (string mode: `"2026-09-15"`)

```typescript
await db.insert(takteTable).values({
  id, projectId, taktBezeichnung: "...", zone: "Z1", gewerk: "Rohbau",
  plannedStart: "2026-09-01", plannedEnd: "2026-09-15",
}).onConflictDoNothing();
```

## projects table

- `agOrgId` — NOT NULL (not `orgId`)

```typescript
await db.insert(projectsTable).values({
  id, name: "...", agOrgId: GU_ORG,
}).onConflictDoNothing();
```

**Why:** These column names differ from what you might expect from similar ORMs. Drizzle maps camelCase in the schema to the snake_case column, but the camelCase property name is what matters in inserts.

---
name: takt_requests has no projectId
description: takt_requests table has no project_id column — join through takte to get projectId.
---

## Rule

`takt_requests` does NOT have a `project_id` column.

To filter or aggregate takt requests by project, always join:
```sql
FROM takt_requests tr
JOIN takte t ON tr.takt_id = t.id
WHERE t.project_id = :projectId
```

In Drizzle:
```ts
.from(taktRequestsTable)
.innerJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
.where(eq(takteTable.projectId, projectId))
```

**Why:** The canonical project reference lives on `takte`. `takt_requests` is linked to a specific version of a takt (`taktId`), and the project is derived from there.

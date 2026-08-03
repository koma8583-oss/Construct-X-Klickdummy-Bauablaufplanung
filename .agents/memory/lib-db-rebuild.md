---
name: lib/db tsc rebuild after schema changes
description: How and when to rebuild lib/db so api-server picks up new schema types.
---

## Rule: run `tsc --build` on lib/db after any schema change

`lib/db` uses TypeScript project references. The `api-server` references `lib/db/dist/` (compiled output, not source). After editing any file under `lib/db/src/schema/`, the compiled `.d.ts` files become stale and `api-server` typecheck sees the old types.

```bash
pnpm --filter @workspace/db exec tsc --build
```

**Why:** `api-server/tsconfig.json` lists `../../lib/db` as a project reference with `composite: true`. TypeScript resolves types from `lib/db/dist/*.d.ts`, not from `src/` at runtime.

**How to apply:** Any time you see TS errors like "Property 'newColumn' does not exist on type 'PgTableWithColumns...'" or a newly exported symbol not found in `@workspace/db`, run the rebuild command first before investigating further.

Also rebuild after: adding new exported symbols (`export * from "./new-file"`), changing enum values, adding new columns to any table.

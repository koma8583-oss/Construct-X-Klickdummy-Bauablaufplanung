---
name: Express v5 params typing
description: ParamsDictionary in Express v5 types is string | string[], breaking drizzle eq() calls
---

In `@types/express-serve-static-core@5.1.2`, `ParamsDictionary` is declared as:
```typescript
export interface ParamsDictionary {
  [key: string]: string | string[];
  [key: number]: string;
}
```

This means `req.params.xxx` is typed as `string | string[]`, which breaks drizzle-orm's `eq()` first overload that expects `string | SQLWrapper`.

**Why:** Express v5 types broadened the param type to allow arrays (URL-encoded arrays).

**How to apply:** Whenever using `req.params.xxx` in a drizzle `eq()` or any context expecting `string`, add `as string` cast: `(req.params.projectId as string)`. Using `sed -i -E 's/req\.params\.([a-zA-Z]+)/(req.params.\1 as string)/g'` on all route files is the fastest fix. Module augmentation cannot narrow the interface type.

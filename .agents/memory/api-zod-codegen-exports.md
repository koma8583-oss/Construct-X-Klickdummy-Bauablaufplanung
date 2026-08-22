---
name: API Zod codegen exports
description: Orval can generate overlapping API and schema type exports in api-zod.
---

Keep api-zod's public index limited to the intentional generated API and transport exports; do not broadly re-export generated/types when generated/api already exports overlapping names.

**Why:** Regenerating the OpenAPI client can add duplicate symbols such as request body types and make the workspace typecheck fail.

**How to apply:** After OpenAPI codegen, run the api-zod build and preserve explicit exports in lib/api-zod/src/index.ts.
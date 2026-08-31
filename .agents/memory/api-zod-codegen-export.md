---
name: API Zod codegen export collision
description: Orval regenerates api-zod/src/index.ts and can reintroduce duplicate exports after codegen.
---

The API Zod barrel export must be kept compatible with Orval's generated schema/type names; running codegen can overwrite hand-edited barrel fixes and reintroduce duplicate TypeScript exports.

**Why:** The codegen command cleans and regenerates the api-zod output directory before running the library typecheck.

**How to apply:** Keep non-generated transport exports in the repository's post-generation fix step; do not rely only on editing the generated index after codegen.
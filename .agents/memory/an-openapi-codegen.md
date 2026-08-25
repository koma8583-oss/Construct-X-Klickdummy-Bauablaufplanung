---
name: AN OpenAPI codegen boundaries
description: AN-local worklist contracts must use explicit namespace paths and generated types.
---

AN-local projection endpoints should be represented by dedicated `/an/...` OpenAPI operations and schemas rather than reusing AG coordination DTOs. Generated client URLs then bypass the AN app's generic `/api/*` rewrite safely while remaining explicit about ownership.

**Why:** The older shared Leistungsanfrage contract describes AG-shaped fields and allowed handwritten AN types to drift when the local projection changed.

**How to apply:** Add AN list/detail operations and component schemas to `lib/api-spec/openapi.yaml`, run api-spec codegen, and consume the generated AN hooks from AN pages.
---
name: Project agreement scope backfill
description: Historical accepted project agreements need explicit child-purpose and field-scope arrays before child coordination is allowed.
---

Accepted project agreements from before scope persistence may omit or corrupt `allowedPurposes` and `allowedFieldScope`.

**Why:** Treating an absent scope as unrestricted silently grants broader child access than newly issued agreements, while replacing an existing restricted array during migration widens authorization.

**How to apply:** Backfill only accepted project agreements, preserve valid string arrays, copy a valid scope from the other policy representation before using the reviewed catalog defaults, and reject incomplete parent scopes in both shared creation services and previews. Child policies that are not project agreements retain their own compatibility rules.

For shared-database test suites, keep repair and diagnostic operations project-scoped when validating a fixture; parallel Vitest files may create other accepted agreements with missing historical metadata.

**Why:** Global repair counts and diagnostics are otherwise nondeterministic when fixtures run concurrently, even though the production operation still supports an unscoped whole-database repair.

**How to apply:** Use the optional project filter for fixture assertions; leave the default operation unscoped for deployment repair jobs.
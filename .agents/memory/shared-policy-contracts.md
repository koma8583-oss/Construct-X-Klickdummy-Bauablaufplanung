---
name: Shared policy contracts
description: Where mandatory Parent-Policy inputs must be enforced when several API aliases share creation logic.
---

Security-sensitive child-policy input must be mandatory in the lowest shared creation service as well as validated by every mounted route alias. No shared caller may substitute a broad default purpose or field scope.

**Why:** Protecting only the primary route leaves canonical, legacy, or project-scoped aliases able to create the same business object without the reviewed Parent-Policy selection.

**How to apply:** When adding or changing a creation alias, trace every call into the shared service. Keep its policy fields required at the type boundary, and add contract tests for missing or stale policy input on each mounted route.
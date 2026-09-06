---
name: Legacy policy gates
description: Historical AN projections may lack child-policy metadata while still carrying synchronized parent lifecycle state.
---

Treat a projection with no child-policy snapshot as historical compatibility data only when it has no synchronized parent state. If parent membership or agreement state is present, evaluate the old projection as an implicit baseline child so revocation and validity checks still apply. Generated policy templates may omit parent prohibitions because the effective policy must inherit them; explicit hand-authored removal attempts remain NOT_PERMITTED.

**Why:** Strict fail-closed checks exposed old fixtures and delivered projections that predated child-policy metadata. Bypassing them entirely would let a synchronized parent revoke or expire without blocking protected AN actions.

**How to apply:** Keep compatibility logic at the projection boundary and preserve parent lifecycle/validity gates. In policy resolution, distinguish generated template restrictions from explicit child prohibition replacement.
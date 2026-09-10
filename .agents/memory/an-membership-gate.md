---
name: AN-local membership gate
description: Normal inbound SERVICE_REQUEST processing requires an accepted local AN invitation and active projected membership state.
---

Normal inbound SERVICE_REQUESTs are authorized only by the AN-local invitation projection matching project reference, AG sender, and AN receiver. The invitation must be ACCEPTED; when the projected effective policy declares a parent membership status, it must be ACTIVE. Missing or mismatched local state must stop processing before any request projection or resource-requirement insert. Explicit schedule-change handling remains a separate bilateral path.

**Why:** AG project_memberships are not readable from the AN role and cannot serve as an authorization shortcut in physically separated deployments.

**How to apply:** Keep the gate in the inbound domain service, use accepted local invitation state as the AN membership projection, and treat invitation/policy replay as immutable except for the documented legacy snapshot upgrade. Normal SERVICE_REQUEST fixtures must seed that accepted AN-local invitation; a post-domain processing failure may leave one projection, which the same-message retry must reuse rather than duplicate.
---
name: Performance request child policies
description: Durable boundary between project agreements, Leistungsanfragen, and independent DataOffers.
---

Normal Leistungsanfragen are purpose-driven PERFORMANCE_REQUEST child policies under the AN's accepted PROJECT_AGREEMENT. The selected purpose defines a hard additional-field whitelist; project fields inherited from the agreement remain visible as read-only context but are not duplicated in the child snapshot.

**Why:** Project membership consent, performance-request conditions, and independent data-package acceptance are separate business decisions. Coupling a normal Leistungsanfrage to a DataPublication/DataOffer introduced duplicate consent and duplicated parent data.

**How to apply:** Create and send normal Leistungsanfragen directly with an immutable scoped public snapshot and `parentPolicyId`. `WITHIN_BASELINE` allows immediate detail access, `REQUIRES_CONSENT` gates details on the child-policy delta, and `NOT_PERMITTED` blocks sending. Keep DataOffers only for independent packages such as BIM models, logistics plans, or document bundles.
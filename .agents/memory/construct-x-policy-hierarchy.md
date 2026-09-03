---
name: Construct-X policy hierarchy
description: Child coordination policies inherit explicit capabilities from the accepted project agreement.
---

A Project Agreement must publish the capabilities and child-policy types that its coordination policies may inherit; comparing a child policy directly with the project-admission permissions produces false NOT_PERMITTED results.

**Why:** Project admission and performance coordination have different technical permissions, while the business model intentionally allows ordinary performance requests within the active membership without a second project consent.

**How to apply:** Resolve child policies against the agreement's effective policy. Treat work-package/purpose specialization as normal child refinement, validity expansion as consent-required, and identity or ungranted capability changes as not permitted.
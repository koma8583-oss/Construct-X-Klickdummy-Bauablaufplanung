---
name: Construct-X policy hierarchy
description: Child coordination policies inherit explicit capabilities from the accepted project agreement.
---

A Project Agreement must publish the capabilities and child-policy types that its coordination policies may inherit; comparing a child policy directly with the project-admission permissions produces false NOT_PERMITTED results.

**Why:** Project admission and performance coordination have different technical permissions, while the business model intentionally allows ordinary performance requests within the active membership without a second project consent.

**How to apply:** Resolve child policies against the agreement's effective policy. Treat work-package/purpose specialization as normal child refinement, validity expansion as consent-required, and identity or ungranted capability changes as not permitted.

Invitation transactions must persist the Project Agreement policy before inserting the membership that references it, then create the outbox message.

**Why:** PostgreSQL checks the membership foreign key immediately; inserting the membership first fails even inside the same transaction.

**How to apply:** Keep the invitation transaction ordered as policy, membership, outbox, and insert each policy exactly once.

Every protected performance-request operation must pass one domain-level policy guard, including legacy route aliases and direct service calls. Policy-linked revisions must mint a fresh child policy and can never fall back into the legacy DataOffer path.

**Why:** Route-only enforcement left snapshot, response, resource, and revision paths able to disclose or mutate data without the same consent, validity, and retention checks.

**How to apply:** Require a current ACTIVE membership, matching accepted and currently valid project agreement, and actionable child policy before details, resources, availability, responses, schedule proposals, or revisions. Keep DataOffer compatibility only for records that genuinely have no performance policy.

AN projections store validity and retention inside the effective policy, not as top-level projection fields. Metadata-only applies to list serializers as well as detail endpoints, and legacy response services must authorize from persisted request and policy state rather than caller-supplied status or organization.

**Why:** Passing a projection directly to the guard silently skipped validity checks, while list and direct-service paths could otherwise disclose fields or persist responses despite a protected detail route.

**How to apply:** Normalize projection policy state before every domain guard, redact snapshot-derived list fields when DETAILS is denied, and reload the real request, recipient, status, and referenced policy before any response write.
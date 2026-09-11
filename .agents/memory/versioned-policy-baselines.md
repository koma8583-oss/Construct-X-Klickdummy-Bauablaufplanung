---
name: Versioned policy baselines
description: The compatibility rule for consent-free child purposes in Construct-X Parent-Policies
---

Current Project Agreements must carry an explicit, versioned `baselinePurpose`; the resolver treats that value as authoritative when deciding between `WITHIN_BASELINE` and `REQUIRES_CONSENT`.

**Why:** The consent-free purpose is a business decision of the accepted Parent-Policy, not a permanent global resolver convention. Existing immutable agreements predating the field must remain usable without silently changing their behavior.

**How to apply:** For historical Project Agreement template versions without `baselinePurpose`, retain the documented `LEISTUNGSKOORDINATION` compatibility fallback. New template versions and fixtures should always provide an explicit baseline purpose and test a second allowed purpose as consent-required. Any generated child policy must copy the inherited baseline into its immutable snapshot before consistency validation.

**Why:** A child template does not define the parent’s baseline itself; leaving the inherited value only in `effectivePolicy` makes a valid child look like a partial, conflicting representation.
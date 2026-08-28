---
name: Policy template registry
description: The policy PoC keeps stable, versioned template metadata in code while preserving the existing policy_templates Dataspace storage.
---

The policy PoC uses a separate code-owned registry for stable template IDs, versions, required parameters, and allowed provider overrides. The existing `policy_templates` table and publication flow remain the compatibility layer until a later integration explicitly adopts registry snapshots.

**Why:** Adding versioned policy creation semantics without a new table or policy hub must not alter existing Dataspace, Outbox, Inbound, or data-ownership behavior.

**How to apply:** Use the registry and immutable snapshot builder for new policy creation work; do not retrofit existing publication or invitation writes until a dedicated integration task defines the migration boundary.

The existing `SCHEDULE_COORDINATION` identity is retained for the stricter Rahmentermin use case and advanced to a new registry version rather than introducing a parallel policy code. Semantic changes to active rights or retention must advance the version; older snapshots remain valid. Publication field scopes are enforced from the registry in both AG creation paths.

**Why:** Existing database rows and immutable policy snapshots refer to the stable policy code; replacing it would create an unnecessary migration boundary and could break historical Dataspace offers.

**How to apply:** Treat the latest schedule-coordination registry version as the default for new publications, and preserve explicit older versions for already-created snapshots.
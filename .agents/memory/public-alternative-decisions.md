---
name: Public alternative decisions
description: Boundary between public alternative IDs and the internal decision foreign key.
---

AG decision input, API output, idempotency semantics, detail views, and Dataspace envelopes use the AN-provided public `alternativeId`. The decision table keeps the resolved internal alternative-row ID only because its existing foreign key targets that row.

**Why:** Writing the public ID directly into the FK column fails, while exposing the row UUID externally couples bilateral coordination to AG database internals. Equivalent retries using the public ID or a legacy row UUID must identify the same selection.

**How to apply:** Resolve the submitted selector within the response, persist the resolved row ID, and normalize every external representation back to the public ID. Never treat either identifier as an AN resource ID or include concrete AN resources in AG records.
---
name: Interactive Dataspace coordination
description: Lifecycle rules for bilateral schedule proposals delivered to a local recipient projection
---

The proposal lifecycle is interactive: publish an AG schedule-change request when the proposal is created, store it in the AN projection without an automatic response, and let the recipient resolve it through a local service-response route. Explicit AG-side resolutions use a coordination-decision envelope rather than re-delivering the original service request.

**Why:** Automatically answering a locally delivered proposal prevents the recipient UI from seeing an actionable open proposal, while delaying publication until resolution makes the proposal invisible to the recipient.

**How to apply:** Keep local loopback delivery non-automatic for interactive schedule changes, and preserve idempotent request/response/decision envelopes when adding new proposal actions.
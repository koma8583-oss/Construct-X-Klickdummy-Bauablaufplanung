---
name: Concurrent agent edits
description: Coordinated changes to shared backend services must be serialized.
---

Do not run independent implementation agents against the same service or its direct consumers without an explicit integration order.

**Why:** concurrent edits can replace a shared file with an older working copy, silently dropping another change while each isolated typecheck succeeds.

**How to apply:** partition delegates by non-overlapping file sets, collect each result before touching shared contracts, then run a full workspace typecheck after integration.
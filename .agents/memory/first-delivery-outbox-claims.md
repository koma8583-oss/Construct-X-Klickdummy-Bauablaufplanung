---
name: First-delivery outbox claims
description: Delivery behavior for envelopes pre-created inside AG/AN business transactions.
---

Pre-created `PENDING` and retryable `FAILED` outbox envelopes must be claimed through the same conditional retry path before the transport adapter sends them. Returning a pending row directly skips the claim transition and can make a real first delivery appear successful locally while never reaching the recipient projection.

**Why:** Cross-schema atomicity requires business transactions to create the envelope before commit, but delivery still needs the normal claim/attempt/history/idempotency behavior afterward.

**How to apply:** Keep envelope creation inside the domain transaction and all actual delivery post-commit; route existing pending or failed rows through the adapter's retry/claim operation rather than treating them as already delivered.
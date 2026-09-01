---
name: Tractus-X NOT_CONFIGURED boundary
description: Dataspace transport behavior before real participant identities and connector phases are configured.
---

The Tractus-X exchange adapter must fail explicitly with `NOT_CONFIGURED` until real participant identities, connector discovery, notification delivery, negotiation, and transfer phases are available. It must never fall back to local delivery or report a simulated success.

**Why:** A local REST loopback can validate domain contracts, but presenting it as an external Dataspace delivery would violate data ownership and hide missing production configuration.

**How to apply:** Keep local loopback behavior confined to `RestDataspaceExchange`. For Tractus-X, persist outbox-backed invitation, data-offer, and decision envelopes as `FAILED` when unavailable, and retry only from the stored payload and message ID.
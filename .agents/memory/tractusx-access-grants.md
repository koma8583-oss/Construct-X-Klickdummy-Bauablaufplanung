---
name: Tractus-X access grants
description: Connector access reuse rules for Construct-X Notification API delivery.
---

Persist connector access state by sender BPN, receiver BPN, and asset ID. Reuse
only ACTIVE, non-expired Contract Agreement and EDR records; catalog discovery
still runs per delivery. A transfer-process identifier is not an EDR identifier:
the connector must return an EDR or a configured EDR lookup must resolve one.
Authentication failures on a reused grant invalidate it so the next attempt can
negotiate again.

**Why:** Treating transfer creation and data-plane authorization as one phase
would allow simulated or stale access to look like a successful external
notification.

**How to apply:** Keep catalog, agreement negotiation, transfer/EDR retrieval,
and notification POST as separate phases. Persist expiry and data-plane
endpoint metadata with the grant, and fail explicitly when the connector does
not provide the required access material.
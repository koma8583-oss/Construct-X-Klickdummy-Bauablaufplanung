---
name: Inbound response attribution
description: Rules for recording AN responses received by the AG through the Dataspace.
---

Responses arriving through the Dataspace must be persisted as externally originated, with the sender organisation, transport message ID and server-side receipt time retained. They must not be attributed to an AG-local user.

**Why:** Treating a remote AN response as an AG user's creation destroys the exchange provenance needed for audit and accountability.

**How to apply:** Keep the response provenance fields and both response audit events aligned whenever an inbound response path or transport adapter changes.
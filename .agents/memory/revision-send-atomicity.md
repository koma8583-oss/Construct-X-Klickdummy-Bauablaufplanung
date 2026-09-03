---
name: Revision send atomicity
description: Lifecycle rule for replacing an existing Leistungsanfrage version
---

The previous request version remains the valid version while a successor is only a draft or its transport attempt has failed. Mark the predecessor `SUPERSEDED` only after the successor has crossed the delivery boundary; this applies to both canonical and legacy send routes.

**Why:** Superseding during draft creation or before transport success can leave the coordination without a usable request and prevents safe retries.

**How to apply:** Return the predecessor's actual status for unsent revisions, and perform the supersede update after successful delivery in every route that can send a revision.
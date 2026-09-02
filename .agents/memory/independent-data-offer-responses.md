---
name: Independent data-offer responses
description: Dataspace acceptance and rejection of a Leistungsfreigabe are separate from project invitation membership decisions.
---

The Dataspace must represent an AN decision on a published Leistungsfreigabe with its own versioned response contract and message type. Processing that response may update only the publication recipient projection; it must never change project membership or emit a project-invitation response.

**Why:** Project membership is established before Leistungen are selected and released. Coupling the two decisions can activate or reject membership from an unrelated policy choice and can create hidden publications.

**How to apply:** Keep invitation delivery/response and data-offer delivery/response on separate exchange, outbox, inbound-handler, and UI paths. Keep the accepted snapshot as the only source for AN Leistung views.
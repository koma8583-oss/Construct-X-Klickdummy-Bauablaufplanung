---
name: Published display labels
description: Durable rule for human-readable labels in AN-facing coordination views
---

Business-facing AN views must use names explicitly published through the Dataspace payload and stored in the AN-local projection. If a published name is absent, show neutral text such as “Nicht veröffentlicht” rather than a technical organization, project, resource, or coordination ID.

**Why:** AN data ownership is intentionally separated from AG planning data, and an ID rendered as a name is misleading and exposes an implementation detail.

**How to apply:** Add optional display-name fields to the existing exchange payload/projection when needed; keep raw IDs only in explicit technical or diagnostic views.
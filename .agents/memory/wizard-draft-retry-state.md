---
name: Wizard draft retry state
description: State-management constraint for multi-step publication wizards that create a draft before publishing it.
---

Once a publication draft has been created, setting its ID for retry must not trigger the wizard's initial-form effect again. The form must stay on the publish step and retain the user's selections so a failed publish can be retried against the same draft.

**Why:** A retry-ID state update can otherwise be mistaken for a new draft input, resetting the wizard before the publish error and retry affordance are rendered.

**How to apply:** Guard initialization effects while an active retry ID exists; only initialize from the incoming draft when opening a new wizard or switching to a different draft.
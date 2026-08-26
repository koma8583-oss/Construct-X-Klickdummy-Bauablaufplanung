---
name: Dataspace schedule changes
description: Durable data-ownership rule for bilateral schedule changes between AG and AN.
---

The AG may initiate a schedule-change proposal, but it must not inspect or mutate AN resources, availability, or bookings while deciding it. The proposal travels as a Dataspace service request. The AN evaluates only its local projection, own resources, and its own CONFIRMED/TENTATIVE bookings, then replies through the service-response channel. The AG applies plan, agreement, requirement, and booking state only after an accepted inbound AN response.

**Why:** A shared physical test database must not weaken the production ownership boundary; direct AG-side availability checks caused the wrong domain to become authoritative.

**How to apply:** Keep schedule-change acceptance split into Dataspace transport, AN-local evaluation, and AG-only response application. Treat delivery failure and incomplete correlation/participant validation as non-committing outcomes.
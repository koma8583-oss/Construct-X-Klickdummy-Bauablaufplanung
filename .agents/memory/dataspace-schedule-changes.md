---
name: Dataspace schedule changes
description: Durable data-ownership rule for bilateral schedule changes between AG and AN.
---

The AG may initiate a schedule-change proposal, but it must not inspect or mutate AN resources, availability, or bookings while deciding it. The proposal travels as a Dataspace service request. The AN evaluates only its local projection, own resources, and its own CONFIRMED/TENTATIVE bookings, then replies through the service-response channel. The AG applies plan, agreement, requirement, and booking state only after an accepted inbound AN response. Incoming schedule changes must remain interactive by default; automatic responses are opt-in only.

**Why:** A shared physical test database must not weaken the production ownership boundary; direct AG-side availability checks caused the wrong domain to become authoritative.

**How to apply:** Keep schedule-change acceptance split into Dataspace transport, AN-local evaluation, and AG-only response application. Treat delivery failure and incomplete correlation/participant validation as non-committing outcomes. Never infer an AN response from an inbound proposal unless a caller explicitly opts into automation.

Schedule changes form a single versioned SCHEDULE_CHANGE child-policy chain. The agreed period changes only after an atomically claimed acceptance; the accepted response must repeat the exact proposed window, and the previously effective schedule policy is then superseded.

**Why:** Applying response dates before winning resolution allowed concurrent or altered responses to overwrite the agreement outside the reviewed child policy.

**How to apply:** Serialize proposal resolution per request, re-check the root policy at acceptance time, reject changed accepted windows as counterproposals, and ensure only one schedule policy version is effective.
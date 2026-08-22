---
name: Coordination regression contracts
description: Canonical test expectations for Leistungsanfrage coordination and resource-backed fixtures.
---

The current coordination contract treats response submission as idempotent (200 on an existing or newly processed response), reports UNKNOWN when no transport outbox row is available, and requires resource creation fixtures to provide an organisation-owned ResourceType.

**Why:** The coordination model moved away from proposal-before-agreement and legacy response/resource assumptions; older regression fixtures otherwise fail before exercising their intended assertions.

**How to apply:** When restoring API or UI regressions, verify request lifecycle states, canonical German Leistungsanfrage payloads, linked resource types, and current component prop shapes before changing production behavior.
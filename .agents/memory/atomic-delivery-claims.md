---
name: Atomic delivery claims
description: Concurrency rule for retrying persisted outbound messages without losing connector attempts.
---

## Rule
Claim a retry with one conditional database update that requires the expected current status, transitions the outbox row to SENT, and increments its attempt count from the stored value. A caller that updates zero rows must not call the connector.

**Why:** Two callers can read the same FAILED attempt before either writes. Computing the next number in application memory lets both connector calls share a number; a unique history constraint then drops one record rather than preventing the duplicate delivery.

**How to apply:** Use the returned row's atomically incremented attempt count for the connector result and immutable history. Keep final success/failure updates tied to the claimed outbox row, and treat a losing claim as a retry race.
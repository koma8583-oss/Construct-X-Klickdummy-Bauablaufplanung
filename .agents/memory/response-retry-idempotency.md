---
name: Response retry idempotency
description: Retry payloads must be deterministic across the first send and every later delivery attempt.
---

## Rule
For an idempotent AN response retry, generate both the first outbound envelope and every
later retry from the persisted AN response representation. Do not mix a freshly created
timestamp or date-only request input into the first envelope and then reconstruct it from
database timestamps on retry.

## Why
Dataspace inbound/outbound idempotency compares the full persisted envelope. A first payload
that uses a transient timestamp but a retry that uses the database-generated timestamp has
the same business content but a different envelope, so the exchange correctly rejects it as
a message-ID conflict.

## How to apply
When a route retries a deterministic message ID, build the publish payload from the saved
response (including its created time, normalized dates, alternatives, and conditions) on the
initial send as well as the retry. This preserves valid redelivery without bypassing the
dataspace exchange.

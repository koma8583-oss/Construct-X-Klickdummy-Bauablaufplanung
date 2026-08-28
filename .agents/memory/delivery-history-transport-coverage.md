---
name: Delivery history transport coverage
description: Delivery-attempt history must cover both shared and connector-specific outbound paths.
---

When adding immutable delivery-attempt history, update every outbound adapter that can write or transition the outbox directly; a shared transport hook cannot cover connector-specific implementations.

**Why:** The Tractus-X adapter persists invitation messages itself instead of using the local hub transport, so updating only the common transport silently omits external connector attempts.

**How to apply:** Search for all code paths that create, send, retry, or update the relevant outbox rows, and record the same attempt number, timestamp, status, and failure reason in each path.
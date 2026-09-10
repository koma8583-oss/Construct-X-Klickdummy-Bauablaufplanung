---
name: Booking cancellation concurrency
description: Concurrency rule for AN booking cancellation and confirmed edits.
---

Cancellation is a terminal booking state and must use the same per-AN transaction advisory lock as confirmed booking edits. A confirmed edit must re-check the booking after acquiring that lock so a cancellation that committed first cannot be reversed.

**Why:** Reading the booking before entering the transaction lets a confirmed edit overwrite a cancellation committed between the read and the write.

**How to apply:** Keep cancellation and capacity-increasing edits in the same lock domain; if the edit acquires the lock first, let the later cancellation win, and if cancellation acquires it first, reject the stale edit with a conflict.
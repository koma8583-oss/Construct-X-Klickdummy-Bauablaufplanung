---
name: AN schedule proposal phase
description: Persisted AN request status and open bilateral proposals jointly determine whether the response phase must reopen after a reload.
---

An open schedule proposal should force the AN response phase after a request has already reached a persisted response or agreement state, while draft or `UNDER_REVIEW` fixtures may continue through the normal availability flow.

**Why:** A reload can return an old request status together with a newly projected bilateral proposal; treating either value alone as authoritative hid the required AG counterproposal response and caused the release browser gate to fail.

**How to apply:** Derive the phase from both the persisted status and coordination projection, and keep unit-test fixtures that model pre-response drafts from being promoted prematurely.
---
name: CI gate conclusions
description: Reliability rules for treating browser automation as a release-blocking status.
---

A required browser gate must prove that every mandatory project discovered and executed tests, with no skipped or flaky results. Listing tests, accepting Playwright's skipped/neutral outcome, or allowing retries to turn an initial failure green is not release evidence.

**Why:** Standard test-runner exit codes can be successful even when required work was skipped or a retry hid the first failure. Proxy readiness checks can also produce false readiness when any HTTP response, including an upstream 502, is accepted.

**How to apply:** Name mandatory projects explicitly, disable or fail on retries/flakes, validate the machine-readable report, and require the exact expected readiness status before starting tests. Keep the final CI job unconditional and require its exact check name in repository protection.
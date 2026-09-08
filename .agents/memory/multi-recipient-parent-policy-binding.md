---
name: Multi-recipient Parent-Policy binding
description: Policy identity rules for atomic Leistungsanfrage batches sent to several AN organizations.
---

Every recipient in a multi-AN request batch must carry its own accepted Parent-Policy ID and version. A single shared Parent Policy must never authorize several recipient organizations.

**Why:** Parent policies bind both the project capability and the recipient identity. Reusing one recipient's agreement for another recipient can bypass tenant boundaries even when the batch-level purpose and selected fields are identical.

**How to apply:** Keep common request fields at batch level, but place `nuOrgId`, `parentPolicyId`, and `parentPolicyVersion` together per recipient. Validate every binding through the same single-request policy service and roll back the whole batch if any recipient fails.
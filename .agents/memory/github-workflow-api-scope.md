---
name: GitHub workflow API scope
description: GitHub connector behavior when reading or writing files under .github/workflows.
---

The connected GitHub API can return 403 for `.github/workflows/*` contents operations even when repository administration endpoints work. Treat that response as a workflow-specific API scope limitation, not proof that the repository is inaccessible.

**Why:** Branch protection and repository metadata were writable, while the contents endpoint rejected the workflow path during release-gate verification.

**How to apply:** Verify repository settings through the GitHub protection API and use an approved Git transport or repository-level workflow for publishing workflow files; do not expose credentials or assume a generic contents retry will fix the 403.
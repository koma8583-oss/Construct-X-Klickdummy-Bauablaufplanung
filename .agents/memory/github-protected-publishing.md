---
name: GitHub protected publishing
description: Publishing merged Replit work to a protected GitHub main branch through the connected GitHub integration.
---

Protected `main` must be updated through a pull request that satisfies the repository’s required release-gate check; direct pushes and direct Contents API writes to `main` are rejected.

**Why:** The repository intentionally enforces release-gate validation before changes reach the default branch.

**How to apply:** Preserve the verified local tree, create a dedicated branch from the current remote `main`, open a PR, and let the required checks run. The connected GitHub API may reject writes under `.github/workflows`; do not bypass that protection or request a token in chat.
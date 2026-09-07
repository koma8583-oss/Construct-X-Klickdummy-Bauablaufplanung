# CI release gate

The repository's required CI check is the single GitHub Actions job named
`Quality and release gate` in `.github/workflows/ci.yml`.

The job is intentionally one blocking sequence. It must fail when any of these
steps fails or does not run:

1. Shared PostgreSQL test schema initialization.
2. Typechecks for the API, GU, and NU applications.
3. API, GU, and NU unit/component tests.
4. A full workspace build.
5. The real Playwright suite, which runs both the `desktop` and `mobile`
   projects from `e2e/playwright.config.ts`.

The browser step invokes `pnpm run e2e`, not `--list`. It builds the apps,
starts the API and all three built SPAs, routes `/`, `/an/`, `/hub/`, and API
paths through `scripts/ci-proxy.mjs`, and then runs the authenticated business
workflows. A skipped browser project or a non-zero test result makes the job
red.

## Required repository settings

Branch protection is a GitHub repository setting and is not represented by
source files. An administrator must configure the default branch with:

- Require a pull request before merging.
- Require the status check `Quality and release gate`.
- Require the branch to be up to date before merging.
- Require conversation resolution.
- Do not allow administrators to bypass the required status check.
- Do not treat skipped or cancelled required workflows as successful.

The exact check name is the job name above, not the workflow display name.
If the repository uses a ruleset instead of classic branch protection, add the
same job as a required workflow status check. Keep this file synchronized if
the job name changes.
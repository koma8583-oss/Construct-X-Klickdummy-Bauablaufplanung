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

The browser step invokes `pnpm run e2e:ci`, not `--list`. That command names
both required Playwright projects explicitly and uses one worker so the shared
test database is deterministic. The workflow builds the apps,
starts the API and all three built SPAs, routes `/`, `/an/`, `/hub/`, and API
paths through `scripts/ci-proxy.mjs`, and then runs the authenticated business
workflows. Playwright retries are disabled in CI, so an initial failure cannot
be converted into a green flaky result. The generated JSON report is checked by
`scripts/assert-playwright-ci.mjs`; each required project must discover and
execute tests, with zero skipped or flaky results. A missing project, skipped
test, or non-zero test result makes the job red.

## Required repository settings

Branch protection is a GitHub repository setting and is not represented by
source files. An administrator must configure the default branch with:

- Require a pull request before merging.
- Require the status check `Quality and release gate`.
- Require the branch to be up to date before merging.
- Require conversation resolution.
- Do not allow administrators to bypass the required status check.

The exact check name is the job name above, not the workflow display name.
If the repository uses a ruleset instead of classic branch protection, add the
same job as a required workflow status check. GitHub does not provide a
separate branch-protection switch that turns every skipped/neutral conclusion
into a failure. This workflow therefore has no path filters or job-level
conditions that can skip the required job; cancelled runs do not produce the
successful required check needed for the current commit. Keep this file
synchronized if the job name changes.

## Protection drift audit

The repository also contains an authenticated audit at
`scripts/audit-release-gate.mjs`. It reads the repository's current default
branch and fails with an actionable message if any of the settings above are
missing, renamed, no longer strict, or bypassable by administrators:

```sh
GH_TOKEN="$RELEASE_GATE_AUDIT_TOKEN" \
  GITHUB_REPOSITORY=OWNER/REPOSITORY \
  node scripts/audit-release-gate.mjs
```

The token is read only from the environment. It must belong to a maintainer
with repository metadata and **Administration: read** access. Never put it in
this repository, a workflow file, or command output.

`Release gate protection audit` runs this check for pull requests through
`pull_request_target`, manually through `workflow_dispatch`, and on weekday
mornings from `.github/workflows/release-gate-protection.yml`. Configure the
repository Actions secret `RELEASE_GATE_AUDIT_TOKEN` before enabling the
scheduled check.
The workflow checks out the committed script and never checks out pull-request
code, so the maintainer credential is not exposed to untrusted changes.

The script targets classic branch protection, whose API exposes all five
settings directly. Repositories using rulesets must configure the equivalent
ruleset protections and review them with the same checklist; the audit fails
closed when classic protection is absent rather than treating an unverified
ruleset as compliant.

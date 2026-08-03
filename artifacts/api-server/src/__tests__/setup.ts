/**
 * Global Vitest setup — runs in every test worker before any test file.
 *
 * Sets environment variables required by tests so they are available
 * via process.env regardless of how the test runner boots.
 */

// Internal job token used by t79 tests.
// The actual production value is set as a Replit Secret (INTERNAL_JOB_TOKEN).
// This fallback lets tests run in CI without a real secret.
if (!process.env.INTERNAL_JOB_TOKEN) {
  process.env.INTERNAL_JOB_TOKEN = "ci-test-internal-token-do-not-use-in-prod";
}

// Allow internal routes in all test runs
process.env.INTERNAL_ROUTES_ENABLED = "true";

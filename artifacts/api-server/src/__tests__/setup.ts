/**
 * Global Vitest setup — runs before the test files.
 *
 * Sets environment variables required by tests so they are available
 * via process.env regardless of how the test runner boots.
 */

// The API tests import the app directly instead of starting index.ts. Pin the
// same non-production behavior that the test suite expects on every runner.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

// Tests use the intentional single-database PoC setup. Production startup
// never inherits this flag because it is rejected by the database guard.
if (!process.env.TAKTKOORD_SHARED_DATABASE_POC) {
  process.env.TAKTKOORD_SHARED_DATABASE_POC = "true";
}

// Internal job token used by t79 tests.
// The actual production value is set as a Replit Secret (INTERNAL_JOB_TOKEN).
// This fallback lets tests run in CI without a real secret.
if (!process.env.INTERNAL_JOB_TOKEN) {
  process.env.INTERNAL_JOB_TOKEN = "ci-test-internal-token-do-not-use-in-prod";
}

// Allow internal routes in all test runs
process.env.INTERNAL_ROUTES_ENABLED = "true";

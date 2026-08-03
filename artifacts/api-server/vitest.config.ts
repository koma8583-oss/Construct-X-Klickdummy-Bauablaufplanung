import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // Fixed token used in all test runs. Production must set INTERNAL_JOB_TOKEN
      // via environment secrets to a cryptographically secure value.
      INTERNAL_JOB_TOKEN: "ci-test-internal-token-do-not-use-in-prod",
      // Allow internal routes in test environment
      INTERNAL_ROUTES_ENABLED: "true",
    },
  },
});

/**
 * Global Vitest setup — runs before every API test file.
 *
 * The API tests import the app directly instead of starting index.ts. Keep the
 * same non-production environment and also run startup-equivalent canonical
 * policy seeding so tests never depend on a developer database having been
 * seeded beforehand.
 */

import { runWithDatabaseRole } from "@workspace/db";
import { seedPolicyTemplates } from "../lib/seed-policy-templates";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

if (!process.env.INTERNAL_JOB_TOKEN) {
  process.env.INTERNAL_JOB_TOKEN = "ci-test-internal-token-do-not-use-in-prod";
}

process.env.INTERNAL_ROUTES_ENABLED = "true";

// index.ts normally performs this at service startup. Vitest imports app.ts
// directly, so reproduce only that deterministic startup prerequisite here.
// The seed is idempotent and runs through the AG role because policy_templates
// is AG-owned in the shared physical database.
await runWithDatabaseRole("ag", async () => {
  await seedPolicyTemplates();
});

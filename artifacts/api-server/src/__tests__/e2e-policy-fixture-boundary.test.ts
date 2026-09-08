import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BUSINESS_STATE_TABLES = [
  "projectMembershipsTable",
  "coordinationPoliciesTable",
  "leistungsanfragenTable",
  "taktRequestSnapshotsTable",
  "dataspaceExchangesTable",
  "anLeistungsanfragenTable",
  "taktResponsesTable",
  "anTaktResponsesTable",
  "serviceChangeProposalsTable",
] as const;

describe("Campus-West E2E fixture boundary", () => {
  it("creates policy and coordination state only through product workflows", () => {
    const seedSource = readFileSync(
      new URL("../../../../e2e/campus-west-seed.ts", import.meta.url),
      "utf8",
    );

    for (const table of BUSINESS_STATE_TABLES) {
      expect(seedSource, `${table} must not be inserted by the E2E seed`)
        .not.toMatch(new RegExp(`\\.insert\\(\\s*${table}\\s*\\)`));
    }
  });
});
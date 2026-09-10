import { expect, test } from "@playwright/test";
import { seedCampusWestScenario } from "../fixtures";
import type { Seed } from "../campus-west-seed";

const acceptedModes = "within, consent, denied, or full";

test.describe("Campus-West fixture contract", () => {
  for (const [label, scenarioMode] of [
    ["omitted", undefined],
    ["unsupported", "not-a-real-mode"],
  ] as const) {
    test(`rejects an ${label} scenario mode before seeding`, async () => {
      let seedCalls = 0;
      const seedFactory = async () => {
        seedCalls += 1;
        throw new Error(
          "seedCampusWest must not be called for an invalid mode",
        );
      };

      await expect(
        seedCampusWestScenario(scenarioMode, seedFactory),
      ).rejects.toThrow(
        `Campus-West scenarioMode must be one of ${acceptedModes}`,
      );
      expect(seedCalls).toBe(0);
    });
  }

  test("cleans a completed seed when scenario preparation fails", async () => {
    const seed = { runId: "campus-west-test-seed" } as Seed;
    const preparationError = new Error("authenticated preparation failed");
    let cleanupCalls = 0;

    await expect(
      seedCampusWestScenario(
        "within",
        async () => seed,
        async () => {
          throw preparationError;
        },
        async (cleanedSeed) => {
          cleanupCalls += 1;
          expect(cleanedSeed).toBe(seed);
          throw new Error("cleanup failed");
        },
      ),
    ).rejects.toBe(preparationError);
    expect(cleanupCalls).toBe(1);
  });
});

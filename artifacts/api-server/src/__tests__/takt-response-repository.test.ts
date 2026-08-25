/**
 * Tests for the business-rule validation in takt-response-repository.ts.
 *
 * The validateTaktResponse function runs synchronously before any DB write,
 * so we can exercise every rule by mocking the @workspace/db module to avoid
 * a real database connection.  For the "valid" cases we return a minimal fake
 * row so the function can complete without error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTaktResponse,
  TaktResponseValidationError,
  type CreateTaktResponseInput,
} from "../lib/takt-response-repository";

// ── Mock the DB module ────────────────────────────────────────────────────────

// We mock @workspace/db so no real Postgres connection is required.
// For invalid inputs the validation throws before db.transaction is reached,
// so the mock only matters for the happy-path tests.
vi.mock("@workspace/db", () => {
  const fakeResponse = {
    id: "resp-1",
    taktRequestId: "req-1",
    messageId: null,
    decision: "ACCEPTED",
    reasonCode: null,
    comment: null,
    acceptedStart: new Date("2026-09-01"),
    acceptedEnd: new Date("2026-09-05"),
    nextAvailableDate: null,
    createdByUserId: "user-1",
    createdAt: new Date(),
  };

  return {
    agDb: {
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        // Provide a minimal tx object that simulates insert().values().returning()
        const tx = {
          insert: () => ({
            values: () => ({
              returning: vi.fn(async () => [fakeResponse]),
            }),
          }),
        };
        return cb(tx);
      }),
    },
    taktResponsesTable: {},
    taktResponseAlternativesTable: {},
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseInput(
  overrides: Partial<CreateTaktResponseInput> = {},
): CreateTaktResponseInput {
  return {
    taktRequestId: "req-1",
    decision: "REJECTED",
    createdByUserId: "user-1",
    ...overrides,
  };
}

const start = new Date("2026-09-01T08:00:00Z");
const end = new Date("2026-09-05T17:00:00Z");

// ── ACCEPTED validation ───────────────────────────────────────────────────────

describe("ACCEPTED decision — time-window rules", () => {
  it("throws TaktResponseValidationError when acceptedStart is missing", async () => {
    await expect(
      createTaktResponse(baseInput({ decision: "ACCEPTED", acceptedEnd: end })),
    ).rejects.toThrow(TaktResponseValidationError);

    await expect(
      createTaktResponse(baseInput({ decision: "ACCEPTED", acceptedEnd: end })),
    ).rejects.toThrow("acceptedStart and acceptedEnd");
  });

  it("throws TaktResponseValidationError when acceptedEnd is missing", async () => {
    await expect(
      createTaktResponse(
        baseInput({ decision: "ACCEPTED", acceptedStart: start }),
      ),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("throws TaktResponseValidationError when neither acceptedStart nor acceptedEnd is provided", async () => {
    await expect(
      createTaktResponse(baseInput({ decision: "ACCEPTED" })),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("throws TaktResponseValidationError when acceptedEnd equals acceptedStart (zero-length window)", async () => {
    await expect(
      createTaktResponse(
        baseInput({
          decision: "ACCEPTED",
          acceptedStart: start,
          acceptedEnd: start, // same instant — not valid
        }),
      ),
    ).rejects.toThrow(/acceptedEnd must be after acceptedStart/);
  });

  it("throws TaktResponseValidationError when acceptedEnd is before acceptedStart (reversed window)", async () => {
    await expect(
      createTaktResponse(
        baseInput({
          decision: "ACCEPTED",
          acceptedStart: end, // later date used as start
          acceptedEnd: start, // earlier date used as end
        }),
      ),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("passes validation for ACCEPTED with a valid time window", async () => {
    await expect(
      createTaktResponse(
        baseInput({ decision: "ACCEPTED", acceptedStart: start, acceptedEnd: end }),
      ),
    ).resolves.toBeDefined();
  });
});

// ── ALTERNATIVES_PROPOSED validation ─────────────────────────────────────────

describe("ALTERNATIVES_PROPOSED decision — alternatives rules", () => {
  it("throws TaktResponseValidationError when no alternatives are provided", async () => {
    await expect(
      createTaktResponse(baseInput({ decision: "ALTERNATIVES_PROPOSED" })),
    ).rejects.toThrow(TaktResponseValidationError);

    await expect(
      createTaktResponse(baseInput({ decision: "ALTERNATIVES_PROPOSED" })),
    ).rejects.toThrow("at least one alternative");
  });

  it("throws TaktResponseValidationError when alternatives array is empty", async () => {
    await expect(
      createTaktResponse(
        baseInput({ decision: "ALTERNATIVES_PROPOSED", alternatives: [] }),
      ),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("throws TaktResponseValidationError when more than 3 alternatives are provided", async () => {
    const makeAlt = (n: number) => ({
      alternativeId: `alt-${n}`,
      rank: n,
      proposedStart: start,
      proposedEnd: end,
    });

    await expect(
      createTaktResponse(
        baseInput({
          decision: "ALTERNATIVES_PROPOSED",
          alternatives: [makeAlt(1), makeAlt(2), makeAlt(3), makeAlt(4)],
        }),
      ),
    ).rejects.toThrow(/at most 3 alternatives/);
  });

  it("throws TaktResponseValidationError for duplicate alternativeId across alternatives", async () => {
    await expect(
      createTaktResponse(
        baseInput({
          decision: "ALTERNATIVES_PROPOSED",
          alternatives: [
            { alternativeId: "dup", rank: 1, proposedStart: start, proposedEnd: end },
            { alternativeId: "dup", rank: 2, proposedStart: start, proposedEnd: end },
          ],
        }),
      ),
    ).rejects.toThrow(/duplicate alternativeId/);
  });

  it("throws TaktResponseValidationError for duplicate rank across alternatives", async () => {
    await expect(
      createTaktResponse(
        baseInput({
          decision: "ALTERNATIVES_PROPOSED",
          alternatives: [
            { alternativeId: "alt-a", rank: 1, proposedStart: start, proposedEnd: end },
            { alternativeId: "alt-b", rank: 1, proposedStart: start, proposedEnd: end }, // same rank
          ],
        }),
      ),
    ).rejects.toThrow(/duplicate rank/);
  });

  it("throws TaktResponseValidationError when an alternative has a reversed time window", async () => {
    await expect(
      createTaktResponse(
        baseInput({
          decision: "ALTERNATIVES_PROPOSED",
          alternatives: [
            {
              alternativeId: "alt-bad",
              rank: 1,
              proposedStart: end,   // reversed: later date as start
              proposedEnd: start,   // earlier date as end
            },
          ],
        }),
      ),
    ).rejects.toThrow(/proposedEnd must be after proposedStart/);
  });

  it("passes validation for ALTERNATIVES_PROPOSED with 3 valid, unique alternatives", async () => {
    await expect(
      createTaktResponse(
        baseInput({
          decision: "ALTERNATIVES_PROPOSED",
          alternatives: [
            { alternativeId: "alt-1", rank: 1, proposedStart: start, proposedEnd: end },
            {
              alternativeId: "alt-2",
              rank: 2,
              proposedStart: new Date("2026-09-10T08:00:00Z"),
              proposedEnd: new Date("2026-09-14T17:00:00Z"),
            },
            {
              alternativeId: "alt-3",
              rank: 3,
              proposedStart: new Date("2026-09-17T08:00:00Z"),
              proposedEnd: new Date("2026-09-21T17:00:00Z"),
            },
          ],
        }),
      ),
    ).resolves.toBeDefined();
  });
});

// ── REJECTED validation ───────────────────────────────────────────────────────

describe("REJECTED decision", () => {
  it("passes validation with no time window and no alternatives", async () => {
    await expect(
      createTaktResponse(baseInput({ decision: "REJECTED" })),
    ).resolves.toBeDefined();
  });

  it("passes validation with an optional reasonCode and comment", async () => {
    await expect(
      createTaktResponse(
        baseInput({
          decision: "REJECTED",
          reasonCode: "CAPACITY",
          comment: "No capacity available in the requested window.",
        }),
      ),
    ).resolves.toBeDefined();
  });
});

// ── Comment length validation ─────────────────────────────────────────────────

describe("comment length", () => {
  it("throws TaktResponseValidationError when comment exceeds 2000 characters", async () => {
    await expect(
      createTaktResponse(
        baseInput({ decision: "REJECTED", comment: "x".repeat(2001) }),
      ),
    ).rejects.toThrow(/comment must not exceed 2000 characters/);
  });

  it("passes validation when comment is exactly 2000 characters", async () => {
    await expect(
      createTaktResponse(
        baseInput({ decision: "REJECTED", comment: "x".repeat(2000) }),
      ),
    ).resolves.toBeDefined();
  });
});

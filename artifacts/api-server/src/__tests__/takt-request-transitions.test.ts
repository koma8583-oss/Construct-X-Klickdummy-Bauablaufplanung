import { describe, it, expect } from "vitest";
import {
  isValidTaktRequestTransition,
  assertValidTaktRequestTransition,
  getAllowedNextStatuses,
  TERMINAL_TAKT_REQUEST_STATUSES,
  type TaktRequestStatus,
} from "../lib/takt-request-transitions";

// ── Valid forward transitions ─────────────────────────────────────────────────

describe("isValidTaktRequestTransition — valid forward transitions", () => {
  const validCases: [TaktRequestStatus, TaktRequestStatus][] = [
    ["DRAFT", "SENT"],
    ["DRAFT", "CANCELLED"],
    ["SENT", "DELIVERED"],
    ["SENT", "CANCELLED"],
    ["SENT", "EXPIRED"],
    ["DELIVERED", "DETAILS_RETRIEVED"],
    ["DELIVERED", "UNDER_REVIEW"],
    ["DELIVERED", "CANCELLED"],
    ["DELIVERED", "EXPIRED"],
    ["DETAILS_RETRIEVED", "UNDER_REVIEW"],
    ["DETAILS_RETRIEVED", "ACCEPTED"],
    ["DETAILS_RETRIEVED", "ALTERNATIVES_PROPOSED"],
    ["DETAILS_RETRIEVED", "REJECTED"],
    ["DETAILS_RETRIEVED", "CANCELLED"],
    ["DETAILS_RETRIEVED", "EXPIRED"],
    ["UNDER_REVIEW", "ACCEPTED"],
    ["UNDER_REVIEW", "ALTERNATIVES_PROPOSED"],
    ["UNDER_REVIEW", "REJECTED"],
    ["UNDER_REVIEW", "CANCELLED"],
    ["UNDER_REVIEW", "EXPIRED"],
    ["ALTERNATIVES_PROPOSED", "ACCEPTED"],
    ["ALTERNATIVES_PROPOSED", "REVISION_REQUIRED"],
    ["ALTERNATIVES_PROPOSED", "SUPERSEDED"],
    ["REJECTED", "REVISION_REQUIRED"],
    ["REJECTED", "SUPERSEDED"],
    ["REVISION_REQUIRED", "SUPERSEDED"],
  ];

  for (const [from, to] of validCases) {
    it(`allows ${from} → ${to}`, () => {
      expect(isValidTaktRequestTransition(from, to)).toBe(true);
    });
  }
});

// ── Invalid backward / skipping transitions ───────────────────────────────────

describe("isValidTaktRequestTransition — invalid transitions", () => {
  const invalidCases: [TaktRequestStatus, TaktRequestStatus][] = [
    ["SENT", "DRAFT"],
    ["DELIVERED", "DRAFT"],
    ["DELIVERED", "SENT"],
    ["ACCEPTED", "SENT"],
    ["UNDER_REVIEW", "DRAFT"],
    ["REJECTED", "ACCEPTED"],   // rejected does not directly accept
    ["REVISION_REQUIRED", "ACCEPTED"], // must go through a new request
    ["EXPIRED", "SENT"],        // terminal → anything is invalid
    ["SUPERSEDED", "DRAFT"],    // terminal
    ["CANCELLED", "SENT"],      // terminal
    // Note: "CONFIRMED" is a TaktLifecycleStatus, not a TaktRequestStatus — tested separately below
  ];

  for (const [from, to] of invalidCases) {
    it(`rejects ${from} → ${to}`, () => {
      expect(isValidTaktRequestTransition(from, to)).toBe(false);
    });
  }
});

// ── DELIVERED ≠ ACCEPTED boundary ─────────────────────────────────────────────

describe("DELIVERED is a transport state, not a business confirmation", () => {
  it("DELIVERED → ACCEPTED is NOT valid", () => {
    expect(isValidTaktRequestTransition("DELIVERED", "ACCEPTED")).toBe(false);
  });

  it("DELIVERED → ALTERNATIVES_PROPOSED is NOT valid", () => {
    expect(isValidTaktRequestTransition("DELIVERED", "ALTERNATIVES_PROPOSED")).toBe(false);
  });

  it("DELIVERED → REJECTED is NOT valid", () => {
    expect(isValidTaktRequestTransition("DELIVERED", "REJECTED")).toBe(false);
  });

  it("DELIVERED → DETAILS_RETRIEVED is valid (NU pulled the details)", () => {
    expect(isValidTaktRequestTransition("DELIVERED", "DETAILS_RETRIEVED")).toBe(true);
  });

  it("DETAILS_RETRIEVED → ACCEPTED is valid (NU reviewed and confirmed)", () => {
    expect(isValidTaktRequestTransition("DETAILS_RETRIEVED", "ACCEPTED")).toBe(true);
  });
});

// ── Terminal states ────────────────────────────────────────────────────────────

describe("terminal states have no outgoing transitions", () => {
  const terminals: TaktRequestStatus[] = [
    "ACCEPTED",
    "CANCELLED",
    "EXPIRED",
    "SUPERSEDED",
  ];

  for (const status of terminals) {
    it(`${status} is in TERMINAL_TAKT_REQUEST_STATUSES`, () => {
      expect(TERMINAL_TAKT_REQUEST_STATUSES.has(status)).toBe(true);
    });

    it(`${status} → DRAFT is invalid`, () => {
      expect(isValidTaktRequestTransition(status, "DRAFT")).toBe(false);
    });

    it(`${status} → SENT is invalid`, () => {
      expect(isValidTaktRequestTransition(status, "SENT")).toBe(false);
    });

    it(`getAllowedNextStatuses(${status}) returns empty array`, () => {
      expect(getAllowedNextStatuses(status)).toHaveLength(0);
    });
  }
});

// ── Explicitly required test pairs (Task 2.2) ─────────────────────────────────

describe("Named transition tests required by Task 2.2", () => {
  // Valid transitions
  it("DRAFT → SENT is valid", () => {
    expect(isValidTaktRequestTransition("DRAFT", "SENT")).toBe(true);
  });
  it("SENT → DELIVERED is valid", () => {
    expect(isValidTaktRequestTransition("SENT", "DELIVERED")).toBe(true);
  });
  it("DELIVERED → DETAILS_RETRIEVED is valid", () => {
    expect(isValidTaktRequestTransition("DELIVERED", "DETAILS_RETRIEVED")).toBe(true);
  });
  it("UNDER_REVIEW → ACCEPTED is valid", () => {
    expect(isValidTaktRequestTransition("UNDER_REVIEW", "ACCEPTED")).toBe(true);
  });
  it("UNDER_REVIEW → ALTERNATIVES_PROPOSED is valid", () => {
    expect(isValidTaktRequestTransition("UNDER_REVIEW", "ALTERNATIVES_PROPOSED")).toBe(true);
  });
  it("REJECTED → REVISION_REQUIRED is valid", () => {
    expect(isValidTaktRequestTransition("REJECTED", "REVISION_REQUIRED")).toBe(true);
  });

  // Invalid transitions — explicit pairs named in Task 2.2
  it("DELIVERED → DRAFT is invalid (backward jump)", () => {
    expect(isValidTaktRequestTransition("DELIVERED", "DRAFT")).toBe(false);
  });
  it("ACCEPTED → UNDER_REVIEW is invalid (terminal state)", () => {
    expect(isValidTaktRequestTransition("ACCEPTED", "UNDER_REVIEW")).toBe(false);
  });
  it("EXPIRED → ACCEPTED is invalid (terminal state)", () => {
    expect(isValidTaktRequestTransition("EXPIRED", "ACCEPTED")).toBe(false);
  });

  // DELIVERED ≠ ACCEPTED distinction
  it("DELIVERED status does not mean business acceptance — DELIVERED → ACCEPTED is invalid", () => {
    expect(isValidTaktRequestTransition("DELIVERED", "ACCEPTED")).toBe(false);
  });
});

// ── assertValidTaktRequestTransition ──────────────────────────────────────────

describe("assertValidTaktRequestTransition", () => {
  it("does not throw for valid transitions", () => {
    expect(() =>
      assertValidTaktRequestTransition("DRAFT", "SENT"),
    ).not.toThrow();
  });

  it("throws a descriptive Error for invalid transitions", () => {
    expect(() =>
      assertValidTaktRequestTransition("SENT", "DRAFT"),
    ).toThrow(/Invalid TaktRequest status transition/);
  });

  it("includes 'terminal' in the error for terminal-state transitions", () => {
    expect(() =>
      assertValidTaktRequestTransition("ACCEPTED", "SENT"),
    ).toThrow(/terminal/);
  });

  it("error message names both statuses for non-terminal invalid transitions", () => {
    expect(() =>
      assertValidTaktRequestTransition("REJECTED", "ACCEPTED"),
    ).toThrow(/REJECTED.*ACCEPTED/);
  });
});

// ── getAllowedNextStatuses ─────────────────────────────────────────────────────

describe("getAllowedNextStatuses", () => {
  it("DRAFT can go to SENT and CANCELLED", () => {
    const allowed = getAllowedNextStatuses("DRAFT");
    expect(allowed).toContain("SENT");
    expect(allowed).toContain("CANCELLED");
    expect(allowed).not.toContain("DELIVERED");
  });

  it("UNDER_REVIEW has all three business decision options", () => {
    const allowed = getAllowedNextStatuses("UNDER_REVIEW");
    expect(allowed).toContain("ACCEPTED");
    expect(allowed).toContain("ALTERNATIVES_PROPOSED");
    expect(allowed).toContain("REJECTED");
  });

  it("ALTERNATIVES_PROPOSED cannot go back to DELIVERED", () => {
    const allowed = getAllowedNextStatuses("ALTERNATIVES_PROPOSED");
    expect(allowed).not.toContain("DELIVERED");
    expect(allowed).not.toContain("DRAFT");
  });
});

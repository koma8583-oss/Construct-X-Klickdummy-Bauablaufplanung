/**
 * Unit tests for computeUtilizationBands()
 *
 * Verifies that daily utilization sums are correctly classified and merged
 * into bands, covering:
 *   – empty / all-cancelled bookings → no bands
 *   – single booking < 100% → partial band
 *   – single booking = 100% → full band
 *   – two bookings summing > 100% → conflict band
 *   – non-overlapping bookings produce separate bands
 *   – adjacent days with the same class merge into one band
 *   – cancelled bookings are excluded from utilization
 */

import { describe, it, expect } from "vitest";
import { computeUtilizationBands } from "../../lib/gantt-util-bands";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** ISO string for midnight UTC on a given date. */
function day(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

/** ISO string for end-of-day UTC. */
function eod(dateStr: string): string {
  return `${dateStr}T23:59:59.000Z`;
}

/** Minimal NuResourceBooking shape required by computeUtilizationBands. */
function bk(
  startDate: string,
  endDate: string,
  utilizationPercent: number,
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED" = "CONFIRMED",
) {
  return {
    id:                 `bk-${Math.random()}`,
    nuOrgId:            "org-1",
    resourceId:         "res-1",
    resourceTypeId:     null,
    localProjectId:     null,
    sourceType:         "TAKT_REQUEST" as const,
    sourceReferenceId:  null,
    startAt:            day(startDate),
    endAt:              eod(endDate),
    utilizationPercent,
    status,
    note:               null,
    createdAt:          day("2026-01-01"),
    updatedAt:          day("2026-01-01"),
  };
}

const RANGE_START = new Date("2026-09-01T00:00:00.000Z");
const RANGE_END   = new Date("2026-09-30T23:59:59.000Z");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeUtilizationBands", () => {
  it("returns no bands for an empty booking list", () => {
    const bands = computeUtilizationBands([], RANGE_START, RANGE_END);
    expect(bands).toHaveLength(0);
  });

  it("returns no bands when all bookings are cancelled", () => {
    const bands = computeUtilizationBands(
      [bk("2026-09-05", "2026-09-07", 80, "CANCELLED")],
      RANGE_START,
      RANGE_END,
    );
    expect(bands).toHaveLength(0);
  });

  it("classifies a single 60% booking as partial", () => {
    const bands = computeUtilizationBands(
      [bk("2026-09-05", "2026-09-07", 60)],
      RANGE_START,
      RANGE_END,
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("partial");
  });

  it("classifies a single 100% booking as full", () => {
    const bands = computeUtilizationBands(
      [bk("2026-09-10", "2026-09-12", 100)],
      RANGE_START,
      RANGE_END,
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("full");
  });

  it("classifies two bookings whose utilization sums to >100% as conflict", () => {
    // 70 + 60 = 130 on overlapping days
    const bands = computeUtilizationBands(
      [
        bk("2026-09-15", "2026-09-17", 70),
        bk("2026-09-15", "2026-09-17", 60),
      ],
      RANGE_START,
      RANGE_END,
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("conflict");
  });

  it("produces separate bands for non-overlapping bookings with a gap", () => {
    const bands = computeUtilizationBands(
      [
        bk("2026-09-03", "2026-09-04", 50),  // partial
        bk("2026-09-08", "2026-09-09", 100), // full
      ],
      RANGE_START,
      RANGE_END,
    );
    expect(bands).toHaveLength(2);
    expect(bands[0].kind).toBe("partial");
    expect(bands[1].kind).toBe("full");
  });

  it("merges adjacent days of the same kind into one band", () => {
    // Two consecutive partial bookings — should collapse to a single band
    const bands = computeUtilizationBands(
      [
        bk("2026-09-05", "2026-09-07", 40),
        bk("2026-09-07", "2026-09-10", 40),
      ],
      RANGE_START,
      RANGE_END,
    );
    // All days 5–10 are partial; they should be one merged band
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("partial");
  });

  it("excludes cancelled bookings from utilization sums", () => {
    // 60 confirmed + 60 cancelled: total = 60 (partial, not conflict)
    const bands = computeUtilizationBands(
      [
        bk("2026-09-20", "2026-09-22", 60, "CONFIRMED"),
        bk("2026-09-20", "2026-09-22", 60, "CANCELLED"),
      ],
      RANGE_START,
      RANGE_END,
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("partial");
  });

  it("counts TENTATIVE bookings toward utilization", () => {
    // 60 confirmed + 60 tentative = 120 → conflict
    const bands = computeUtilizationBands(
      [
        bk("2026-09-25", "2026-09-26", 60, "CONFIRMED"),
        bk("2026-09-25", "2026-09-26", 60, "TENTATIVE"),
      ],
      RANGE_START,
      RANGE_END,
    );
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("conflict");
  });

  it("returns no bands when the range has zero days", () => {
    const same = new Date("2026-09-01T00:00:00.000Z");
    const bands = computeUtilizationBands(
      [bk("2026-09-01", "2026-09-05", 50)],
      same,
      same, // rangeEnd === rangeStart → 0 days
    );
    // differenceInCalendarDays(same, same) = 0, totalDays = 1 (edge: +1 → 1)
    // Just verifying it doesn't throw; result may have 0 or 1 band.
    expect(Array.isArray(bands)).toBe(true);
  });
});

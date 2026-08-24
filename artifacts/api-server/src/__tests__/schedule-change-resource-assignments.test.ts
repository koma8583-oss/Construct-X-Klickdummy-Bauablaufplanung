import { describe, expect, it } from "vitest";
import {
  restoreConcreteResourceAssignments,
  shiftRequirementsToWindow,
} from "../services/resource-availability-service";

const oldStart = new Date("2026-09-01T00:00:00Z");
const oldEnd = new Date("2026-09-06T00:00:00Z");
const newStart = new Date("2026-09-08T00:00:00Z");

const resources = [
  { id: "resource-a", resourceTypeId: "type-crew", capacity: 1, active: true },
  { id: "resource-b", resourceTypeId: "type-crew", capacity: 1, active: true },
];

function requirement(overrides: Partial<{
  id: string;
  requiredCapacity: number;
  periodStart: string | null;
  periodEnd: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "requirement",
    resourceTypeId: "type-crew",
    requiredCapacity: overrides.requiredCapacity ?? 1,
    utilizationPercent: 100,
    periodStart: overrides.periodStart ?? null,
    periodEnd: overrides.periodEnd ?? null,
  };
}

function booking(id: string, resourceId: string, start: string, end: string) {
  return {
    id,
    resourceId,
    resourceTypeId: "type-crew",
    startAt: new Date(start),
    endAt: new Date(end),
    utilizationPercent: 100,
  };
}

describe("restoreConcreteResourceAssignments", () => {
  it("shifts an existing concrete assignment into the changed window", () => {
    const result = restoreConcreteResourceAssignments(
      [requirement()],
      [booking("booking-a", "resource-a", "2026-09-01T00:00:00Z", "2026-09-06T00:00:00Z")],
      resources,
      [],
      oldStart,
      oldEnd,
      newStart,
    );

    expect(result).toMatchObject([{ resourceId: "resource-a", quantity: 0 }]);
  });

  it("matches separate concrete resources to separate shifted segments", () => {
    const result = restoreConcreteResourceAssignments(
      [
        requirement({ id: "segment-a", periodStart: "2026-09-01", periodEnd: "2026-09-02" }),
        requirement({ id: "segment-b", periodStart: "2026-09-03", periodEnd: "2026-09-05" }),
      ],
      [
        booking("booking-a", "resource-a", "2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z"),
        booking("booking-b", "resource-b", "2026-09-03T00:00:00Z", "2026-09-06T00:00:00Z"),
      ],
      resources,
      [],
      oldStart,
      oldEnd,
      newStart,
    );

    expect(result.map((item) => item.resourceId)).toEqual(["resource-a", "resource-b"]);
  });

  it("falls back to a type-level booking when the concrete resource conflicts", () => {
    const result = restoreConcreteResourceAssignments(
      [requirement()],
      [booking("booking-a", "resource-a", "2026-09-01T00:00:00Z", "2026-09-06T00:00:00Z")],
      resources,
      [{
        resourceId: "resource-a",
        startAt: new Date("2026-09-08T00:00:00Z"),
        endAt: new Date("2026-09-13T00:00:00Z"),
      }],
      oldStart,
      oldEnd,
      newStart,
    );

    expect(result).toMatchObject([{ resourceId: null, quantity: 1 }]);
  });
});

describe("shiftRequirementsToWindow", () => {
  it("shifts from the currently stored agreement, including on a second change", () => {
    const first = shiftRequirementsToWindow(
      [{ periodStart: "2026-09-02", periodEnd: "2026-09-03" }],
      new Date("2026-09-01T08:00:00Z"),
      new Date("2026-09-06T08:00:00Z"),
    );
    expect(first).toEqual([{ periodStart: "2026-09-07", periodEnd: "2026-09-08" }]);

    const second = shiftRequirementsToWindow(
      first,
      new Date("2026-09-06T08:00:00Z"),
      new Date("2026-09-11T08:00:00Z"),
    );
    expect(second).toEqual([{ periodStart: "2026-09-12", periodEnd: "2026-09-13" }]);
    expect(second).not.toEqual([{ periodStart: "2026-09-17", periodEnd: "2026-09-18" }]);
  });

  it("uses calendar days rather than elapsed milliseconds", () => {
    const shifted = shiftRequirementsToWindow(
      [{ periodStart: "2026-10-24", periodEnd: "2026-10-25" }],
      new Date("2026-10-24T08:00:00+02:00"),
      new Date("2026-10-26T08:00:00+01:00"),
    );
    expect(shifted).toEqual([{ periodStart: "2026-10-26", periodEnd: "2026-10-27" }]);
  });
});
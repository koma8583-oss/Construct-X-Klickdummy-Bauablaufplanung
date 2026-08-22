/**
 * Gantt resource display tests
 *
 * 1. Cross-highlighting: clicking a booking bar selects it; second click deselects.
 * 2. Free resources: resources with no bookings still appear with a "frei" label.
 * 3. Type-level bookings: bookings with no resourceId render on the section row,
 *    without leaking project names (data privacy).
 * 4. No duplicate visual state: utilization bands on one section row do NOT
 *    affect unrelated rows.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ResourceGantt } from "../gantt";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeBooking(
  id: string,
  resourceId: string | null,
  opts: {
    sourceType?: string;
    sourceReferenceId?: string;
    utilizationPercent?: number;
    status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
    resourceTypeId?: string | null;
  } = {},
) {
  return {
    id,
    resourceId,
    resourceTypeId: opts.resourceTypeId ?? null,
    nuOrgId: "nu-org-1",
    sourceType: (opts.sourceType ?? "TAKT_REQUEST") as "TAKT_REQUEST",
    sourceReferenceId: opts.sourceReferenceId ?? "ref-1",
    localProjectId: null,
    startAt: "2026-09-02T08:00:00.000Z",
    endAt:   "2026-09-06T17:00:00.000Z",
    status: opts.status ?? ("CONFIRMED" as const),
    utilizationPercent: opts.utilizationPercent ?? 80,
    note: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const ALL_DATES = [
  { start: "2026-09-01T00:00:00.000Z", end: "2026-09-10T23:59:59.000Z" },
  { start: "2026-09-02T08:00:00.000Z", end: "2026-09-06T17:00:00.000Z" },
];

// ─── Section fixtures ─────────────────────────────────────────────────────────

/** Single section with one booked resource and optionally a free resource. */
function makeSingleSection(opts: {
  freeResource?: boolean;
  typeBookings?: ReturnType<typeof makeBooking>[];
}) {
  const bk1 = makeBooking("booking-1", "res-1");

  const resources = [
    { id: "res-1", name: "Bagger 01", bookings: [bk1] },
    ...(opts.freeResource
      ? [{ id: "res-2", name: "Bagger 02", bookings: [] }]
      : []),
  ];

  return [
    {
      id: "section-a",
      name: "Sektion A",
      resources,
      typeBookings: opts.typeBookings ?? [],
    },
  ];
}

// ─── Tests: booking bar interaction ──────────────────────────────────────────

describe("ResourceGantt — booking bar interaction", () => {
  it("selects a booking bar on click and shows its resource name label", async () => {
    const user = userEvent.setup();

    render(
      <ResourceGantt
        sections={makeSingleSection({})}
        allDates={ALL_DATES}
        viewMode="month"
        localProjectMap={new Map()}
        taktProjectMap={new Map()}
      />,
    );

    const bars = await screen.findAllByTitle(/Externer Auftrag/);
    expect(bars.length).toBeGreaterThan(0);

    await user.click(bars[0]);

    // Resource name appears in the left label column
    expect(screen.getAllByText("Bagger 01").length).toBeGreaterThan(0);
  });

  it("deselects when the same bar is clicked a second time", async () => {
    const user = userEvent.setup();

    render(
      <ResourceGantt
        sections={makeSingleSection({})}
        allDates={ALL_DATES}
        viewMode="month"
        localProjectMap={new Map()}
        taktProjectMap={new Map()}
      />,
    );

    const bars = await screen.findAllByTitle(/Externer Auftrag/);
    await user.click(bars[0]); // select
    await user.click(bars[0]); // deselect

    // Detail panel gone → Zeitraum heading disappears
    expect(screen.queryByText("Zeitraum")).toBeNull();
  });
});

// ─── Tests: free resources ────────────────────────────────────────────────────

describe("ResourceGantt — free resources", () => {
  it("renders a resource with no bookings and marks it as frei", async () => {
    render(
      <ResourceGantt
        sections={makeSingleSection({ freeResource: true })}
        allDates={ALL_DATES}
        viewMode="month"
        localProjectMap={new Map()}
        taktProjectMap={new Map()}
      />,
    );

    // The free resource name must appear
    expect(await screen.findByText("Bagger 02")).toBeTruthy();
    // At least one "frei" badge appears (for Bagger 02)
    expect(screen.getAllByText("frei").length).toBeGreaterThan(0);
  });

  it("does NOT show a frei badge next to a resource that has bookings", async () => {
    // Sektion A: Bagger 01 (has bookings). No other resources.
    render(
      <ResourceGantt
        sections={makeSingleSection({})}
        allDates={ALL_DATES}
        viewMode="month"
        localProjectMap={new Map()}
        taktProjectMap={new Map()}
      />,
    );

    const bagger01 = await screen.findByText("Bagger 01");
    // The span that contains "Bagger 01" must not have "frei" as sibling text
    const parentCell = bagger01.closest("[style]");
    expect(parentCell?.textContent).not.toContain("frei");
    // No "frei" badge anywhere in this single-resource render
    expect(screen.queryByText("frei")).toBeNull();
  });
});

// ─── Tests: type-level bookings on section rows ───────────────────────────────

describe("ResourceGantt — type-level bookings on section rows", () => {
  it("renders a type-level booking bar on the section header row", async () => {
    const typeBk = makeBooking("type-booking-1", null, {
      sourceType: "LOCAL_PROJECT",
      resourceTypeId: "rt-1",
    });

    render(
      <ResourceGantt
        sections={makeSingleSection({ typeBookings: [typeBk] })}
        allDates={ALL_DATES}
        viewMode="month"
        localProjectMap={new Map([["lp-1", "Geheimes Projekt"]])}
        taktProjectMap={new Map()}
      />,
    );

    await screen.findByText("Sektion A");
    const bar = document.querySelector<HTMLElement>(`[data-item-id="type-booking-1"]`);
    expect(bar).not.toBeNull();
    // title shows source type label only, never a project name (privacy)
    expect(bar!.title).not.toContain("Geheimes Projekt");
    expect(bar!.title).toBe("Internes Projekt");
  });

  it("does not reveal project names inside type-level bar text content", async () => {
    const typeBk = makeBooking("type-booking-2", null, {
      sourceType: "TAKT_REQUEST",
      sourceReferenceId: "tr-secret",
      resourceTypeId: "rt-1",
    });

    render(
      <ResourceGantt
        sections={makeSingleSection({ typeBookings: [typeBk] })}
        allDates={ALL_DATES}
        viewMode="month"
        localProjectMap={new Map()}
        taktProjectMap={new Map([["tr-secret", "Vertrauliches Projekt"]])}
      />,
    );

    await screen.findByText("Sektion A");
    expect(screen.queryByText("Vertrauliches Projekt")).toBeNull();
  });
});

// ─── Tests: no cross-section visual state contamination ───────────────────────

describe("ResourceGantt — no cross-section visual state contamination", () => {
  it("does not render utilization bands for sections with no bookings", async () => {
    // Section A: Bagger 01 with two 80% bookings → conflict (160%).
    // Section B: Kran 01 with no bookings → must have zero utilization bands.
    const bkA1 = makeBooking("bk-a1", "res-1", { utilizationPercent: 80 });
    const bkA2 = makeBooking("bk-a2", "res-1", { utilizationPercent: 80 });

    const sections = [
      {
        id:           "section-a",
        name:         "Sektion A",
        resources:    [{ id: "res-1", name: "Bagger 01", bookings: [bkA1, bkA2] }],
        typeBookings: [] as ReturnType<typeof makeBooking>[],
      },
      {
        id:           "section-b",
        name:         "Sektion B",
        resources:    [{ id: "res-2", name: "Kran 01", bookings: [] }],
        typeBookings: [] as ReturnType<typeof makeBooking>[],
      },
    ];

    const { container } = render(
      <ResourceGantt
        sections={sections}
        allDates={ALL_DATES}
        viewMode="month"
        localProjectMap={new Map()}
        taktProjectMap={new Map()}
      />,
    );

    await screen.findByText("Sektion B");

    // Find the Sektion B header row. It is the flex row whose left cell
    // contains "Sektion B". Its right sibling is the timeline cell.
    const sectionBSpan = screen.getByText("Sektion B");
    const leftCell = sectionBSpan.closest("[style]");
    const rowEl = leftCell?.parentElement;
    expect(rowEl).not.toBeNull();

    const timelineCell = rowEl!.children[1] as HTMLElement;
    const bands = Array.from(timelineCell.querySelectorAll("div")).filter((d) => {
      const bg = (d as HTMLElement).style.background;
      return (
        bg.includes("rgba(239,68,68")   ||  // conflict red
        bg.includes("rgba(245,158,11")  ||  // full amber
        bg.includes("rgba(34,197,94")       // partial green
      );
    });
    expect(bands).toHaveLength(0);
  });
});

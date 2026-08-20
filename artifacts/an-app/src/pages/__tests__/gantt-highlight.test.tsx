/**
 * Gantt cross-highlighting test
 *
 * Verifies that clicking a Leistungsanfragen bar highlights booking bars whose
 * sourceReferenceId matches the Leistungsanfrage ID, and that a second click
 * removes the highlight.
 *
 * Each bar carries a `data-item-id` attribute equal to the booking/leistung ID,
 * so assertions target the exact IDs — not just a count of highlighted bars.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { UnifiedGantt } from "../gantt";

// ─── Fixture data ────────────────────────────────────────────────────────────

const LEISTUNG_ID = "takt-req-1";

const LEISTUNG_ITEM = {
  kind: "takt" as const,
  data: {
    id: LEISTUNG_ID,
    label: "Beton A1",
    startAt: "2026-09-01T00:00:00.000Z",
    endAt: "2026-09-10T23:59:59.000Z",
    status: "ACCEPTED",
    projectId: "proj-1",
    projectName: "Hochhaus Nord",
    groupName: "Hochhaus Nord",
    zone: "Zone A",
    gewerk: "Beton",
    requestNumber: "REQ-001",
  },
};

function makeBooking(id: string, sourceReferenceId: string) {
  return {
    kind: "booking" as const,
    data: {
      id,
      resourceId: "res-1",
      resourceName: "Bagger 01",
      groupName: "Hochhaus Nord",
      // sourceType "TAKT_REQUEST" → bar title "Externer Auftrag" (from SOURCE_LABEL)
      sourceType: "TAKT_REQUEST" as const,
      sourceReferenceId,
      localProjectId: null,
      nuOrgId: "nu-org-1",
      // Non-all-day times (08:00 ≠ 00:00) so isAllDay() returns false
      startAt: "2026-09-02T08:00:00.000Z",
      endAt: "2026-09-06T17:00:00.000Z",
      status: "CONFIRMED" as const,
      utilizationPercent: 80,
      note: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  };
}

/** Two bookings linked to LEISTUNG_ID, one unrelated booking. */
const BOOKING_LINKED_1 = makeBooking("booking-linked-1", LEISTUNG_ID);
const BOOKING_LINKED_2 = makeBooking("booking-linked-2", LEISTUNG_ID);
const BOOKING_OTHER    = makeBooking("booking-other",    "other-leistung-999");

const SECTIONS = [
  {
    id: "leistungen",
    label: "Leistungstermine",
    Icon: () => null,
    accentColor: "#6366f1",
    bgColor: "rgba(99,102,241,0.06)",
    groups: [
      { id: "proj-1", name: "Hochhaus Nord", items: [LEISTUNG_ITEM] },
    ],
  },
  {
    id: "external",
    label: "Externe Projekte",
    Icon: () => null,
    accentColor: "#8b5cf6",
    bgColor: "rgba(139,92,246,0.06)",
    groups: [
      {
        id: "Hochhaus Nord",
        name: "Hochhaus Nord",
        // Two linked + one unrelated booking
        items: [BOOKING_LINKED_1, BOOKING_LINKED_2, BOOKING_OTHER],
      },
    ],
  },
];

const ALL_DATES = [
  { start: "2026-09-01T00:00:00.000Z", end: "2026-09-10T23:59:59.000Z" },
  { start: "2026-09-02T08:00:00.000Z", end: "2026-09-06T17:00:00.000Z" },
];

/** The outline colour applied to highlighted booking bars. */
const HIGHLIGHT_OUTLINE = "2px solid #6366f1";

/** Returns the bar element for a given item ID via the data-item-id attribute. */
function getBarById(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
  if (!el) throw new Error(`No bar found with data-item-id="${id}"`);
  return el;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("UnifiedGantt cross-highlighting", () => {
  it("highlights bars linked by sourceReferenceId when a Leistung bar is clicked", async () => {
    const user = userEvent.setup();

    render(
      <UnifiedGantt
        sections={SECTIONS}
        allDates={ALL_DATES}
        viewMode="month"
      />,
    );

    // Wait for the useEffect that expands groups to flush so booking item rows
    // appear in the DOM.
    const leistungBar = await screen.findByTitle("Beton A1");

    // Wait until all three booking bars exist in the DOM.
    await waitFor(() => {
      expect(document.querySelector('[data-item-id="booking-linked-1"]')).toBeTruthy();
      expect(document.querySelector('[data-item-id="booking-linked-2"]')).toBeTruthy();
      expect(document.querySelector('[data-item-id="booking-other"]')).toBeTruthy();
    });

    // Before clicking: none of the bars should carry the highlight outline.
    expect(getBarById("booking-linked-1").style.outline).not.toBe(HIGHLIGHT_OUTLINE);
    expect(getBarById("booking-linked-2").style.outline).not.toBe(HIGHLIGHT_OUTLINE);
    expect(getBarById("booking-other").style.outline).not.toBe(HIGHLIGHT_OUTLINE);

    // Click the Leistung bar to select it.
    await user.click(leistungBar);

    // Both linked bookings must now carry the glow outline.
    expect(getBarById("booking-linked-1").style.outline).toBe(HIGHLIGHT_OUTLINE);
    expect(getBarById("booking-linked-2").style.outline).toBe(HIGHLIGHT_OUTLINE);

    // The unrelated booking must NOT be highlighted — its sourceReferenceId
    // points to a different Leistungsanfrage.
    expect(getBarById("booking-other").style.outline).not.toBe(HIGHLIGHT_OUTLINE);
  });

  it("removes highlights when the same Leistung bar is clicked a second time", async () => {
    const user = userEvent.setup();

    render(
      <UnifiedGantt
        sections={SECTIONS}
        allDates={ALL_DATES}
        viewMode="month"
      />,
    );

    const leistungBar = await screen.findByTitle("Beton A1");

    await waitFor(() => {
      expect(document.querySelector('[data-item-id="booking-linked-1"]')).toBeTruthy();
    });

    // First click → select.
    await user.click(leistungBar);

    // Verify highlights are applied to both linked bookings.
    await waitFor(() => {
      expect(getBarById("booking-linked-1").style.outline).toBe(HIGHLIGHT_OUTLINE);
      expect(getBarById("booking-linked-2").style.outline).toBe(HIGHLIGHT_OUTLINE);
    });

    // Second click on the same bar → deselect (toggle off).
    await user.click(leistungBar);

    // All booking bars must lose their highlight outline.
    await waitFor(() => {
      expect(getBarById("booking-linked-1").style.outline).not.toBe(HIGHLIGHT_OUTLINE);
      expect(getBarById("booking-linked-2").style.outline).not.toBe(HIGHLIGHT_OUTLINE);
      expect(getBarById("booking-other").style.outline).not.toBe(HIGHLIGHT_OUTLINE);
    });
  });
});

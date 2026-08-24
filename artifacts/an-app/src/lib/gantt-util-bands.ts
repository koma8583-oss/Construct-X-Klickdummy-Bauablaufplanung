/**
 * computeUtilizationBands — pure helper exported for unit testing.
 *
 * For each calendar day in [rangeStart, rangeEnd] sum all non-cancelled
 * bookings' utilizationPercent. Classify the daily sum:
 *   0        → no band
 *   1–99     → partial  (green)
 *   100      → full     (amber)
 *   >100     → conflict (red)
 *
 * Consecutive days with the same classification are merged into one band.
 */

import type { NuResourceBooking } from "@workspace/api-client-react";

export type UtilBandKind = "partial" | "full" | "conflict";

export interface UtilBand {
  start: number; // ms timestamp (midnight of first day)
  end:   number; // ms timestamp (midnight of first day AFTER the band)
  kind:  UtilBandKind;
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function calendarDayIndex(start: string, value: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const valueMs = Date.parse(`${value}T00:00:00Z`);
  return Math.round((valueMs - startMs) / 86_400_000);
}

export function computeUtilizationBands(
  bookings: NuResourceBooking[],
  rangeStart: Date,
  rangeEnd: Date,
): UtilBand[] {
  const active = bookings.filter((b) => b.status !== "CANCELLED");
  if (!active.length) return [];

  const totalDays = calendarDayIndex(dayKey(rangeStart), dayKey(rangeEnd)) + 1;
  if (totalDays <= 0) return [];

  // Day-index → total utilization
  const dayUtil: number[] = new Array(totalDays).fill(0);

  for (const b of active) {
    const bStartDate = new Date(b.startAt);
    const bEndDate = new Date(new Date(b.endAt).getTime() - 1);
    const firstDay = Math.max(
      0,
      calendarDayIndex(dayKey(rangeStart), dayKey(bStartDate)),
    );
    const lastDay  = Math.min(
      totalDays - 1,
      calendarDayIndex(dayKey(rangeStart), dayKey(bEndDate)),
    );
    for (let d = firstDay; d <= lastDay; d++) {
      dayUtil[d] += b.utilizationPercent;
    }
  }

  type DayKind = "none" | UtilBandKind;

  function classify(u: number): DayKind {
    if (u <= 0)    return "none";
    if (u < 100)   return "partial";
    if (u === 100) return "full";
    return "conflict";
  }

  const bands: UtilBand[] = [];
  let bandStart = -1;
  let bandKind: DayKind = "none";

  const flush = (endDay: number) => {
    if (bandStart >= 0 && bandKind !== "none") {
      bands.push({
        start: Date.parse(`${dayKey(rangeStart)}T00:00:00Z`) + bandStart * 86_400_000,
        end:   Date.parse(`${dayKey(rangeStart)}T00:00:00Z`) + endDay * 86_400_000,
        kind:  bandKind as UtilBandKind,
      });
    }
  };

  for (let d = 0; d < totalDays; d++) {
    const k = classify(dayUtil[d]);
    if (k === "none") {
      flush(d);
      bandStart = -1;
      bandKind  = "none";
    } else if (k !== bandKind) {
      flush(d);
      bandStart = d;
      bandKind  = k;
    }
  }
  flush(totalDays);

  return bands;
}

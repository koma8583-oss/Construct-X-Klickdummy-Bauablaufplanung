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

import { differenceInCalendarDays } from "date-fns";
import type { NuResourceBooking } from "@workspace/api-client-react";

export type UtilBandKind = "partial" | "full" | "conflict";

export interface UtilBand {
  start: number; // ms timestamp (midnight of first day)
  end:   number; // ms timestamp (midnight of first day AFTER the band)
  kind:  UtilBandKind;
}

export function computeUtilizationBands(
  bookings: NuResourceBooking[],
  rangeStart: Date,
  rangeEnd: Date,
): UtilBand[] {
  const active = bookings.filter((b) => b.status !== "CANCELLED");
  if (!active.length) return [];

  const totalDays = differenceInCalendarDays(rangeEnd, rangeStart) + 1;
  if (totalDays <= 0) return [];

  // Day-index → total utilization
  const dayUtil: number[] = new Array(totalDays).fill(0);

  for (const b of active) {
    const bStart = new Date(b.startAt).getTime();
    const bEnd   = new Date(b.endAt).getTime();
    const firstDay = Math.max(0, Math.ceil((bStart - rangeStart.getTime()) / 86_400_000));
    const lastDay  = Math.min(
      totalDays - 1,
      Math.floor((bEnd - rangeStart.getTime()) / 86_400_000),
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
        start: rangeStart.getTime() + bandStart * 86_400_000,
        end:   rangeStart.getTime() + endDay   * 86_400_000,
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

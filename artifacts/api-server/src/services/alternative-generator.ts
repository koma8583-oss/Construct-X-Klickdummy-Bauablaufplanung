/**
 * Task 4.6 — Deterministic rule-based alternative time window generator.
 *
 * No AI, no LLM, no optimisation solver.
 * Same inputs always produce the same outputs (deterministic).
 *
 * Generated alternatives must NEVER expose:
 *   resourceId, resourceName, employeeName, localProjectId,
 *   customerAlias, conflictDetails, internalPriority, internalCost.
 *
 * Configuration is centralised here — no magic numbers scattered across files.
 */
import type { TaktRequestSnapshotPayload } from "../lib/takt-request-snapshot-service";
import type { ResourceBooking } from "@workspace/db";

// ── Configuration ─────────────────────────────────────────────────────────────

export const ALTERNATIVE_GENERATOR_CONFIG = {
  /** Maximum number of alternatives to generate */
  maximumAlternatives: 3,
  /** How many calendar days ahead to search for free windows */
  searchHorizonDays: 60,
  /** Step size in calendar days when scanning for alternatives */
  searchStepDays: 1,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlternativeResource {
  resourceId: string;
  resourceType: string;
  capacity: number | null;
  capacityUnit: string | null;
  active: boolean;
}

export interface GeneratedAlternative {
  /** Opaque ID — clients treat as an identifier only */
  alternativeId: string;
  rank: 1 | 2 | 3;
  alternativeType: "SHIFT_WINDOW" | "REDUCED_CREW" | "NEXT_FREE_WINDOW";
  /** Public time window — no internal resource details */
  timeWindow: { start: string; end: string };
  /** Crew size in this alternative. Null for non-crew alternatives. */
  crewSize: number | null;
  /** Human-readable condition explanation (GU-safe, no internal details) */
  conditions: string | null;
  // --- Internal fields (must be stripped before sending to GU) ---
  /** Internal: resource IDs that are free in this window — NOT in public payload */
  _internalResourceIds: string[];
  /** Internal: is this alternative outside the buffer window? */
  _outsideBuffer: boolean;
}

/** Public shape — only these fields may be sent externally */
export interface PublicAlternative {
  alternativeId: string;
  rank: number;
  timeWindow: { start: string; end: string };
  crewSize: number | null;
  conditions: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a date-only string (YYYY-MM-DD) into a UTC midnight Date */
function parseDate(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

/** Format a Date as a date-only string (YYYY-MM-DD) */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add calendar days to a Date */
function addDays(d: Date, days: number): Date {
  const result = new Date(d.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Difference in calendar days between two dates (end - start, integer) */
function diffDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Skip weekends. If the given date is Saturday or Sunday (UTC),
 * advance to the following Monday.
 */
function skipWeekend(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 6) return addDays(d, 2); // Sat → Mon
  if (day === 0) return addDays(d, 1); // Sun → Mon
  return d;
}

/**
 * Checks whether a set of resources has any booking conflict in [windowStart, windowEnd).
 * A conflict occurs when:
 *   booking.startAt < windowEnd AND booking.endAt > windowStart
 *   AND status ≠ 'CANCELLED'
 *   AND resourceId ∈ requiredResourceIds
 * Returns the conflicting booking IDs (may be empty if no conflicts).
 */
function findConflictingBookingsInWindow(
  resourceIds: string[],
  windowStart: Date,
  windowEnd: Date,
  existingBookings: Pick<ResourceBooking, "id" | "resourceId" | "startAt" | "endAt" | "status" | "utilizationPercent">[],
): Array<{ resourceId: string; utilizationSum: number }> {
  const utilizationByResource = new Map<string, number>();

  for (const booking of existingBookings) {
    const rid = booking.resourceId;
    if (!rid || !resourceIds.includes(rid)) continue;
    if (booking.status === "CANCELLED") continue;

    const bStart = new Date(booking.startAt);
    const bEnd   = new Date(booking.endAt);

    // Overlap check
    if (bStart < windowEnd && bEnd > windowStart) {
      const current = utilizationByResource.get(rid) ?? 0;
      utilizationByResource.set(rid, current + booking.utilizationPercent);
    }
  }

  return Array.from(utilizationByResource.entries())
    .filter(([, util]) => util >= 100)
    .map(([resourceId, utilizationSum]) => ({ resourceId, utilizationSum }));
}

/**
 * Returns true if all required resources are available (< 100% utilization) in the window.
 */
function isWindowClear(
  resourceIds: string[],
  windowStart: Date,
  windowEnd: Date,
  existingBookings: Pick<ResourceBooking, "id" | "resourceId" | "startAt" | "endAt" | "status" | "utilizationPercent">[],
): boolean {
  return findConflictingBookingsInWindow(resourceIds, windowStart, windowEnd, existingBookings).length === 0;
}

/**
 * Generates a deterministic opaque ID for an alternative.
 * Format: "alt-{type}-{YYYY-MM-DD}" — predictable, no internal data leaked.
 */
function makeAlternativeId(type: "A" | "B" | "C", start: string): string {
  return `alt-${type}-${start}`;
}

// ── Main generator function ───────────────────────────────────────────────────

/**
 * Generates up to maximumAlternatives deterministic alternatives.
 *
 * @param snapshot     Immutable TaktRequest snapshot (source of truth for time window)
 * @param resources    NU's active resources eligible for this check
 * @param bookings     Existing bookings for this NU (all statuses — filtering is internal)
 * @returns            Array of up to 3 GeneratedAlternative, sorted by rank ascending
 */
export function generateAlternatives(
  snapshot: TaktRequestSnapshotPayload,
  resources: AlternativeResource[],
  bookings: Pick<ResourceBooking, "id" | "resourceId" | "startAt" | "endAt" | "status" | "utilizationPercent">[],
): GeneratedAlternative[] {
  const { maximumAlternatives, searchHorizonDays, searchStepDays } = ALTERNATIVE_GENERATOR_CONFIG;

  const plannedStart = parseDate(snapshot.plannedTimeWindow.start);
  const plannedEnd   = parseDate(snapshot.plannedTimeWindow.end);
  const plannedDurationDays = diffDays(plannedStart, plannedEnd);

  if (plannedDurationDays <= 0) return [];

  // Derive buffer boundaries
  const bufferEarliest = snapshot.bufferTimeWindow?.earliestStart
    ? parseDate(snapshot.bufferTimeWindow.earliestStart)
    : plannedStart;
  const bufferLatest = snapshot.bufferTimeWindow?.latestEnd
    ? parseDate(snapshot.bufferTimeWindow.latestEnd)
    : addDays(plannedEnd, 14); // fallback: 2 weeks after planned end

  // Classify resources by type
  const crewResources  = resources.filter(r => r.resourceType === "CREW" || r.resourceType === "EMPLOYEE");
  const equipResources = resources.filter(r => r.resourceType === "EQUIPMENT" || r.resourceType === "MACHINE");

  const crewIds   = crewResources.map(r => r.resourceId);
  const equipIds  = equipResources.map(r => r.resourceId);
  const allIds    = resources.map(r => r.resourceId);

  const searchHorizonEnd = addDays(plannedStart, searchHorizonDays);
  const alternatives: GeneratedAlternative[] = [];
  const seenWindows = new Set<string>(); // deduplicate by "start|end"

  function windowKey(s: Date, e: Date) {
    return `${formatDate(s)}|${formatDate(e)}`;
  }

  // ── Alternative A — same duration, same crew, first available shift ─────────
  {
    let cursor = skipWeekend(plannedStart);
    while (cursor <= searchHorizonEnd && alternatives.length < maximumAlternatives) {
      const windowEnd = addDays(cursor, plannedDurationDays);
      // Skip if this is the original window (that's where the conflict is)
      if (formatDate(cursor) !== formatDate(plannedStart)) {
        const key = windowKey(cursor, windowEnd);
        if (!seenWindows.has(key) && isWindowClear(allIds, cursor, windowEnd, bookings)) {
          seenWindows.add(key);
          const outsideBuffer = cursor > bufferLatest || windowEnd < bufferEarliest;
          const totalCrewCapacity = crewResources.reduce((sum, r) => sum + (r.capacity ?? 1), 0);
          alternatives.push({
            alternativeId: makeAlternativeId("A", formatDate(cursor)),
            rank: 1,
            alternativeType: "SHIFT_WINDOW",
            timeWindow: { start: formatDate(cursor), end: formatDate(windowEnd) },
            crewSize: crewResources.length > 0 ? Math.round(totalCrewCapacity) : null,
            conditions: outsideBuffer
              ? "Outside original buffer window — requires GU acceptance"
              : null,
            _internalResourceIds: allIds,
            _outsideBuffer: outsideBuffer,
          });
          break; // Only one Alternative A (earliest match)
        }
      }
      cursor = skipWeekend(addDays(cursor, searchStepDays));
    }
  }

  // ── Alternative B — reduced crew, extended duration ──────────────────────────
  if (crewResources.length >= 2 && alternatives.length < maximumAlternatives) {
    // Try using one fewer crew resource (by removing the last alphabetically — deterministic)
    const sortedCrew = [...crewResources].sort((a, b) => a.resourceId.localeCompare(b.resourceId));
    const reducedCrew = sortedCrew.slice(0, sortedCrew.length - 1);
    const reducedCrewIds = reducedCrew.map(r => r.resourceId);

    const originalCapacity = crewResources.reduce((s, r) => s + (r.capacity ?? 1), 0);
    const reducedCapacity  = reducedCrew.reduce((s, r) => s + (r.capacity ?? 1), 0);

    if (reducedCapacity > 0 && originalCapacity > 0) {
      const extendedDuration = Math.ceil(plannedDurationDays * (originalCapacity / reducedCapacity));
      const idsToCheck = [...reducedCrewIds, ...equipIds];

      let cursor = skipWeekend(plannedStart);
      while (cursor <= searchHorizonEnd && alternatives.length < maximumAlternatives) {
        const windowEnd = addDays(cursor, extendedDuration);
        const key = windowKey(cursor, windowEnd);
        if (!seenWindows.has(key) && isWindowClear(idsToCheck, cursor, windowEnd, bookings)) {
          seenWindows.add(key);
          alternatives.push({
            alternativeId: makeAlternativeId("B", formatDate(cursor)),
            rank: 2,
            alternativeType: "REDUCED_CREW",
            timeWindow: { start: formatDate(cursor), end: formatDate(windowEnd) },
            crewSize: Math.round(reducedCapacity),
            conditions: `Reduced crew (${Math.round(reducedCapacity)} vs ${Math.round(originalCapacity)}); extended duration to ${extendedDuration} days`,
            _internalResourceIds: idsToCheck,
            _outsideBuffer: cursor > bufferLatest || windowEnd < bufferEarliest,
          });
          break;
        }
        cursor = skipWeekend(addDays(cursor, searchStepDays));
      }
    }
  }

  // ── Alternative C — next fully free window (may be outside buffer) ──────────
  if (alternatives.length < maximumAlternatives) {
    let cursor = skipWeekend(plannedStart);
    let nextAvailable: Date | null = null;

    while (cursor <= searchHorizonEnd) {
      const windowEnd = addDays(cursor, plannedDurationDays);
      const key = windowKey(cursor, windowEnd);

      if (!seenWindows.has(key) && isWindowClear(allIds, cursor, windowEnd, bookings)) {
        nextAvailable = cursor;
        break;
      }
      cursor = skipWeekend(addDays(cursor, searchStepDays));
    }

    if (nextAvailable) {
      const windowEnd = addDays(nextAvailable, plannedDurationDays);
      const key = windowKey(nextAvailable, windowEnd);
      if (!seenWindows.has(key)) {
        seenWindows.add(key);
        const outsideBuffer = nextAvailable > bufferLatest || windowEnd < bufferEarliest;
        const totalCapacity = crewResources.reduce((sum, r) => sum + (r.capacity ?? 1), 0);
        alternatives.push({
          alternativeId: makeAlternativeId("C", formatDate(nextAvailable)),
          rank: 3,
          alternativeType: "NEXT_FREE_WINDOW",
          timeWindow: { start: formatDate(nextAvailable), end: formatDate(windowEnd) },
          crewSize: crewResources.length > 0 ? Math.round(totalCapacity) : null,
          conditions: outsideBuffer
            ? "Next fully available window — outside original buffer; requires GU acceptance"
            : "Next fully available window within buffer",
          _internalResourceIds: allIds,
          _outsideBuffer: outsideBuffer,
        });
      }
    }
  }

  // Sort by rank ascending (already inserted in rank order, but be explicit)
  alternatives.sort((a, b) => a.rank - b.rank);

  return alternatives.slice(0, maximumAlternatives);
}

/**
 * Strip internal fields to produce a GU-safe public alternative.
 * Only alternativeId, rank, timeWindow, crewSize, conditions are allowed.
 */
export function toPublicAlternative(alt: GeneratedAlternative): PublicAlternative {
  return {
    alternativeId: alt.alternativeId,
    rank: alt.rank,
    timeWindow: alt.timeWindow,
    crewSize: alt.crewSize,
    conditions: alt.conditions,
  };
}

/**
 * Task 4.5 — AvailabilityCheckService.
 * Task 4.6 — Integrates the AlternativeGenerator.
 *
 * runAvailabilityCheck(taktRequestId, nuOrgId, userId)
 *   1. Validates: request exists, is addressed to this NU, has a checkable status.
 *   2. Loads the immutable snapshot (never the live Takt row).
 *   3. Transitions TaktRequest: DETAILS_RETRIEVED → UNDER_REVIEW.
 *   4. Creates a new availability_checks row (PENDING → RUNNING).
 *   5. Runs 10 validation rules against NU resources + bookings.
 *   6. Generates deterministic alternatives when the check is not FEASIBLE (Task 4.6).
 *   7. Updates the check row with result (COMPLETED) or failure (FAILED).
 *   8. Returns the final check row.
 *
 * Privacy invariants:
 *   - internalResultPayload is NEVER sent externally.
 *   - publicResultPayload contains NO resourceId, localProjectId, employeeName, customerAlias.
 *   - On FAILED checks: no sensitive details are exposed externally.
 *   - On technical failure: TaktRequest status is NOT automatically set to REJECTED.
 */
import pino from "pino";
import { anDb as db } from "@workspace/db";
import {
  taktRequestsTable,
  taktRequestSnapshotsTable,
  resourcesTable,
  resourceBookingsTable,
  availabilityChecksTable,
  taktRequestResourceRequirementsTable,
  coordinationPoliciesTable,
} from "@workspace/db";
import { assertLeistungsanfragePolicyAccess } from "./leistungsanfrage-policy-guard";

async function assertAvailabilityPolicyAccess(
  request: { performancePolicyId: string | null },
): Promise<void> {
  if (!request.performancePolicyId) return;
  const [policy] = await db.select({
    deltaClass: coordinationPoliciesTable.deltaClass,
    lifecycleStatus: coordinationPoliciesTable.lifecycleStatus,
  }).from(coordinationPoliciesTable)
    .where(eq(coordinationPoliciesTable.id, request.performancePolicyId)).limit(1);
  assertLeistungsanfragePolicyAccess({
    policyDeltaClass: policy?.deltaClass ?? "NOT_PERMITTED",
    policyConsentStatus: policy?.lifecycleStatus === "ACCEPTED" ? "ACCEPTED" :
      policy?.lifecycleStatus === "REJECTED" ? "REJECTED" :
      policy?.deltaClass === "REQUIRES_CONSENT" ? "PENDING" : "NOT_REQUIRED",
  }, "AVAILABILITY");
}
import { addCalendarDays, differenceInCalendarDays, toCalendarDate } from "../lib/calendar-date-utils";
import { and, eq, lt, gt, ne, max, desc, sql, or, isNull } from "drizzle-orm";
import type { TaktRequestSnapshotPayload } from "../lib/takt-request-snapshot-service";
import type {
  AvailabilityCheck,
  InternalResultPayload,
  PublicResultPayload,
} from "@workspace/db";
import {
  generateAlternatives,
  toPublicAlternative,
  type AlternativeResource,
  type AlternativeRequirement,
  ALTERNATIVE_GENERATOR_CONFIG,
} from "./alternative-generator";
import {
  evaluateResourceRequirements,
  shiftRequirementsToWindow,
} from "./resource-availability-service";

const logger = pino({ name: "availability-check-service" });

// ── Domain errors ─────────────────────────────────────────────────────────────

/**
 * Returns the "latest" availability check for a request+NU pair.
 *
 * Latest strategy (per task spec):
 *   "neuesten erfolgreich oder zuletzt ausgeführten Check"
 *   → prefer the COMPLETED row with highest runNumber;
 *     fall back to any row with the highest runNumber if no COMPLETED exists.
 *
 * Returns null if no check exists.
 */
export async function getLatestAvailabilityCheck(
  taktRequestId: string,
  nuOrgId: string,
): Promise<AvailabilityCheck | null> {
  const [request] = await db.select().from(taktRequestsTable)
    .where(and(eq(taktRequestsTable.id, taktRequestId), eq(taktRequestsTable.nuOrgId, nuOrgId))).limit(1);
  if (request) await assertAvailabilityPolicyAccess(request);
  // Try COMPLETED first (preferred)
  const [completed] = await db
    .select()
    .from(availabilityChecksTable)
    .where(
      and(
        eq(availabilityChecksTable.taktRequestId, taktRequestId),
        eq(availabilityChecksTable.nuOrgId, nuOrgId),
        eq(availabilityChecksTable.status, "COMPLETED"),
      ),
    )
    .orderBy(desc(availabilityChecksTable.runNumber))
    .limit(1);

  if (completed) return completed;

  // Fall back to the most recent row of any status
  const [latest] = await db
    .select()
    .from(availabilityChecksTable)
    .where(
      and(
        eq(availabilityChecksTable.taktRequestId, taktRequestId),
        eq(availabilityChecksTable.nuOrgId, nuOrgId),
      ),
    )
    .orderBy(desc(availabilityChecksTable.runNumber))
    .limit(1);

  return latest ?? null;
}

/** Re-evaluate a specific acceptance window without creating a check row. */
export async function evaluateAvailabilityWindow(
  taktRequestId: string,
  nuOrgId: string,
  windowStart: Date,
  windowEnd: Date,
  excludeSourceReferenceId?: string,
  requirementsOverride?: Array<{
    id: string;
    resourceTypeId: string | null;
    requiredCapacity: string | null;
    utilizationPercent: number;
    requiredQualification: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    notes: string | null;
  }>,
  executor: typeof db = db,
): Promise<InternalResultPayload> {
  const [snapshotRow] = await executor
    .select()
    .from(taktRequestSnapshotsTable)
    .where(eq(taktRequestSnapshotsTable.taktRequestId, taktRequestId))
    .limit(1);
  if (!snapshotRow) throw new AvailabilityCheckError(`No snapshot found for TaktRequest ${taktRequestId}`, "SNAPSHOT_MISSING");
  const snapshot = snapshotRow.snapshotPayload as unknown as TaktRequestSnapshotPayload;
  const result = await executeCheckRules(
    snapshot,
    windowStart,
    windowEnd,
    nuOrgId,
    taktRequestId,
    excludeSourceReferenceId,
    requirementsOverride,
    executor,
  );
  return result.internalPayload;
}

export class AvailabilityCheckError extends Error {
  constructor(
    message: string,
    readonly code:
      | "REQUEST_NOT_FOUND"
      | "WRONG_NU_ORG"
      | "SNAPSHOT_MISSING"
      | "INVALID_STATUS"
      | "INVALID_TIME_WINDOW",
  ) {
    super(message);
    this.name = "AvailabilityCheckError";
  }
}

// ── Checkable statuses (Rule 4) ───────────────────────────────────────────────
//
// REVISION_REQUIRED is a new coordination round after the AG requested changes.
// The NU must be able to re-check the updated requirements before responding.
const CHECKABLE_STATUSES = new Set(["DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"]);

// ── Helper: date parsing ──────────────────────────────────────────────────────

function parseDate(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

function parseInclusiveEnd(d: string): Date {
  return parseDate(addCalendarDays(d, 1));
}

function overlaps(startAt: Date, endAt: Date, windowStart: Date, windowEnd: Date): boolean {
  return startAt < windowEnd && endAt > windowStart;
}

// ── Main service function ─────────────────────────────────────────────────────

/**
 * Run a feasibility check for a TaktRequest.
 *
 * @param taktRequestId  The TaktRequest to check.
 * @param nuOrgId        The NU organisation performing the check (must match request.nuOrgId).
 * @param userId         The NU user triggering the check (for audit trail).
 * @returns              The completed (or failed) availability_checks row.
 * @throws               AvailabilityCheckError for domain violations (pre-execution).
 *                       Never throws after the check row has been created (FAILED instead).
 */
export async function runAvailabilityCheck(
  taktRequestId: string,
  nuOrgId: string,
  userId: string,
): Promise<AvailabilityCheck> {
  // ── Rule 1: TaktRequest exists ───────────────────────────────────────────────
  const [request] = await db
    .select()
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, taktRequestId))
    .limit(1);

  if (!request) {
    throw new AvailabilityCheckError(
      `TaktRequest not found: ${taktRequestId}`,
      "REQUEST_NOT_FOUND",
    );
  }

  // ── Rule 2: Request is addressed to this NU ──────────────────────────────────
  if (request.nuOrgId !== nuOrgId) {
    throw new AvailabilityCheckError(
      `TaktRequest ${taktRequestId} is not addressed to NU org ${nuOrgId}`,
      "WRONG_NU_ORG",
    );
  }
  await assertAvailabilityPolicyAccess(request);

  // ── Rule 4: Request has a checkable status ───────────────────────────────────
  if (!CHECKABLE_STATUSES.has(request.status)) {
    throw new AvailabilityCheckError(
      `TaktRequest ${taktRequestId} has status '${request.status}' which is not checkable. ` +
        `Expected one of: ${[...CHECKABLE_STATUSES].join(", ")}`,
      "INVALID_STATUS",
    );
  }

  // ── Rule 3: Snapshot exists ──────────────────────────────────────────────────
  const [snapshotRow] = await db
    .select()
    .from(taktRequestSnapshotsTable)
    .where(eq(taktRequestSnapshotsTable.taktRequestId, taktRequestId))
    .limit(1);

  if (!snapshotRow) {
    throw new AvailabilityCheckError(
      `No snapshot found for TaktRequest ${taktRequestId}`,
      "SNAPSHOT_MISSING",
    );
  }

  const snapshot = snapshotRow.snapshotPayload as unknown as TaktRequestSnapshotPayload;

  // ── Rule 5: Time window is valid ─────────────────────────────────────────────
  if (!snapshot?.plannedTimeWindow?.start || !snapshot?.plannedTimeWindow?.end) {
    throw new AvailabilityCheckError(
      `Snapshot for TaktRequest ${taktRequestId} is missing plannedTimeWindow — ` +
        `the Takt may not have valid dates. Please contact the Auftraggeber.`,
      "INVALID_TIME_WINDOW",
    );
  }

  const windowStart = parseDate(snapshot.plannedTimeWindow.start);
  const windowEnd   = parseInclusiveEnd(snapshot.plannedTimeWindow.end);

  if (windowEnd <= windowStart) {
    throw new AvailabilityCheckError(
      `Snapshot time window is invalid: start=${snapshot.plannedTimeWindow.start} end=${snapshot.plannedTimeWindow.end}`,
      "INVALID_TIME_WINDOW",
    );
  }

  // ── Status transition: DETAILS_RETRIEVED → UNDER_REVIEW ─────────────────────
  // UNDER_REVIEW → UNDER_REVIEW is a no-op (re-run allowed per task spec)
  if (request.status === "DETAILS_RETRIEVED") {
    await db
      .update(taktRequestsTable)
      .set({ status: "UNDER_REVIEW", updatedAt: new Date() })
      .where(eq(taktRequestsTable.id, taktRequestId));

    logger.info({ taktRequestId, nuOrgId }, "TaktRequest transitioned to UNDER_REVIEW");
  }

  // ── Determine runNumber ──────────────────────────────────────────────────────
  const [maxRunRow] = await db
    .select({ maxRun: max(availabilityChecksTable.runNumber) })
    .from(availabilityChecksTable)
    .where(
      and(
        eq(availabilityChecksTable.taktRequestId, taktRequestId),
        eq(availabilityChecksTable.nuOrgId, nuOrgId),
      ),
    );

  const runNumber = (maxRunRow?.maxRun ?? 0) + 1;

  // Find the previous check (for supersedesCheckId)
  const [prevCheck] = await db
    .select({ id: availabilityChecksTable.id })
    .from(availabilityChecksTable)
    .where(
      and(
        eq(availabilityChecksTable.taktRequestId, taktRequestId),
        eq(availabilityChecksTable.nuOrgId, nuOrgId),
        eq(availabilityChecksTable.runNumber, runNumber - 1),
      ),
    )
    .limit(1);

  // ── Create the check row (PENDING → RUNNING) ─────────────────────────────────
  const [checkRow] = await db
    .insert(availabilityChecksTable)
    .values({
      nuOrgId,
      taktRequestId,
      status: "RUNNING",
      runNumber,
      supersedesCheckId: prevCheck?.id ?? undefined,
      createdByUserId: userId,
    })
    .returning();

  logger.info(
    { checkId: checkRow.id, taktRequestId, nuOrgId, runNumber },
    "Availability check started",
  );

  // ── Execute check rules (errors here → FAILED, not thrown) ──────────────────
  try {
    const { internalPayload, publicPayload } = await executeCheckRules(
      snapshot,
      windowStart,
      windowEnd,
      nuOrgId,
      taktRequestId,
    );

    const result = publicPayload.recommendedDecision === "ACCEPTED"
      ? "FEASIBLE"
      : publicPayload.alternatives.length > 0
        ? "FEASIBLE_WITH_ALTERNATIVES"
        : "NOT_FEASIBLE";

    const [completed] = await db
      .update(availabilityChecksTable)
      .set({
        status: "COMPLETED",
        result: result as "FEASIBLE" | "FEASIBLE_WITH_ALTERNATIVES" | "NOT_FEASIBLE",
        internalResultPayload: internalPayload,
        publicResultPayload: publicPayload,
        checkedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(availabilityChecksTable.id, checkRow.id))
      .returning();

    logger.info(
      { checkId: checkRow.id, result, taktRequestId, nuOrgId },
      "Availability check completed",
    );

    return completed;
  } catch (err: unknown) {
    // Technical error — mark as FAILED, do NOT reject the TaktRequest
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      { checkId: checkRow.id, taktRequestId, nuOrgId, err: errorMessage },
      "Availability check failed with technical error",
    );

    const failedInternal: InternalResultPayload = {
      conflicts: [],
      availableResources: [],
      missingQualifications: [],
      unavailableEquipment: [],
      tentativeWarnings: [],
      errorMessage: errorMessage.slice(0, 500), // cap to avoid leaking stack traces
    };

    const failedPublic: PublicResultPayload = {
      recommendedDecision: "REJECTED", // placeholder — not sent as a TaktResponse
      reasonCode: "CHECK_FAILED",
      alternatives: [],
    };

    const [failed] = await db
      .update(availabilityChecksTable)
      .set({
        status: "FAILED",
        internalResultPayload: failedInternal,
        publicResultPayload: failedPublic,
        checkedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(availabilityChecksTable.id, checkRow.id))
      .returning();

    return failed;
  }
}

// ── Rule execution ────────────────────────────────────────────────────────────

interface CheckRulesResult {
  internalPayload: InternalResultPayload;
  publicPayload: PublicResultPayload;
}

async function executeCheckRules(
  snapshot: TaktRequestSnapshotPayload,
  windowStart: Date,
  windowEnd: Date,
  nuOrgId: string,
  taktRequestId: string,
  excludeSourceReferenceId?: string,
  requirementsOverride?: Array<{
    id: string;
    resourceTypeId: string | null;
    requiredCapacity: string | null;
    utilizationPercent: number;
    requiredQualification: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    notes: string | null;
  }>,
  executor: typeof db = db,
): Promise<CheckRulesResult> {
  // Load NU's active resources (used by both DTC and legacy paths)
  const nuResources = await executor
    .select({
      id: resourcesTable.id,
      type: resourcesTable.type,
      name: resourcesTable.name,
      capacity: resourcesTable.capacity,
      capacityUnit: resourcesTable.capacityUnit,
      qualifications: resourcesTable.qualifications,
      skills: resourcesTable.skills,
      active: resourcesTable.active,
      resourceTypeId: resourcesTable.resourceTypeId,
    })
    .from(resourcesTable)
    .where(and(eq(resourcesTable.anOrgId, nuOrgId), eq(resourcesTable.active, true)));

  // Load requirements before bookings so requirement-specific periods and the
  // complete alternative search horizon are included in the query.
  const dtcRequirements = requirementsOverride ?? await executor
    .select()
    .from(taktRequestResourceRequirementsTable)
    .where(eq(taktRequestResourceRequirementsTable.taktRequestId, taktRequestId));

  const requirementStarts = dtcRequirements
    .map((r) => r.periodStart ? parseDate(r.periodStart) : windowStart);
  const requirementEnds = dtcRequirements
    .map((r) => r.periodEnd ? parseInclusiveEnd(r.periodEnd) : windowEnd);
  const plannedDurationDays = Math.max(
    differenceInCalendarDays(toCalendarDate(windowStart), toCalendarDate(windowEnd)),
    1,
  );
  const alternativeSearchEnd = parseDate(addCalendarDays(
    toCalendarDate(windowStart),
    ALTERNATIVE_GENERATOR_CONFIG.searchHorizonDays + plannedDurationDays + 1,
  ));
  const bookingWindowStart = new Date(Math.min(
    windowStart.getTime(),
    ...requirementStarts.map((d) => d.getTime()),
  ));
  const bookingWindowEnd = new Date(Math.max(
    windowEnd.getTime(),
    alternativeSearchEnd.getTime(),
    ...requirementEnds.map((d) => d.getTime()),
  ));

  // Overlap: booking.startAt < bookingWindowEnd AND
  // booking.endAt > bookingWindowStart. Exclude CANCELLED bookings.
  const overlappingBookings = await executor
    .select({
      id: resourceBookingsTable.id,
      resourceId: resourceBookingsTable.resourceId,
      resourceTypeId: resourceBookingsTable.resourceTypeId,
      quantity: resourceBookingsTable.quantity,
      startAt: resourceBookingsTable.startAt,
      endAt: resourceBookingsTable.endAt,
      status: resourceBookingsTable.status,
      utilizationPercent: resourceBookingsTable.utilizationPercent,
      localProjectId: resourceBookingsTable.localProjectId,
    })
    .from(resourceBookingsTable)
    .where(
      and(
        eq(resourceBookingsTable.nuOrgId, nuOrgId),
        ne(resourceBookingsTable.status, "CANCELLED"),
        lt(resourceBookingsTable.startAt, bookingWindowEnd),
        gt(resourceBookingsTable.endAt, bookingWindowStart),
        ...(excludeSourceReferenceId
          ? [or(
            ne(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
            ne(resourceBookingsTable.sourceReferenceId, excludeSourceReferenceId),
            isNull(resourceBookingsTable.sourceReferenceId),
          )]
          : []),
      ),
    );

  const hasDtcRequirements = dtcRequirements.some(r => r.resourceTypeId);

  if (hasDtcRequirements) {
    const originalWindowStart = new Date(`${snapshot.plannedTimeWindow.start}T00:00:00Z`);
    const effectiveRequirements = requirementsOverride
      ? dtcRequirements
      : shiftRequirementsToWindow(dtcRequirements, originalWindowStart, windowStart);
    return executeDtcCheck(
      effectiveRequirements,
      nuResources,
      overlappingBookings,
      snapshot,
      windowStart,
      windowEnd,
    );
  }

  // ── Legacy path: snapshot-based type classification ──────────────────────────
  return executeLegacyCheck(
    snapshot,
    nuResources,
    overlappingBookings.filter((b) => overlaps(b.startAt, b.endAt, windowStart, windowEnd)),
    overlappingBookings,
  );
}

// ── DTC-based check (takt_request_resource_requirements) ──────────────────────

type NuResource = {
  id: string;
  type: string;
  name: string;
  capacity: number | null;
  capacityUnit: string | null;
  qualifications: unknown;
  skills: unknown;
  active: boolean;
  resourceTypeId: string | null;
};

type OverlapBooking = {
  id: string;
  resourceId: string | null;
  resourceTypeId: string | null;
  quantity: number | null;
  startAt: Date;
  endAt: Date;
  status: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
  utilizationPercent: number;
  localProjectId: string | null;
};

type DtcRequirement = {
  id: string;
  resourceTypeId: string | null;
  requiredCapacity: string | null;
  utilizationPercent: number;
  requiredQualification: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string | null;
};

async function executeDtcCheck(
  requirements: DtcRequirement[],
  nuResources: NuResource[],
  overlappingBookings: OverlapBooking[],
  snapshot: TaktRequestSnapshotPayload,
  windowStart: Date,
  windowEnd: Date,
): Promise<CheckRulesResult> {
  const evaluated = evaluateResourceRequirements({
    requirements,
    resources: nuResources,
    bookings: overlappingBookings,
    windowStart,
    windowEnd,
  });
  const {
    conflicts,
    tentativeWarnings,
    missingQualifications,
    availableResources,
    bookingRequirements,
    dailyAvailability,
  } = evaluated;
  const unavailableEquipment: string[] = [];

  const hardConflicts = conflicts.filter(c => !c.isTentative);
  const isFeasible = hardConflicts.length === 0;

  const internalPayload: InternalResultPayload = {
    conflicts,
    availableResources,
    missingQualifications,
    unavailableEquipment,
    tentativeWarnings,
    bookingRequirements,
    dailyAvailability,
  };

  let publicAlternatives: PublicResultPayload["alternatives"] = [];
  let nextAvailableDate: string | null = null;

  if (!isFeasible) {
    const altResources: AlternativeResource[] = nuResources.map(r => ({
      resourceId: r.id,
      resourceType: r.type,
      capacity: r.capacity,
      capacityUnit: r.capacityUnit,
      active: r.active,
    }));
    const alternatives = generateAlternatives(
      snapshot,
      altResources.map((r) => ({
        ...r,
        resourceTypeId: nuResources.find((nr) => nr.id === r.resourceId)?.resourceTypeId,
        qualifications: nuResources.find((nr) => nr.id === r.resourceId)?.qualifications,
      })),
      overlappingBookings,
      requirements as AlternativeRequirement[],
    );
    publicAlternatives = alternatives.map(toPublicAlternative);
    if (alternatives.length > 0) nextAvailableDate = alternatives[0].timeWindow.start;
  }

  const reasonCode: PublicResultPayload["reasonCode"] = isFeasible
    ? "FEASIBLE"
    : "RESOURCE_CONFLICT";

  const recommendedDecision: PublicResultPayload["recommendedDecision"] = isFeasible
    ? "ACCEPTED"
    : publicAlternatives.length > 0
      ? "ALTERNATIVES_PROPOSED"
      : "REJECTED";

  return {
    internalPayload,
    publicPayload: { recommendedDecision, reasonCode, alternatives: publicAlternatives, nextAvailableDate: nextAvailableDate ?? undefined },
  };
}

// ── Legacy path (snapshot.resourceRequirements, type-based classification) ─────

async function executeLegacyCheck(
  snapshot: TaktRequestSnapshotPayload,
  nuResources: NuResource[],
  overlappingBookings: OverlapBooking[],
  alternativeBookings: OverlapBooking[],
): Promise<CheckRulesResult> {
  // Classify NU resources by type
  const crewResources  = nuResources.filter(r => r.type === "CREW" || r.type === "EMPLOYEE");
  const equipResources = nuResources.filter(r => r.type === "EQUIPMENT" || r.type === "MACHINE");

  const conflicts: InternalResultPayload["conflicts"] = [];
  const tentativeWarnings: InternalResultPayload["tentativeWarnings"] = [];
  const missingQualifications: string[] = [];
  const unavailableEquipment: string[] = [];
  const availableResources: Array<{ resourceId: string; resourceType: string }> = [];

  // ── Rule 6: Required resource types exist ────────────────────────────────────
  const requiredTypes = new Set(snapshot.resourceRequirements.map(r => r.resourceType));

  if (requiredTypes.has("CREW") && crewResources.length === 0) {
    conflicts.push({
      resourceId: "NONE",
      resourceName: "–",
      conflictType: "MISSING_EQUIPMENT",
      missingQualification: "No CREW/EMPLOYEE resources registered for this organisation",
    });
  }
  if (requiredTypes.has("EQUIPMENT") && equipResources.length === 0) {
    unavailableEquipment.push("No EQUIPMENT/MACHINE resources registered for this organisation");
  }

  // ── Rules 7 + 10: Crew capacity and utilization ──────────────────────────────
  for (const resource of crewResources) {
    const resourceBookings = overlappingBookings.filter(b => b.resourceId === resource.id);
    const confirmedUtil = resourceBookings
      .filter(b => b.status === "CONFIRMED")
      .reduce((sum, b) => sum + b.utilizationPercent, 0);
    const tentativeUtil = resourceBookings
      .filter(b => b.status === "TENTATIVE")
      .reduce((sum, b) => sum + b.utilizationPercent, 0);

    const totalProjectedUtil = confirmedUtil + 100; // +100 for this new requirement

    if (totalProjectedUtil > 100) {
      conflicts.push({
        resourceId: resource.id,
        resourceName: resource.name,
        conflictType: "CAPACITY_EXCEEDED",
        isTentative: false,
        overlapUtilizationSum: confirmedUtil,
      });
    } else {
      availableResources.push({ resourceId: resource.id, resourceType: resource.type });

      // Tentative warnings (per task spec: warn but don't hard-block)
      if (confirmedUtil + tentativeUtil + 100 > 100 && tentativeUtil > 0) {
        for (const b of resourceBookings.filter(b => b.status === "TENTATIVE")) {
          tentativeWarnings.push({
            resourceId: resource.id,
            bookingId: b.id,
            overlapStart: new Date(b.startAt).toISOString(),
            overlapEnd: new Date(b.endAt).toISOString(),
          });
        }
      }
    }
  }

  // ── Rule 8: Required qualifications ─────────────────────────────────────────
  const allQuals = nuResources.flatMap(r =>
    Array.isArray(r.qualifications) ? (r.qualifications as string[]) : [],
  );

  for (const req of snapshot.resourceRequirements) {
    if (req.notes && req.notes.trim()) {
      const noteWords = req.notes.trim().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
      for (const word of noteWords) {
        const matched = allQuals.some(q => q.toLowerCase().includes(word.toLowerCase()));
        if (!matched && word.length > 3) {
          missingQualifications.push(word);
        }
      }
    }
  }

  // ── Rule 9: Required equipment available ─────────────────────────────────────
  if (requiredTypes.has("EQUIPMENT")) {
    for (const equip of equipResources) {
      const equipBookings = overlappingBookings.filter(b => b.resourceId === equip.id);
      const util = equipBookings
        .filter(b => b.status !== "CANCELLED" && b.status !== "TENTATIVE")
        .reduce((sum, b) => sum + b.utilizationPercent, 0);

      if (util + 100 > 100) {
        unavailableEquipment.push(`${equip.name} (fully booked in window)`);
        conflicts.push({
          resourceId: equip.id,
          resourceName: equip.name,
          conflictType: "MISSING_EQUIPMENT",
          isTentative: false,
        });
      } else {
        availableResources.push({ resourceId: equip.id, resourceType: equip.type });
      }
    }
  }

  // ── Determine feasibility ────────────────────────────────────────────────────
  const hardConflicts = conflicts.filter(c => !c.isTentative);
  const isFeasible    = hardConflicts.length === 0;

  const internalPayload: InternalResultPayload = {
    conflicts,
    availableResources,
    missingQualifications,
    unavailableEquipment,
    tentativeWarnings,
  };

  let publicAlternatives: PublicResultPayload["alternatives"] = [];
  let nextAvailableDate: string | null = null;

  if (!isFeasible) {
    const altResources: AlternativeResource[] = nuResources.map(r => ({
      resourceId: r.id,
      resourceType: r.type,
      resourceTypeId: r.resourceTypeId,
      capacity: r.capacity,
      capacityUnit: r.capacityUnit,
      active: r.active,
    }));

    const alternatives = generateAlternatives(snapshot, altResources, alternativeBookings);
    publicAlternatives = alternatives.map(toPublicAlternative);
    if (alternatives.length > 0) nextAvailableDate = alternatives[0].timeWindow.start;
  }

  const reasonCode: PublicResultPayload["reasonCode"] = (() => {
    if (isFeasible) return "FEASIBLE";
    if (unavailableEquipment.length > 0) return "MISSING_EQUIPMENT";
    if (missingQualifications.length > 0) return "MISSING_QUALIFICATION";
    return "RESOURCE_CONFLICT";
  })();

  const recommendedDecision: PublicResultPayload["recommendedDecision"] = isFeasible
    ? "ACCEPTED"
    : publicAlternatives.length > 0
      ? "ALTERNATIVES_PROPOSED"
      : "REJECTED";

  const publicPayload: PublicResultPayload = {
    recommendedDecision,
    reasonCode,
    alternatives: publicAlternatives,
    nextAvailableDate: nextAvailableDate ?? undefined,
  };

  return { internalPayload, publicPayload };
}

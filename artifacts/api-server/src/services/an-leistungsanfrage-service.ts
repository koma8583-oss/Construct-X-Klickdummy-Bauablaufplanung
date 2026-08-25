import {
  anDb,
  anAvailabilityChecksTable,
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsanfragenTable,
  anLeistungsantwortenTable,
  resourceBookingsTable,
  resourcesTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";

const actionableStatuses = ["RECEIVED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"] as const;

type Projection = typeof anLeistungsanfragenTable.$inferSelect;
type PayloadSnapshot = Record<string, unknown>;

function snapshotOf(projection: Projection): PayloadSnapshot {
  return projection.payloadSnapshot as PayloadSnapshot;
}

function snapshotValue(snapshot: PayloadSnapshot, key: string): unknown {
  return snapshot[key] ?? (snapshot.request as Record<string, unknown> | undefined)?.[key];
}

function toRequestView(projection: Projection, requirementCount = 0) {
  const snapshot = snapshotOf(projection);
  const plannedTimeWindow = snapshotValue(snapshot, "plannedTimeWindow") as Record<string, unknown> | undefined;
  const responseRequiredBy = snapshotValue(snapshot, "responseRequiredBy");
  const requestNumber = snapshotValue(snapshot, "requestNumber");
  const projectName = snapshotValue(snapshot, "projectName");
  const location = snapshotValue(snapshot, "location");

  return {
    id: projection.externalLeistungsanfrageId,
    leistungsanfrageId: projection.externalLeistungsanfrageId,
    taktRequestId: projection.externalLeistungsanfrageId,
    localProjectionId: projection.id,
    requestNumber: typeof requestNumber === "string" ? requestNumber : projection.externalLeistungsanfrageId,
    status: projection.status,
    leistungVersion: projection.externalRequestVersion,
    taktVersion: projection.externalRequestVersion,
    guOrgId: projection.senderAgOrgId,
    nuOrgId: projection.receiverAnOrgId,
    projektId: projection.projectReference,
    projectId: projection.projectReference,
    plannedStart: projection.plannedStart,
    plannedEnd: projection.plannedEnd,
    responseRequiredBy: typeof responseRequiredBy === "string" ? responseRequiredBy : null,
    receivedAt: projection.receivedAt.toISOString(),
    detailsRetrievedAt: projection.detailsRetrievedAt?.toISOString() ?? null,
    createdAt: projection.createdAt.toISOString(),
    updatedAt: projection.updatedAt.toISOString(),
    policySnapshot: projection.policySnapshot,
    resourceRequirementCount: requirementCount,
    takt: {
      id: projection.leistungReference,
      taktBezeichnung: snapshotValue(snapshot, "taktBezeichnung") ?? projection.leistungReference,
      gewerk: snapshotValue(snapshot, "gewerk") ?? null,
      zone: snapshotValue(snapshot, "zone") ?? null,
      plannedStart: plannedTimeWindow?.start ?? projection.plannedStart,
      plannedEnd: plannedTimeWindow?.end ?? projection.plannedEnd,
    },
    project: {
      id: projection.projectReference,
      name: projectName ?? projection.projectReference,
      location: location ?? null,
    },
  };
}

export async function listAnLeistungsanfragen(
  anOrgId: string,
  status?: string,
) {
  const filters = [eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId)];
  if (status) {
    filters.push(eq(anLeistungsanfragenTable.status, status as typeof anLeistungsanfragenTable.status.enumValues[number]));
  }
  const projections = await anDb.select().from(anLeistungsanfragenTable)
    .where(and(...filters))
    .orderBy(desc(anLeistungsanfragenTable.receivedAt));
  const ids = projections.map((projection) => projection.id);
  const requirements = ids.length
    ? await anDb.select({ requestId: anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId })
      .from(anLeistungsanfrageResourceRequirementsTable)
      .where(inArray(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, ids as [string, ...string[]]))
    : [];
  const counts = new Map<string, number>();
  for (const requirement of requirements) {
    counts.set(requirement.requestId, (counts.get(requirement.requestId) ?? 0) + 1);
  }
  return projections.map((projection) => toRequestView(projection, counts.get(projection.id) ?? 0));
}

export async function getAnLeistungsanfrageDetail(
  externalLeistungsanfrageId: string,
  anOrgId: string,
) {
  const [projection] = await anDb.select().from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.externalLeistungsanfrageId, externalLeistungsanfrageId),
    eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId),
  )).orderBy(desc(anLeistungsanfragenTable.externalRequestVersion)).limit(1);
  if (!projection) return null;

  let current = projection;
  if (projection.status === "RECEIVED") {
    const [updated] = await anDb.update(anLeistungsanfragenTable).set({
      status: "DETAILS_RETRIEVED",
      detailsRetrievedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(anLeistungsanfragenTable.id, projection.id),
      eq(anLeistungsanfragenTable.status, "RECEIVED"),
    )).returning();
    current = updated ?? projection;
  }

  const requirements = await anDb.select().from(anLeistungsanfrageResourceRequirementsTable)
    .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, current.id));
  return {
    ...toRequestView(current, requirements.length),
    schemaVersion: String(snapshotValue(snapshotOf(current), "schemaVersion") ?? "1.0"),
    snapshotPayload: current.payloadSnapshot,
    resourceRequirements: requirements.map((requirement) => ({
      id: requirement.id,
      resourceTypeId: requirement.localResourceTypeId,
      resourceTypeCode: requirement.externalResourceTypeCode,
      resourceTypeName: requirement.externalResourceTypeName,
      requiredCapacity: requirement.requiredCapacity,
      capacityUnit: requirement.capacityUnit,
      utilizationPercent: requirement.utilizationPercent,
      periodStart: requirement.periodStart,
      periodEnd: requirement.periodEnd,
      requiredQualification: requirement.requiredQualification,
      notes: requirement.notes,
    })),
  };
}

export async function getAnDashboard(anOrgId: string) {
  const requests = await anDb.select().from(anLeistungsanfragenTable)
    .where(eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId))
    .orderBy(desc(anLeistungsanfragenTable.receivedAt));
  const open = requests.filter((request) => actionableStatuses.includes(request.status as typeof actionableStatuses[number]));
  const now = new Date();
  const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const in14d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const dueAt = (request: Projection) => {
    const value = snapshotValue(snapshotOf(request), "responseRequiredBy");
    const date = typeof value === "string" ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const requirementRows = open.length
    ? await anDb.select({ requestId: anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId })
      .from(anLeistungsanfrageResourceRequirementsTable)
      .where(inArray(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, open.map((request) => request.id) as [string, ...string[]]))
    : [];
  const requirementIds = new Set(requirementRows.map((row) => row.requestId));
  const localResponses = open.length
    ? await anDb.select({ requestId: anLeistungsantwortenTable.anLeistungsanfrageId })
      .from(anLeistungsantwortenTable)
      .where(inArray(anLeistungsantwortenTable.anLeistungsanfrageId, open.map((request) => request.id) as [string, ...string[]]))
    : [];
  const responseIds = new Set(localResponses.map((row) => row.requestId));
  const activeBookings = await anDb.select({ id: resourceBookingsTable.id }).from(resourceBookingsTable)
    .where(and(
      eq(resourceBookingsTable.nuOrgId, anOrgId),
      inArray(resourceBookingsTable.status, ["CONFIRMED", "TENTATIVE"]),
    ));

  const actions = open.map((request) => {
    const deadline = dueAt(request);
    const hasRequirements = requirementIds.has(request.id);
    const responded = responseIds.has(request.id);
    const priority = deadline && deadline < now ? 0
      : !request.policySnapshot ? 1
        : request.status === "RECEIVED" ? 2
          : !hasRequirements ? 3
            : responded ? 5 : 4;
    const action = priority === 0 ? "OVERDUE"
      : priority === 1 ? "POLICY_PENDING"
        : priority === 2 ? "RETRIEVE_DATA"
          : priority === 3 ? "ADD_REQUIREMENTS" : "SUBMIT_RESPONSE";
    return {
      ...toRequestView(request, hasRequirements ? 1 : 0),
      responseRequiredBy: deadline?.toISOString() ?? null,
      priority,
      action,
    };
  }).sort((left, right) => left.priority - right.priority).slice(0, 5);

  return {
    pendingRequests: open.length,
    policyPendingCount: open.filter((request) => !request.policySnapshot).length,
    dueSoonCount: open.filter((request) => {
      const deadline = dueAt(request);
      return deadline !== null && deadline >= now && deadline <= in48h;
    }).length,
    activeBookingsCount: activeBookings.length,
    confirmedWork: 0,
    resourceUtilization: [],
    nextActions: actions,
    upcomingDeadlines: open.filter((request) => {
      const deadline = dueAt(request);
      return deadline !== null && deadline >= now && deadline <= in14d;
    }).map((request) => ({
      ...toRequestView(request),
      responseRequiredBy: dueAt(request)?.toISOString() ?? null,
    })),
    recentRequests: requests.slice(0, 10).map((request) => ({
      ...toRequestView(request),
      responseRequiredBy: dueAt(request)?.toISOString() ?? null,
    })),
  };
}

function timeOverlaps(start: Date, end: Date, otherStart: Date, otherEnd: Date): boolean {
  return start < otherEnd && end > otherStart;
}

export function formatAnAvailabilityCheck(check: typeof anAvailabilityChecksTable.$inferSelect) {
  return {
    checkId: check.id,
    status: check.status,
    result: check.result,
    runNumber: check.runNumber,
    internalResult: check.internalResultPayload,
    publicResult: check.publicResultPayload,
    checkedAt: check.checkedAt?.toISOString() ?? null,
    createdAt: check.createdAt.toISOString(),
  };
}

export async function runAnAvailabilityCheck(
  externalLeistungsanfrageId: string,
  anOrgId: string,
  userId: string,
) {
  const [projection] = await anDb.select().from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.externalLeistungsanfrageId, externalLeistungsanfrageId),
    eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId),
  )).orderBy(desc(anLeistungsanfragenTable.externalRequestVersion)).limit(1);
  if (!projection) return null;

  const [requirements, resources, bookings, previous] = await Promise.all([
    anDb.select().from(anLeistungsanfrageResourceRequirementsTable)
      .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, projection.id)),
    anDb.select().from(resourcesTable).where(and(
      eq(resourcesTable.anOrgId, anOrgId),
      eq(resourcesTable.active, true),
    )),
    anDb.select().from(resourceBookingsTable).where(and(
      eq(resourceBookingsTable.nuOrgId, anOrgId),
      inArray(resourceBookingsTable.status, ["CONFIRMED", "TENTATIVE"]),
    )),
    anDb.select({ runNumber: anAvailabilityChecksTable.runNumber })
      .from(anAvailabilityChecksTable)
      .where(and(
        eq(anAvailabilityChecksTable.anLeistungsanfrageId, projection.id),
        eq(anAvailabilityChecksTable.anOrgId, anOrgId),
      ))
      .orderBy(desc(anAvailabilityChecksTable.runNumber))
      .limit(1),
  ]);

  const conflicts: Array<Record<string, unknown>> = [];
  const availableResources: Array<Record<string, unknown>> = [];
  const missingQualifications: string[] = [];
  const tentativeWarnings: Array<Record<string, unknown>> = [];

  for (const requirement of requirements) {
    const start = new Date(requirement.periodStart || projection.plannedStart);
    const end = new Date(requirement.periodEnd || projection.plannedEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      conflicts.push({ conflictType: "OVERLAP", resourceId: null, resourceName: requirement.externalResourceTypeName });
      continue;
    }
    if (!requirement.localResourceTypeId) {
      conflicts.push({
        conflictType: "MISSING_EQUIPMENT",
        resourceId: null,
        resourceName: requirement.externalResourceTypeName,
      });
      continue;
    }

    const candidates = resources.filter((resource) => resource.resourceTypeId === requirement.localResourceTypeId);
    if (!candidates.length) {
      conflicts.push({
        conflictType: "MISSING_EQUIPMENT",
        resourceId: null,
        resourceName: requirement.externalResourceTypeName,
      });
      continue;
    }

    const requiredCapacity = Number(requirement.requiredCapacity ?? 1);
    const availableCapacity = candidates.reduce((total, resource) => {
      const matchingBookings = bookings.filter((booking) =>
        (booking.resourceId === resource.id || booking.resourceTypeId === requirement.localResourceTypeId)
        && timeOverlaps(start, end, booking.startAt, booking.endAt),
      );
      const confirmedUse = matchingBookings
        .filter((booking) => booking.status === "CONFIRMED")
        .reduce((sum, booking) => sum + (booking.quantity ?? booking.utilizationPercent / 100), 0);
      for (const booking of matchingBookings.filter((entry) => entry.status === "TENTATIVE")) {
        tentativeWarnings.push({
          resourceId: resource.id,
          bookingId: booking.id,
          overlapStart: booking.startAt.toISOString(),
          overlapEnd: booking.endAt.toISOString(),
        });
      }
      return total + Math.max(0, (resource.capacity ?? 1) - confirmedUse);
    }, 0);

    if (availableCapacity < requiredCapacity) {
      conflicts.push({
        conflictType: "CAPACITY_EXCEEDED",
        resourceId: null,
        resourceName: requirement.externalResourceTypeName,
        requiredCapacity,
        availableCapacity,
      });
      continue;
    }
    availableResources.push({
      resourceId: null,
      resourceType: requirement.externalResourceTypeName,
      resourceTypeId: requirement.localResourceTypeId,
      quantity: availableCapacity,
      utilizationPercent: requirement.utilizationPercent,
      periodStart: requirement.periodStart,
      periodEnd: requirement.periodEnd,
    });
  }

  const result = conflicts.length ? "NOT_FEASIBLE" as const : "FEASIBLE" as const;
  const publicResult = {
    recommendedDecision: result === "FEASIBLE" ? "ACCEPTED" as const : "REJECTED" as const,
    reasonCode: result === "FEASIBLE" ? "FEASIBLE" as const : "RESOURCE_CONFLICT" as const,
    alternatives: [],
    nextAvailableDate: null,
  };
  const now = new Date();
  const [check] = await anDb.insert(anAvailabilityChecksTable).values({
    anLeistungsanfrageId: projection.id,
    anOrgId,
    createdByUserId: userId,
    status: "COMPLETED",
    result,
    runNumber: (previous[0]?.runNumber ?? 0) + 1,
    internalResultPayload: {
      conflicts: conflicts as never[],
      availableResources: availableResources as never[],
      missingQualifications,
      unavailableEquipment: [],
      tentativeWarnings: tentativeWarnings as never[],
    },
    publicResultPayload: publicResult,
    checkedAt: now,
  }).returning();

  if (projection.status === "DETAILS_RETRIEVED") {
    await anDb.update(anLeistungsanfragenTable).set({ status: "UNDER_REVIEW", updatedAt: now })
      .where(eq(anLeistungsanfragenTable.id, projection.id));
  }
  return check;
}

export async function getLatestAnAvailabilityCheck(
  externalLeistungsanfrageId: string,
  anOrgId: string,
) {
  const [projection] = await anDb.select({ id: anLeistungsanfragenTable.id })
    .from(anLeistungsanfragenTable).where(and(
      eq(anLeistungsanfragenTable.externalLeistungsanfrageId, externalLeistungsanfrageId),
      eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId),
    )).orderBy(desc(anLeistungsanfragenTable.externalRequestVersion)).limit(1);
  if (!projection) return { projectionFound: false as const, check: null };
  const [check] = await anDb.select().from(anAvailabilityChecksTable).where(and(
    eq(anAvailabilityChecksTable.anLeistungsanfrageId, projection.id),
    eq(anAvailabilityChecksTable.anOrgId, anOrgId),
  )).orderBy(desc(anAvailabilityChecksTable.runNumber)).limit(1);
  return { projectionFound: true as const, check: check ?? null };
}
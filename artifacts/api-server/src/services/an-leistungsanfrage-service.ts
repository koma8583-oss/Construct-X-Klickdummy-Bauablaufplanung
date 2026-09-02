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
import { z } from "zod";
import {
  InvalidRequirementPeriodError,
  ResourceRequirementNotFoundError,
  requirementUpdateSchema,
} from "./resource-requirements-service";
import { toExternalResourceRequirementsFromSnapshot, toExternalServiceRequest } from "./dataspace/external-mappers";
import { deliverLocalServiceRequest, deliverLocalServiceResponse } from "./dataspace/local-dataspace-delivery";
import { createAnServiceResponse, type CreateAnServiceResponseResult } from "./nu-response-service";
import type { ExternalServiceRequest } from "./dataspace/external-contracts";
import type { TaktRequestSnapshotPayload } from "../lib/takt-request-snapshot-service";
import {
  generateAlternatives,
  toPublicAlternative,
  type AlternativeRequirement,
  type AlternativeResource,
} from "./alternative-generator";

const actionableStatuses = ["RECEIVED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"] as const;

type Projection = typeof anLeistungsanfragenTable.$inferSelect;
type PayloadSnapshot = Record<string, unknown>;
type WorkflowAction = "RESPOND_TO_REQUEST" | "DECIDE_RESPONSE" | "RESPOND_TO_CHANGE_PROPOSAL" | "NO_ACTION";
type WorkflowOwner = "AG" | "AN";
type WorkflowView = {
  nextActionOwner: WorkflowOwner | null;
  nextAction: WorkflowAction;
  coordinationState: "AGREED" | "AG_ACTION_REQUIRED" | "AN_ACTION_REQUIRED" | "NO_AGREEMENT";
  openProposal: {
    id: string;
    start: string;
    end: string;
    proposerRole: WorkflowOwner;
    comment: string | null;
  } | null;
};

function snapshotOf(projection: Projection): PayloadSnapshot {
  return projection.payloadSnapshot as PayloadSnapshot;
}

function snapshotValue(snapshot: PayloadSnapshot, key: string): unknown {
  return snapshot[key] ?? (snapshot.request as Record<string, unknown> | undefined)?.[key];
}

function toRequestView(projection: Projection, requirementCount = 0, workflow?: WorkflowView) {
  const snapshot = snapshotOf(projection);
  const releasedSnapshot = snapshotValue(snapshot, "publicSnapshot");
  const displaySnapshot = Object.keys(objectRecord(releasedSnapshot)).length > 0
    ? objectRecord(releasedSnapshot)
    : snapshot;
  const plannedTimeWindow = snapshotValue(displaySnapshot, "plannedTimeWindow") as Record<string, unknown> | undefined;
  const responseRequiredBy = snapshotValue(snapshot, "responseRequiredBy");
  const requestNumber = snapshotValue(snapshot, "requestNumber");
  const projectName = snapshotValue(snapshot, "projectName");
  const location = snapshotValue(displaySnapshot, "projectLocation");
  const serviceName = snapshotValue(displaySnapshot, "kurzbezeichnung");
  const workPackage = snapshotValue(displaySnapshot, "workPackage");
  const trade = snapshotValue(displaySnapshot, "trade");
  const zone = objectRecord(snapshotValue(displaySnapshot, "location")).zone;

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
    guOrgName: typeof snapshotValue(snapshot, "senderOrganizationName") === "string"
      ? snapshotValue(snapshot, "senderOrganizationName") : null,
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
    nextActionOwner: workflow?.nextActionOwner ?? null,
    nextAction: workflow?.nextAction ?? "NO_ACTION",
    coordinationState: workflow?.coordinationState ?? "NO_AGREEMENT",
    openProposal: workflow?.openProposal ?? null,
    takt: {
      id: projection.leistungReference,
      taktBezeichnung: typeof workPackage === "string" ? workPackage : null,
      kurzbezeichnung: typeof serviceName === "string" ? serviceName : null,
      gewerk: typeof trade === "string" ? trade : null,
      zone: typeof zone === "string" ? zone : null,
      plannedStart: typeof plannedTimeWindow?.start === "string" ? plannedTimeWindow.start : projection.plannedStart,
      plannedEnd: typeof plannedTimeWindow?.end === "string" ? plannedTimeWindow.end : projection.plannedEnd,
    },
    project: {
      id: projection.projectReference,
      name: typeof projectName === "string" ? projectName : null,
      location: typeof location === "string" ? location : null,
    },
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
  const requestIds = [...new Set(projections.map((projection) =>
    coordinationRequestKind(projection) === "SCHEDULE_CHANGE"
      ? coordinationSourceRequestId(projection)
      : projection.externalLeistungsanfrageId,
  ).filter((id): id is string => !!id))];
  const workflows = new Map<string, WorkflowView>();
  await Promise.all(requestIds.map(async (requestId) => {
    const coordination = await getAnCoordination(requestId, anOrgId);
    if (!coordination) return;
    workflows.set(requestId, {
      nextActionOwner: coordination.nextActionOwner,
      nextAction: coordination.nextAction,
      coordinationState: coordination.coordinationState as WorkflowView["coordinationState"],
      openProposal: coordination.openProposal
        ? {
            id: coordination.openProposal.id,
            start: coordination.openProposal.start,
            end: coordination.openProposal.end,
            proposerRole: coordination.openProposal.proposer === "AG" ? "AG" : "AN",
            comment: null,
          }
        : null,
    });
  }));
  return projections.map((projection) => {
    const requestId = coordinationRequestKind(projection) === "SCHEDULE_CHANGE"
      ? coordinationSourceRequestId(projection)
      : projection.externalLeistungsanfrageId;
    return toRequestView(projection, counts.get(projection.id) ?? 0, requestId ? workflows.get(requestId) : undefined);
  });
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
  const publicSnapshot = objectRecord(snapshotValue(snapshotOf(current), "publicSnapshot"));
  return {
    ...toRequestView(current, requirements.length),
    schemaVersion: String(snapshotValue(snapshotOf(current), "schemaVersion") ?? "1.0"),
    snapshotPayload: Object.keys(publicSnapshot).length > 0
      ? publicSnapshot
      : current.payloadSnapshot,
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
    detailsRetrievedNow: projection.status === "RECEIVED",
  };
}

/**
 * Update an AN-owned requirement in the local Leistungsanfrage projection.
 *
 * AN coordination views must never reach through to the AG requirement table:
 * the projection is the AN domain's writable copy for local planning details.
 * The requirement and its parent projection timestamp are updated together so
 * a successful response can always be followed by a read of the same values.
 */
export async function updateAnResourceRequirement(
  externalLeistungsanfrageId: string,
  requirementId: string,
  anOrgId: string,
  patch: z.infer<typeof requirementUpdateSchema>,
) {
  return anDb.transaction(async (tx) => {
    const [projection] = await tx.select({ id: anLeistungsanfragenTable.id })
      .from(anLeistungsanfragenTable)
      .where(and(
        eq(anLeistungsanfragenTable.externalLeistungsanfrageId, externalLeistungsanfrageId),
        eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId),
      ))
      .orderBy(desc(anLeistungsanfragenTable.externalRequestVersion))
      .limit(1);
    if (!projection) return null;

    const [existing] = await tx.select()
      .from(anLeistungsanfrageResourceRequirementsTable)
      .where(and(
        eq(anLeistungsanfrageResourceRequirementsTable.id, requirementId),
        eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, projection.id),
      ))
      .limit(1);
    if (!existing) throw new ResourceRequirementNotFoundError();

    const periodStart = patch.periodStart !== undefined
      ? patch.periodStart
      : existing.periodStart;
    const periodEnd = patch.periodEnd !== undefined
      ? patch.periodEnd
      : existing.periodEnd;
    if (!periodStart || !periodEnd || periodStart > periodEnd) {
      throw new InvalidRequirementPeriodError();
    }

    const now = new Date();
    const [updated] = await tx.update(anLeistungsanfrageResourceRequirementsTable)
      .set({
        ...(patch.requiredCapacity !== undefined
          ? { requiredCapacity: patch.requiredCapacity.toString() }
          : {}),
        ...(patch.utilizationPercent !== undefined
          ? { utilizationPercent: patch.utilizationPercent }
          : {}),
        ...(patch.requiredQualification !== undefined
          ? { requiredQualification: patch.requiredQualification }
          : {}),
        periodStart,
        periodEnd,
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedAt: now,
      })
      .where(and(
        eq(anLeistungsanfrageResourceRequirementsTable.id, requirementId),
        eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, projection.id),
      ))
      .returning();
    if (!updated) throw new ResourceRequirementNotFoundError();

    const [updatedProjection] = await tx.update(anLeistungsanfragenTable)
      .set({ updatedAt: now })
      .where(eq(anLeistungsanfragenTable.id, projection.id))
      .returning({ id: anLeistungsanfragenTable.id });
    if (!updatedProjection) {
      throw new Error("AN Leistungsanfrage projection could not be updated");
    }

    return {
      id: updated.id,
      leistungsanfrageId: externalLeistungsanfrageId,
      taktRequestId: externalLeistungsanfrageId,
      localProjectionId: projection.id,
      resourceTypeId: updated.localResourceTypeId,
      resourceTypeCode: updated.externalResourceTypeCode,
      resourceTypeName: updated.externalResourceTypeName,
      requiredCapacity: updated.requiredCapacity,
      capacityUnit: updated.capacityUnit,
      utilizationPercent: updated.utilizationPercent,
      periodStart: updated.periodStart,
      periodEnd: updated.periodEnd,
      requiredQualification: updated.requiredQualification,
      notes: updated.notes,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });
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
  userId: string | null,
  options: { excludeSourceReferenceIds?: string[] } = {},
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
  const excludedSources = new Set(options.excludeSourceReferenceIds ?? []);
  const relevantBookings = bookings.filter((booking) =>
    !booking.sourceReferenceId || !excludedSources.has(booking.sourceReferenceId),
  );

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
      const matchingBookings = relevantBookings.filter((booking) =>
        (
          booking.resourceId === resource.id ||
          (booking.resourceId === null && booking.resourceTypeId === requirement.localResourceTypeId)
        ) &&
        timeOverlaps(start, end, booking.startAt, booking.endAt),
      );
      const confirmedUse = matchingBookings
        .filter((booking) => booking.status === "CONFIRMED")
        .reduce((sum, booking) => {
          if (booking.resourceId === null) {
            return sum + (booking.quantity ?? 0) * booking.utilizationPercent / 100;
          }
          return sum + (resource.capacity ?? 1) * booking.utilizationPercent / 100;
        }, 0);
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

  const alternatives = conflicts.length > 0
    ? generateAlternatives(
      {
        plannedTimeWindow: {
          start: projection.plannedStart,
          end: projection.plannedEnd,
        },
        bufferTimeWindow: {
          earliestStart: projection.plannedStart,
          latestEnd: projection.plannedEnd,
        },
        resourceRequirements: [],
      } as unknown as TaktRequestSnapshotPayload,
      resources.map((resource): AlternativeResource => ({
        resourceId: resource.id,
        resourceType: resource.type,
        resourceTypeId: resource.resourceTypeId,
        capacity: resource.capacity,
        capacityUnit: resource.capacityUnit,
        active: resource.active,
        qualifications: resource.qualifications,
      })),
      relevantBookings,
      requirements.map((requirement): AlternativeRequirement => ({
        resourceTypeId: requirement.localResourceTypeId,
        requiredCapacity: requirement.requiredCapacity,
        utilizationPercent: requirement.utilizationPercent,
        requiredQualification: requirement.requiredQualification,
        periodStart: requirement.periodStart,
        periodEnd: requirement.periodEnd,
      })),
    ).map(toPublicAlternative)
    : [];
  const result = conflicts.length === 0
    ? "FEASIBLE" as const
    : alternatives.length > 0
      ? "FEASIBLE_WITH_ALTERNATIVES" as const
      : "NOT_FEASIBLE" as const;
  const publicResult = {
    recommendedDecision: result === "FEASIBLE"
      ? "ACCEPTED" as const
      : result === "FEASIBLE_WITH_ALTERNATIVES"
        ? "ALTERNATIVES_PROPOSED" as const
        : "REJECTED" as const,
    reasonCode: result === "FEASIBLE" ? "FEASIBLE" as const : "RESOURCE_CONFLICT" as const,
    alternatives,
    nextAvailableDate: alternatives[0]?.timeWindow.start ?? null,
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

type CoordinationWindow = { start: string; end: string };

function coordinationSnapshot(projection: Projection): PayloadSnapshot {
  return snapshotOf(projection);
}

function coordinationRequestKind(projection: Projection): string | undefined {
  const value = snapshotValue(coordinationSnapshot(projection), "requestKind");
  return typeof value === "string" ? value : undefined;
}

function coordinationSourceRequestId(projection: Projection): string | undefined {
  const value = snapshotValue(coordinationSnapshot(projection), "sourceRequestId");
  return typeof value === "string" ? value : undefined;
}

function coordinationWindow(projection: Projection): CoordinationWindow {
  return { start: projection.plannedStart, end: projection.plannedEnd };
}

async function coordinationProjections(requestId: string, anOrgId: string) {
  const rows = await anDb.select().from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId),
  )).orderBy(desc(anLeistungsanfragenTable.externalRequestVersion));
  const related = rows.filter((row) =>
    row.externalLeistungsanfrageId === requestId ||
    coordinationSourceRequestId(row) === requestId,
  );
  return related;
}

async function responseForProjection(projectionId: string) {
  const [response] = await anDb.select().from(anLeistungsantwortenTable)
    .where(eq(anLeistungsantwortenTable.anLeistungsanfrageId, projectionId))
    .orderBy(desc(anLeistungsantwortenTable.createdAt)).limit(1);
  return response ?? null;
}

/**
 * Read-only AN coordination view. It is intentionally assembled exclusively
 * from the AN projection and its local response rows.
 */
export async function getAnCoordination(
  requestId: string,
  anOrgId: string,
) {
  const projections = await coordinationProjections(requestId, anOrgId);
  const root = projections.find((projection) =>
    projection.externalLeistungsanfrageId === requestId &&
    coordinationRequestKind(projection) !== "SCHEDULE_CHANGE",
  ) ?? projections.find((projection) => projection.externalLeistungsanfrageId === requestId);
  if (!root) return null;

  const scheduleProposals = projections
    .filter((projection) =>
      coordinationRequestKind(projection) === "SCHEDULE_CHANGE" &&
      coordinationSourceRequestId(projection) === requestId &&
      actionableStatuses.includes(projection.status as typeof actionableStatuses[number]),
    )
    .map((projection) => ({
      id: projection.externalLeistungsanfrageId,
      requestId,
      start: projection.plannedStart,
      end: projection.plannedEnd,
      proposerOrgId: projection.senderAgOrgId,
      proposer: projection.senderAgOrgId === anOrgId ? "AN" : "AG",
      canAct: projection.senderAgOrgId !== anOrgId,
      localProjectionId: projection.id,
    }));
  const openProposal = scheduleProposals[0] ?? null;
  const rootResponse = await responseForProjection(root.id);
  const currentAgreement: CoordinationWindow | null = rootResponse?.decision === "ACCEPTED" &&
      rootResponse.acceptedStart && rootResponse.acceptedEnd
    ? { start: rootResponse.acceptedStart.toISOString(), end: rootResponse.acceptedEnd.toISOString() }
    : openProposal
      ? (() => {
        const proposal = projections.find((projection) =>
          projection.externalLeistungsanfrageId === openProposal.id);
        const baseTimeWindow = proposal ? objectRecord(snapshotValue(coordinationSnapshot(proposal), "baseTimeWindow")) : {};
        return typeof baseTimeWindow.start === "string" && typeof baseTimeWindow.end === "string"
          ? { start: baseTimeWindow.start, end: baseTimeWindow.end }
          : null;
      })()
      : null;
  const nextActionOwner: WorkflowOwner | null = openProposal
    ? openProposal.canAct ? "AN" : "AG"
    : root.status === "RESPONDED"
      ? "AG"
      : actionableStatuses.includes(root.status as typeof actionableStatuses[number])
        ? "AN"
        : null;
  const nextAction: WorkflowAction = nextActionOwner === "AN"
    ? openProposal ? "RESPOND_TO_CHANGE_PROPOSAL" : "RESPOND_TO_REQUEST"
    : nextActionOwner === "AG"
      ? openProposal ? "NO_ACTION" : "DECIDE_RESPONSE"
      : "NO_ACTION";
  const coordinationState = nextActionOwner === "AN"
    ? "AN_ACTION_REQUIRED"
    : nextActionOwner === "AG"
      ? "AG_ACTION_REQUIRED"
      : root.status === "CONFIRMED"
        ? "AGREED"
        : "NO_AGREEMENT";

  return {
    requestId,
    currentAgreement,
    openProposal,
    proposals: scheduleProposals,
    nextActionOwner,
    nextAction,
    coordinationState,
  };
}

function publicSnapshotFromProjection(projection: Projection) {
  const snapshot = coordinationSnapshot(projection);
  return objectRecord(snapshotValue(snapshot, "publicSnapshot"));
}

function proposalResourceRequirements(projection: Projection, start: string, end: string) {
  const publicSnapshot = publicSnapshotFromProjection(projection);
  return toExternalResourceRequirementsFromSnapshot(
    publicSnapshot.resourceRequirements,
    { start, end },
  );
}

/**
 * Publish a proposal or counter from the AN side. The only local write is the
 * Dataspace exchange/outbox; AG proposal history is created by the AG inbound
 * processor after delivery.
 */
export async function createAnScheduleChangeProposal(input: {
  requestId: string;
  anOrgId: string;
  userId: string;
  start: string;
  end: string;
  comment?: string;
  supersedesProposalId?: string;
}) {
  const coordination = await getAnCoordination(input.requestId, input.anOrgId);
  if (!coordination) return null;
  if (!coordination.currentAgreement) {
    throw Object.assign(new Error("A current agreement is required before proposing a schedule change"), { statusCode: 422 });
  }
  if (input.supersedesProposalId &&
      coordination.openProposal?.id !== input.supersedesProposalId) {
    return null;
  }
  const projections = await coordinationProjections(input.requestId, input.anOrgId);
  const root = projections.find((projection) =>
    projection.externalLeistungsanfrageId === input.requestId &&
    coordinationRequestKind(projection) !== "SCHEDULE_CHANGE",
  );
  if (!root) return null;
  const proposalId = crypto.randomUUID();
  const snapshot = coordinationSnapshot(root);
  const projectName = snapshotValue(snapshot, "projectName");
  const payload: ExternalServiceRequest = toExternalServiceRequest({
    requestId: proposalId,
    requestVersion: 1,
    requestKind: "SCHEDULE_CHANGE",
    sourceRequestId: input.requestId,
    changeProposalId: proposalId,
    comment: input.comment ?? null,
    baseTimeWindow: coordination.currentAgreement,
    projectReference: root.projectReference,
    projectName: typeof projectName === "string" ? projectName : undefined,
    leistungReference: root.leistungReference,
    taktReference: root.leistungReference,
    plannedStart: input.start,
    plannedEnd: input.end,
    senderOrgId: input.anOrgId,
    senderUserId: input.userId,
    receiverOrgId: root.senderAgOrgId,
    correlationId: proposalId,
    messageId: `an-schedule-change:${proposalId}`,
    resourceRequirements: proposalResourceRequirements(root, input.start, input.end),
  });
  const delivery = await deliverLocalServiceRequest(payload);
  return {
    proposalId,
    requestId: input.requestId,
    start: input.start,
    end: input.end,
    comment: input.comment ?? null,
    transportStatus: delivery.status,
    transportMessageId: payload.metadata.messageId,
  };
}

/**
 * Resolve an incoming AG proposal using its AN-local schedule projection.
 */
export async function resolveAnScheduleChangeProposal(input: {
  requestId: string;
  proposalId: string;
  anOrgId: string;
  userId: string;
  decision: "ACCEPTED" | "REJECTED";
  comment?: string;
}) {
  const projections = await coordinationProjections(input.requestId, input.anOrgId);
  const proposal = projections.find((projection) =>
    projection.externalLeistungsanfrageId === input.proposalId &&
    coordinationRequestKind(projection) === "SCHEDULE_CHANGE" &&
    coordinationSourceRequestId(projection) === input.requestId &&
    actionableStatuses.includes(projection.status as typeof actionableStatuses[number]),
  );
  if (!proposal || proposal.senderAgOrgId === input.anOrgId) return null;
  const window = coordinationWindow(proposal);
  const result: CreateAnServiceResponseResult = await createAnServiceResponse({
    anLeistungsanfrageId: proposal.id,
    anOrgId: input.anOrgId,
    userId: input.userId,
    decision: input.decision,
    acceptedTimeWindow: input.decision === "ACCEPTED" ? window : undefined,
    reasonCode: input.decision === "REJECTED" ? "AN_REJECTED" : undefined,
    comment: input.comment,
    outboundMessageId: `an-schedule-change-response:${input.proposalId}`,
  });
  const delivery = await deliverLocalServiceResponse(result.payload);
  return {
    proposalId: input.proposalId,
    decision: input.decision,
    transportStatus: delivery.status,
    transportMessageId: result.payload.metadata.messageId,
    idempotent: result.idempotent,
  };
}
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leistungsanfragenTable,
  serviceChangeProposalsTable,
  type ServiceChangeProposal,
} from "@workspace/db";
import { applyAcceptedScheduleChange } from "./schedule-change-service";
import { evaluateAvailabilityWindow } from "./availability-check-service";
import { deriveServiceCoordinationState } from "./service-coordination-state";
import { compareCalendarDates, differenceInCalendarDays } from "../lib/calendar-date-utils";

export type CoordinationParty = "AG" | "AN";

export interface ScheduleDelta {
  startDays: number;
  endDays: number;
  durationDays: number;
  hasChange: boolean;
}

export function calculateScheduleDelta(
  baseStart: Date | string | null | undefined,
  baseEnd: Date | string | null | undefined,
  nextStart: Date | string | null | undefined,
  nextEnd: Date | string | null | undefined,
): ScheduleDelta {
  const dates = [baseStart, baseEnd, nextStart, nextEnd].map((v) => v ? new Date(v).toISOString().slice(0, 10) : null);
  if (dates.some((v) => !v)) return { startDays: 0, endDays: 0, durationDays: 0, hasChange: false };
  const [a, b, c, d] = dates as [string, string, string, string];
  const baseDuration = differenceInCalendarDays(a, b) + 1;
  const nextDuration = differenceInCalendarDays(c, d) + 1;
  return {
    startDays: differenceInCalendarDays(a, c),
    endDays: differenceInCalendarDays(b, d),
    durationDays: nextDuration - baseDuration,
    hasChange: a !== c || b !== d,
  };
}

export function partyForOrg(
  request: { guOrgId: string; nuOrgId: string },
  orgId: string,
): CoordinationParty | null {
  if (request.guOrgId === orgId) return "AG";
  if (request.nuOrgId === orgId) return "AN";
  return null;
}

export function deriveCoordinationState(input: {
  openProposal?: Pick<ServiceChangeProposal, "proposerOrgId"> | null;
  currentAgreement?: { start: Date | null; end: Date | null } | null;
  guOrgId?: string;
  nuOrgId: string;
}): { state: "AGREED" | "AG_ACTION_REQUIRED" | "AN_ACTION_REQUIRED" | "NO_AGREEMENT"; nextActionOwner: CoordinationParty | null } {
  if (!input.currentAgreement?.start || !input.currentAgreement.end) {
    return { state: "NO_AGREEMENT", nextActionOwner: input.openProposal ? (input.openProposal.proposerOrgId === input.guOrgId ? "AN" : "AG") : null };
  }
  if (!input.openProposal) return { state: "AGREED", nextActionOwner: null };
  const nextActionOwner = input.openProposal.proposerOrgId === input.guOrgId ? "AN" : "AG";
  return { state: nextActionOwner === "AG" ? "AG_ACTION_REQUIRED" : "AN_ACTION_REQUIRED", nextActionOwner };
}

export function buildCoordinationTimeline(request: {
  guOrgId?: string;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  agreedStart: Date | null;
  agreedEnd: Date | null;
}, proposals: ServiceChangeProposal[]) {
  const events = [
    { type: "REQUEST_CREATED", at: request.createdAt, party: "AG" as CoordinationParty },
    ...(request.sentAt ? [{ type: "REQUEST_SENT", at: request.sentAt, party: "AG" as CoordinationParty }] : []),
    ...(request.deliveredAt ? [{ type: "REQUEST_DELIVERED", at: request.deliveredAt, party: "AN" as CoordinationParty }] : []),
    ...(request.agreedStart && request.agreedEnd ? [{
      type: "AGREEMENT_REACHED",
      at: proposals.find((p) => p.status === "ACCEPTED")?.resolvedAt ?? request.createdAt,
      party: "AG" as CoordinationParty,
      start: request.agreedStart,
      end: request.agreedEnd,
      actorRole: "AG" as CoordinationParty,
    }] : []),
     ...proposals.flatMap((p) => [
       { type: p.action === "COUNTER" ? "COUNTER_PROPOSED" : "PROPOSED", at: p.createdAt, party: request.guOrgId && p.proposerOrgId === request.guOrgId ? "AG" as CoordinationParty : "AN" as CoordinationParty, proposalId: p.id, start: p.start, end: p.end },
        ...(p.resolvedAt ? [{
          type: p.status === "ACCEPTED"
            ? (request.agreedStart && request.agreedEnd ? "CHANGE_PROPOSAL_ACCEPTED" : "AGREEMENT_REACHED")
            : p.status === "REJECTED" ? "REJECTED" : "SUPERSEDED",
          at: p.resolvedAt,
          proposalId: p.id,
          actorRole: request.guOrgId && p.proposerOrgId === request.guOrgId ? "AG" as CoordinationParty : "AN" as CoordinationParty,
        }] : []),
    ]),
  ];
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function getCoordination(requestId: string, orgId: string) {
  const [request] = await db.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, requestId)).limit(1);
  const party = request ? partyForOrg(request, orgId) : null;
  if (!request || !party) return null;
  const proposals = await db.select().from(serviceChangeProposalsTable)
    .where(eq(serviceChangeProposalsTable.leistungsanfrageId, requestId))
    .orderBy(desc(serviceChangeProposalsTable.createdAt));
  const openProposal = proposals.find((p) => p.status === "OPEN") ?? null;
  const currentAgreement = request.agreedStart && request.agreedEnd ? { start: request.agreedStart, end: request.agreedEnd } : null;
  const state = deriveCoordinationState({ openProposal, currentAgreement, guOrgId: request.guOrgId, nuOrgId: request.nuOrgId });
  const action = deriveServiceCoordinationState({
    party,
    requestStatus: request.status,
    openProposalProposer: openProposal
      ? openProposal.proposerOrgId === request.guOrgId ? "AG" : "AN"
      : null,
    hasResponse: ["UNDER_REVIEW", "ALTERNATIVES_PROPOSED", "ACCEPTED", "REJECTED", "REVISION_REQUIRED"].includes(request.status),
    hasDecision: ["ACCEPTED", "CANCELLED", "SUPERSEDED"].includes(request.status),
  });
  const delta = openProposal
    ? calculateScheduleDelta(currentAgreement?.start, currentAgreement?.end, openProposal.start, openProposal.end)
    : { startDays: 0, endDays: 0, durationDays: 0, hasChange: false };
  const publicProposal = (proposal: ServiceChangeProposal | null) => proposal ? {
    id: proposal.id,
    start: proposal.start,
    end: proposal.end,
    proposerRole: proposal.proposerOrgId === request.guOrgId ? "AG" : "AN",
    reasonCode: proposal.reasonCode,
    comment: proposal.comment,
    action: proposal.action,
    status: proposal.status,
    createdAt: proposal.createdAt,
    resolvedAt: proposal.resolvedAt,
  } : null;
  return {
    currentAgreement,
    openProposal: publicProposal(openProposal),
    proposals: proposals.map(publicProposal),
    coordinationState: state.state,
    nextActionOwner: action.nextActionOwner,
    nextAction: action.nextAction,
    responseRequiredBy: request.responseRequiredBy,
    scheduleDelta: delta,
    timeline: buildCoordinationTimeline(request, proposals),
  };
}

export async function createChangeProposal(input: {
  requestId: string;
  orgId: string;
  userId: string;
  start: Date;
  end: Date;
  reasonCode?: string | null;
  comment?: string | null;
  action?: "PROPOSE" | "COUNTER";
  supersedesProposalId?: string | null;
}) {
  if (compareCalendarDates(dateOnly(input.end), dateOnly(input.start)) < 0) {
    throw Object.assign(new Error("Ende muss am oder nach dem Beginn liegen"), { statusCode: 400 });
  }
  return db.transaction(async (tx) => {
    // Serialize proposal creation per request. The OPEN lookup and insert must
    // be one critical section, otherwise two concurrent submissions can both
    // observe an empty OPEN set before either insert commits.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`);
    const [request] = await tx.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, input.requestId)).limit(1);
    const party = request && partyForOrg(request, input.orgId);
    if (!request || !party) throw Object.assign(new Error("Leistungsanfrage nicht gefunden"), { statusCode: 404 });
    if (!request.agreedStart || !request.agreedEnd) {
      throw Object.assign(new Error("CHANGE_PROPOSAL_REQUIRES_AGREEMENT"), { statusCode: 422 });
    }
    if (["CANCELLED", "EXPIRED", "SUPERSEDED", "REJECTED"].includes(request.status)) {
      throw Object.assign(new Error("Für diese Anfrage ist keine Änderung mehr möglich"), { statusCode: 409 });
    }
    const [open] = await tx.select().from(serviceChangeProposalsTable).where(and(
      eq(serviceChangeProposalsTable.leistungsanfrageId, input.requestId),
      eq(serviceChangeProposalsTable.status, "OPEN"),
    )).limit(1);
    if (open) {
      if (input.action !== "COUNTER" || open.proposerOrgId === input.orgId) {
        throw Object.assign(new Error("Es existiert bereits ein offener Vorschlag"), { statusCode: 409 });
      }
      if (input.action === "COUNTER" && input.supersedesProposalId && input.supersedesProposalId !== open.id) {
        throw Object.assign(new Error("Der Gegenvorschlag bezieht sich nicht auf den offenen Vorschlag"), { statusCode: 409 });
      }
      await tx.update(serviceChangeProposalsTable).set({ status: "SUPERSEDED", resolvedAt: new Date(), resolvedByUserId: input.userId })
        .where(eq(serviceChangeProposalsTable.id, open.id));
    }
    const [proposal] = await tx.insert(serviceChangeProposalsTable).values({
      leistungsanfrageId: input.requestId,
      proposerOrgId: input.orgId,
      proposerUserId: input.userId,
      start: input.start,
      end: input.end,
      reasonCode: input.reasonCode ?? null,
      comment: input.comment ?? null,
      action: input.action ?? "PROPOSE",
      supersedesProposalId: input.supersedesProposalId ?? open?.id ?? null,
    }).returning();
    return proposal;
  });
}

export async function resolveChangeProposal(input: {
  requestId: string;
  proposalId: string;
  orgId: string;
  userId: string;
  status: "ACCEPTED" | "REJECTED";
}) {
  return db.transaction(async (tx) => {
     const [proposal] = await tx.select().from(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, input.proposalId)).limit(1);
     if (!proposal || proposal.status !== "OPEN") throw Object.assign(new Error("Offener Vorschlag nicht gefunden"), { statusCode: 404 });
    if (proposal.leistungsanfrageId !== input.requestId) throw Object.assign(new Error("Vorschlag gehört nicht zu dieser Anfrage"), { statusCode: 404 });
    const [request] = await tx.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, proposal.leistungsanfrageId)).limit(1);
    if (!request || !partyForOrg(request, input.orgId) || proposal.proposerOrgId === input.orgId) {
      throw Object.assign(new Error("Nur die Gegenseite darf diesen Vorschlag entscheiden"), { statusCode: 403 });
    }
     if (input.status === "ACCEPTED" && request.agreedStart && request.agreedEnd) {
       const availability = await evaluateAvailabilityWindow(
         request.id,
         request.nuOrgId,
         proposal.start,
         proposal.end,
         request.id,
       );
       if (availability.conflicts.some((conflict) => !conflict.isTentative)) {
         throw Object.assign(new Error("CHANGE_PROPOSAL_NOT_FEASIBLE"), {
           statusCode: 409,
           code: "CHANGE_PROPOSAL_NOT_FEASIBLE",
           availability,
         });
       }
     }
     const now = new Date();
    const [updated] = await tx.update(serviceChangeProposalsTable).set({
      status: input.status, resolvedAt: now, resolvedByUserId: input.userId,
    }).where(and(eq(serviceChangeProposalsTable.id, input.proposalId), eq(serviceChangeProposalsTable.status, "OPEN"))).returning();
     if (!updated) {
       throw Object.assign(new Error("CHANGE_PROPOSAL_ALREADY_RESOLVED"), { statusCode: 409 });
     }
    if (input.status === "ACCEPTED") {
       await applyAcceptedScheduleChange(tx, {
         serviceRequestId: request.id,
         newStart: proposal.start,
         newEnd: proposal.end,
         initiatedBy: proposal.proposerOrgId === request.guOrgId ? "AG" : "AN",
         proposalId: proposal.id,
       });
    }
    return updated;
  });
}

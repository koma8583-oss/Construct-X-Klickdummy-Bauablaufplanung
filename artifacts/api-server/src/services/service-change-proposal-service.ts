import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leistungsanfragenTable,
  serviceChangeProposalsTable,
  type ServiceChangeProposal,
} from "@workspace/db";
import { applyAcceptedScheduleChange } from "./schedule-change-service";

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
  const values = [baseStart, baseEnd, nextStart, nextEnd].map((v) => v ? new Date(v).getTime() : NaN);
  if (values.some(Number.isNaN)) return { startDays: 0, endDays: 0, durationDays: 0, hasChange: false };
  const [a, b, c, d] = values;
  return {
    startDays: Math.round((c - a) / 86_400_000),
    endDays: Math.round((d - b) / 86_400_000),
    durationDays: Math.round(((d - c) - (b - a)) / 86_400_000),
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
    }] : []),
     ...proposals.flatMap((p) => [
       { type: p.action === "COUNTER" ? "COUNTER_PROPOSED" : "PROPOSED", at: p.createdAt, party: request.guOrgId && p.proposerOrgId === request.guOrgId ? "AG" as CoordinationParty : "AN" as CoordinationParty, proposalId: p.id, start: p.start, end: p.end },
       ...(p.resolvedAt ? [{ type: p.status === "ACCEPTED" ? "ACCEPTED" : p.status === "REJECTED" ? "REJECTED" : "SUPERSEDED", at: p.resolvedAt, proposalId: p.id }] : []),
    ]),
  ];
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function getCoordination(requestId: string, orgId: string) {
  const [request] = await db.select().from(leistungsanfragenTable).where(eq(leistungsanfragenTable.id, requestId)).limit(1);
  if (!request || !partyForOrg(request, orgId)) return null;
  const proposals = await db.select().from(serviceChangeProposalsTable)
    .where(eq(serviceChangeProposalsTable.leistungsanfrageId, requestId))
    .orderBy(desc(serviceChangeProposalsTable.createdAt));
  const openProposal = proposals.find((p) => p.status === "OPEN") ?? null;
  const currentAgreement = request.agreedStart && request.agreedEnd ? { start: request.agreedStart, end: request.agreedEnd } : null;
  const state = deriveCoordinationState({ openProposal, currentAgreement, guOrgId: request.guOrgId, nuOrgId: request.nuOrgId });
  const delta = openProposal
    ? calculateScheduleDelta(currentAgreement?.start, currentAgreement?.end, openProposal.start, openProposal.end)
    : { startDays: 0, endDays: 0, durationDays: 0, hasChange: false };
  return {
    currentAgreement,
    openProposal,
    proposals,
    coordinationState: state.state,
    nextActionOwner: state.nextActionOwner,
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
  if (input.end < input.start) throw Object.assign(new Error("Ende muss am oder nach dem Beginn liegen"), { statusCode: 400 });
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

/**
 * NuResponseService — unified response processing for Task 81.
 *
 * processNuResponse():
 *   - Accepts canonical response payload (decision + acceptedTimeWindow +
 *     alternatives[].timeWindow + reasonCode + comment + nextAvailableDate)
 *   - Computes a SHA-256 hash over the canonical public payload (sorted keys)
 *     for full-payload idempotency (not just decision-level idempotency)
 *   - Checks existing response: same hash → idempotent 200; different → 409
 *   - Wraps response insert + alternatives insert + request status update in
 *     a single DB transaction so all three succeed or all roll back together
 *   - Returns the saved response/alternatives plus the hash and idempotency flag
 */
import { createHash } from "crypto";
import { agDb, anDb } from "@workspace/db";
import {
  anLeistungsanfragenTable,
  anLeistungsanfrageResourceRequirementsTable,
  anLeistungsantwortAlternativenTable,
  anLeistungsantwortenTable,
  leistungsanfragenTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktRequestsTable,
  type TaktResponse,
  type TaktResponseAlternativeRow,
  type TaktDecision,
  type TaktRequestStatus,
} from "@workspace/db";
import { and, desc, eq, ne } from "drizzle-orm";
import type { ExternalServiceResponse } from "./dataspace/external-contracts";
import { getTaktResponseWithAlternatives, TaktResponseValidationError } from "../lib/takt-response-repository";
import { withCanonicalResponse } from "../lib/legacy-takt-mappers";
import { writeAuditEvent } from "../lib/takt-request-audit-service";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NuResponseAlternativeInput {
  alternativeId: string;
  rank: number;
  timeWindow: { start: string; end: string };
  crewSize?: number;
  conditions?: string[];
}

export interface ProcessNuResponseInput {
  taktRequestId:     string;
  nuOrgId:           string;
  userId:            string;
  decision:          TaktDecision;
  acceptedTimeWindow?: { start: string; end: string };
  reasonCode?:       string;
  comment?:          string;
  alternatives?:     NuResponseAlternativeInput[];
  nextAvailableDate?: string;
  /** Answerable statuses — caller supplies set so service stays stateless */
  answerableStatuses: Set<string>;
  currentRequestStatus: string;
  messageId:         string;
}

export interface ProcessNuResponseResult {
  response:    TaktResponse;
  alternatives: TaktResponseAlternativeRow[];
  newStatus:   TaktRequestStatus;
  payloadHash: string;
  idempotent:  boolean;
  /** True when the payload hash matched an existing response (200 path) */
}

// ── Domain errors ─────────────────────────────────────────────────────────────

export class ResponseConflictError extends Error {
  constructor(
    public readonly existingDecision: string,
    public readonly incomingDecision: string,
    public readonly reason: "DIFFERENT_DECISION" | "DIFFERENT_PAYLOAD",
  ) {
    super(
      reason === "DIFFERENT_DECISION"
        ? `A response with decision "${existingDecision}" already exists. Cannot replace with "${incomingDecision}".`
        : `A response with decision "${existingDecision}" already exists with different payload content. ` +
          `Idempotency key reuse with different payload is not allowed.`,
    );
    this.name = "ResponseConflictError";
  }
}

export class ResponseStatusError extends Error {
  constructor(public readonly currentStatus: string, answerableStatuses: Set<string>) {
    super(
      `TaktRequest cannot be answered in status "${currentStatus}". ` +
      `Expected: ${[...answerableStatuses].join(", ")}`,
    );
    this.name = "ResponseStatusError";
  }
}

export interface CreateAnServiceResponseInput {
  anLeistungsanfrageId: string;
  anOrgId: string;
  userId: string;
  decision: TaktDecision;
  acceptedTimeWindow?: { start: string; end: string };
  reasonCode?: string;
  comment?: string;
  alternatives?: NuResponseAlternativeInput[];
  nextAvailableDate?: string;
  outboundMessageId?: string;
}

export interface CreateAnServiceResponseResult {
  response: typeof anLeistungsantwortenTable.$inferSelect;
  alternatives: Array<typeof anLeistungsantwortAlternativenTable.$inferSelect>;
  payload: ExternalServiceResponse;
  payloadHash: string;
  idempotent: boolean;
}

/**
 * Resolves the newest usable AN projection for an externally addressed
 * Leistungsanfrage. Routes deliberately use this instead of loading the
 * AG-owned request: the external request ID is sufficient at the AN boundary.
 */
export async function getAnServiceRequestForResponse(
  externalLeistungsanfrageId: string,
  anOrgId: string,
) {
  const [request] = await anDb.select().from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.externalLeistungsanfrageId, externalLeistungsanfrageId),
    eq(anLeistungsanfragenTable.receiverAnOrgId, anOrgId),
    ne(anLeistungsanfragenTable.status, "SUPERSEDED"),
  )).orderBy(desc(anLeistungsanfragenTable.externalRequestVersion)).limit(1);
  return request ?? null;
}

function responsePayload(
  requestId: string,
  requestVersion: number,
  input: Pick<CreateAnServiceResponseInput, "decision" | "acceptedTimeWindow" | "reasonCode" | "comment" | "alternatives" | "nextAvailableDate">,
): Record<string, unknown> {
  return {
    requestId,
    requestVersion,
    decision: input.decision,
    reasonCode: input.reasonCode ?? null,
    comment: input.comment ?? null,
    acceptedTimeWindow: input.acceptedTimeWindow ?? null,
    alternatives: input.alternatives?.map((alternative) => ({
      alternativeId: alternative.alternativeId,
      rank: alternative.rank,
      timeWindow: alternative.timeWindow,
      crewSize: alternative.crewSize ?? null,
      conditions: alternative.conditions ?? null,
    })) ?? null,
    nextAvailableDate: input.nextAvailableDate ?? null,
  };
}

function validateAnResponseInput(input: CreateAnServiceResponseInput): void {
  validateInput({
    taktRequestId: input.anLeistungsanfrageId,
    nuOrgId: input.anOrgId,
    userId: input.userId,
    decision: input.decision,
    acceptedTimeWindow: input.acceptedTimeWindow,
    reasonCode: input.reasonCode,
    comment: input.comment,
    alternatives: input.alternatives,
    nextAvailableDate: input.nextAvailableDate,
    answerableStatuses: new Set(["RECEIVED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"]),
    currentRequestStatus: "UNDER_REVIEW",
    messageId: input.outboundMessageId ?? "",
  });
}

/**
 * AN-owned response creation. This service deliberately has no AG database
 * dependency: the request and response both live in the AN projection.
 */
export async function createAnServiceResponse(
  input: CreateAnServiceResponseInput,
): Promise<CreateAnServiceResponseResult> {
  validateAnResponseInput(input);
  const [request] = await anDb.select().from(anLeistungsanfragenTable).where(and(
    eq(anLeistungsanfragenTable.id, input.anLeistungsanfrageId),
    eq(anLeistungsanfragenTable.receiverAnOrgId, input.anOrgId),
  )).limit(1);
  if (!request) throw new ResponseStatusError("NOT_FOUND", new Set(["AN-owned request"]));
  const answerableStatuses = new Set(["RECEIVED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"]);
  if (!answerableStatuses.has(request.status)) {
    throw new ResponseStatusError(request.status, answerableStatuses);
  }

  const canonical = responsePayload(request.externalLeistungsanfrageId, request.externalRequestVersion, input);
  const payloadHash = computeResponsePayloadHash(canonical);
  const [existing] = await anDb.select().from(anLeistungsantwortenTable).where(and(
    eq(anLeistungsantwortenTable.anLeistungsanfrageId, request.id),
    eq(anLeistungsantwortenTable.requestVersion, request.externalRequestVersion),
  )).limit(1);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new ResponseConflictError(existing.decision, input.decision, "DIFFERENT_PAYLOAD");
    }
    const alternatives = await anDb.select().from(anLeistungsantwortAlternativenTable)
      .where(eq(anLeistungsantwortAlternativenTable.responseId, existing.id));
    return {
      response: existing,
      alternatives,
      payload: buildExternalResponse(request, existing, alternatives),
      payloadHash,
      idempotent: true,
    };
  }

  const outboundMessageId = input.outboundMessageId ?? crypto.randomUUID();
  const saved = await anDb.transaction(async (tx) => {
    const [response] = await tx.insert(anLeistungsantwortenTable).values({
      anLeistungsanfrageId: request.id,
      sourceRequestId: request.externalLeistungsanfrageId,
      requestVersion: request.externalRequestVersion,
      decision: input.decision,
      reasonCode: input.reasonCode ?? null,
      comment: input.comment ?? null,
      acceptedStart: input.acceptedTimeWindow ? new Date(input.acceptedTimeWindow.start) : null,
      acceptedEnd: input.acceptedTimeWindow ? new Date(input.acceptedTimeWindow.end) : null,
      nextAvailableDate: input.nextAvailableDate ?? null,
      payloadHash,
      outboundMessageId,
      createdByUserId: input.userId,
    }).returning();
    if (!response) throw new Error("Failed to create AN service response");
    let alternatives: Array<typeof anLeistungsantwortAlternativenTable.$inferSelect> = [];
    if (input.alternatives?.length) {
      alternatives = await tx.insert(anLeistungsantwortAlternativenTable).values(
        input.alternatives.map((alternative) => ({
          responseId: response.id,
          alternativeId: alternative.alternativeId,
          rank: alternative.rank,
          proposedStart: new Date(alternative.timeWindow.start),
          proposedEnd: new Date(alternative.timeWindow.end),
          crewSize: alternative.crewSize ?? null,
          conditions: alternative.conditions ?? null,
        })),
      ).returning();
    }
    await tx.update(anLeistungsanfragenTable).set({
      status: "RESPONDED",
      respondedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(anLeistungsanfragenTable.id, request.id));
    return { response, alternatives };
  });

  const payload: ExternalServiceResponse = {
    metadata: {
      messageId: outboundMessageId,
      correlationId: request.correlationId,
      schemaVersion: "1.0",
      senderOrgId: input.anOrgId,
      receiverOrgId: request.senderAgOrgId,
      createdAt: new Date().toISOString(),
    },
    requestId: request.externalLeistungsanfrageId,
    requestVersion: request.externalRequestVersion,
    decision: input.decision,
    acceptedTimeWindow: input.acceptedTimeWindow,
    reasonCode: input.reasonCode,
    comment: input.comment,
    alternatives: input.alternatives?.map((alternative) => ({
      alternativeId: alternative.alternativeId,
      rank: alternative.rank,
      timeWindow: alternative.timeWindow,
      crewSize: alternative.crewSize ?? null,
      conditions: alternative.conditions?.join("; ") ?? null,
    })),
    nextAvailableDate: input.nextAvailableDate,
  };
  return { ...saved, payload, payloadHash, idempotent: false };
}

function buildExternalResponse(
  request: typeof anLeistungsanfragenTable.$inferSelect,
  response: typeof anLeistungsantwortenTable.$inferSelect,
  alternatives: Array<typeof anLeistungsantwortAlternativenTable.$inferSelect>,
): ExternalServiceResponse {
  return {
    metadata: {
      messageId: response.outboundMessageId,
      correlationId: request.correlationId,
      schemaVersion: "1.0",
      senderOrgId: request.receiverAnOrgId,
      receiverOrgId: request.senderAgOrgId,
      createdAt: response.createdAt.toISOString(),
    },
    requestId: response.sourceRequestId,
    requestVersion: response.requestVersion,
    decision: response.decision,
    acceptedTimeWindow: response.acceptedStart && response.acceptedEnd
      ? { start: response.acceptedStart.toISOString(), end: response.acceptedEnd.toISOString() }
      : undefined,
    reasonCode: response.reasonCode ?? undefined,
    comment: response.comment ?? undefined,
    alternatives: alternatives.map((alternative) => ({
      alternativeId: alternative.alternativeId,
      rank: alternative.rank,
      timeWindow: {
        start: alternative.proposedStart.toISOString(),
        end: alternative.proposedEnd.toISOString(),
      },
      crewSize: alternative.crewSize,
      conditions: alternative.conditions?.join("; ") ?? null,
    })),
    nextAvailableDate: response.nextAvailableDate ?? undefined,
  };
}

/**
 * AG-owned application of an incoming AN response. This is the only response
 * processor used by Dataspace inbound and it never touches AN tables.
 */
export async function applyIncomingServiceResponseOnAg(
  payload: ExternalServiceResponse,
): Promise<ProcessNuResponseResult> {
  const [request] = await agDb.select().from(leistungsanfragenTable)
    .where(eq(leistungsanfragenTable.id, payload.requestId)).limit(1);
  if (!request) throw new Error(`Inbound service response ${payload.requestId} does not exist`);
  if (request.nuOrgId !== payload.metadata.senderOrgId || request.guOrgId !== payload.metadata.receiverOrgId) {
    throw new Error("Inbound service response organisations do not match the coordination request");
  }
  if (request.leistungVersion !== payload.requestVersion) {
    throw new ResponseConflictError(String(request.leistungVersion), String(payload.requestVersion), "DIFFERENT_PAYLOAD");
  }
  const acceptedTimeWindow = payload.acceptedTimeWindow;
  const input: ProcessNuResponseInput = {
    taktRequestId: request.id,
    nuOrgId: request.nuOrgId,
    userId: request.createdByUserId,
    decision: payload.decision,
    acceptedTimeWindow,
    reasonCode: payload.reasonCode,
    comment: payload.comment,
    alternatives: payload.alternatives?.map((alternative) => ({
      alternativeId: alternative.alternativeId,
      rank: alternative.rank,
      timeWindow: alternative.timeWindow,
      crewSize: alternative.crewSize ?? undefined,
      conditions: alternative.conditions ? [alternative.conditions] : undefined,
    })),
    nextAvailableDate: payload.nextAvailableDate,
    answerableStatuses: new Set(["SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"]),
    currentRequestStatus: request.status,
    messageId: payload.metadata.messageId,
  };
  validateInput(input);
  const hash = computeResponsePayloadHash(responsePayload(payload.requestId, payload.requestVersion, input));
  // The legacy /takt-requests response endpoints persist the public response
  // before publishing its equivalent Dataspace envelope. Their historic hash
  // omits the request version and uses the legacy `taktRequestId` field.
  // Accept that exact persisted representation when the local transport
  // immediately hands the envelope back to the AG inbound processor.
  const legacyHash = computeResponsePayloadHash({
    taktRequestId: request.id,
    decision: input.decision,
    reasonCode: input.reasonCode ?? null,
    comment: input.comment ?? null,
    acceptedTimeWindow: input.acceptedTimeWindow ?? null,
    alternatives: input.alternatives?.map((alternative) => ({
      alternativeId: alternative.alternativeId,
      rank: alternative.rank,
      timeWindow: alternative.timeWindow,
      crewSize: alternative.crewSize ?? null,
      conditions: alternative.conditions?.flatMap((condition) =>
        condition.split("; ").filter(Boolean),
      ) ?? null,
    })) ?? null,
    nextAvailableDate: input.nextAvailableDate ?? null,
  });
  const [existing] = await agDb.select().from(taktResponsesTable)
    .where(eq(taktResponsesTable.taktRequestId, request.id)).limit(1);
  if (existing) {
    const alternatives = await agDb.select().from(taktResponseAlternativesTable)
      .where(eq(taktResponseAlternativesTable.responseId, existing.id))
      .orderBy(taktResponseAlternativesTable.rank);
    const incomingAlternatives = [...(payload.alternatives ?? [])]
      .sort((left, right) => left.rank - right.rank);
    const legacyEquivalent = (
      existing.decision === payload.decision &&
      existing.reasonCode === (payload.reasonCode ?? null) &&
      existing.comment === (payload.comment ?? null) &&
      existing.nextAvailableDate === (payload.nextAvailableDate ?? null) &&
      (existing.acceptedStart?.getTime() ?? null) ===
        (payload.acceptedTimeWindow ? new Date(payload.acceptedTimeWindow.start).getTime() : null) &&
      (existing.acceptedEnd?.getTime() ?? null) ===
        (payload.acceptedTimeWindow ? new Date(payload.acceptedTimeWindow.end).getTime() : null) &&
      alternatives.length === incomingAlternatives.length &&
      alternatives.every((alternative, index) => {
        const incoming = incomingAlternatives[index];
        return incoming !== undefined &&
          alternative.alternativeId === incoming.alternativeId &&
          alternative.rank === incoming.rank &&
          alternative.proposedStart.getTime() === new Date(incoming.timeWindow.start).getTime() &&
          alternative.proposedEnd.getTime() === new Date(incoming.timeWindow.end).getTime() &&
          alternative.crewSize === (incoming.crewSize ?? null) &&
          (alternative.conditions ?? []).join("; ") === (incoming.conditions ?? "");
      })
    );
    if (
      existing.responsePayloadHash !== hash &&
      existing.responsePayloadHash !== legacyHash &&
      !legacyEquivalent
    ) {
      throw new ResponseConflictError(existing.decision, payload.decision, "DIFFERENT_PAYLOAD");
    }
    return {
      response: existing,
      alternatives,
      newStatus: existing.decision === "ACCEPTED" ? "ACCEPTED" : existing.decision === "REJECTED" ? "REJECTED" : "ALTERNATIVES_PROPOSED",
      payloadHash: hash,
      idempotent: true,
    };
  }
  const nextStatus: TaktRequestStatus = payload.decision === "ACCEPTED" ? "ACCEPTED" :
    payload.decision === "ALTERNATIVES_PROPOSED" ? "ALTERNATIVES_PROPOSED" : "REJECTED";
  const saved = await agDb.transaction(async (tx) => {
    const [response] = await tx.insert(taktResponsesTable).values({
      taktRequestId: request.id,
      messageId: payload.metadata.messageId,
      decision: payload.decision,
      reasonCode: (payload.reasonCode as TaktResponse["reasonCode"]) ?? null,
      comment: payload.comment ?? null,
      acceptedStart: acceptedTimeWindow ? new Date(acceptedTimeWindow.start) : null,
      acceptedEnd: acceptedTimeWindow ? new Date(acceptedTimeWindow.end) : null,
      nextAvailableDate: payload.nextAvailableDate ?? null,
      responsePayloadHash: hash,
      createdByUserId: request.createdByUserId,
    }).returning();
    if (!response) throw new Error("Failed to apply incoming service response on AG");
    const alternatives = payload.alternatives?.length ? await tx.insert(taktResponseAlternativesTable).values(
      payload.alternatives.map((alternative) => ({
        responseId: response.id,
        alternativeId: alternative.alternativeId,
        rank: alternative.rank,
        proposedStart: new Date(alternative.timeWindow.start),
        proposedEnd: new Date(alternative.timeWindow.end),
        crewSize: alternative.crewSize ?? null,
        conditions: alternative.conditions ? [alternative.conditions] : null,
      })),
    ).returning() : [];
    await tx.update(leistungsanfragenTable).set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(leistungsanfragenTable.id, request.id));
    return { response, alternatives };
  });
  await writeAuditEvent({
    requestId: request.id,
    eventType: "RESPONSE_SUBMITTED",
    actorOrgId: payload.metadata.senderOrgId,
    actorRole: "NU",
    metadata: {
      decision: payload.decision,
      reasonCode: payload.reasonCode ?? null,
      transportMessageId: payload.metadata.messageId,
    },
  });
  await writeAuditEvent({
    requestId: request.id,
    eventType: "RESPONSE_DELIVERED",
    actorOrgId: payload.metadata.senderOrgId,
    actorRole: "NU",
    metadata: { transportMessageId: payload.metadata.messageId },
  });
  return { ...saved, newStatus: nextStatus, payloadHash: hash, idempotent: false };
}

// ── Canonical JSON (sorted keys, deterministic) ───────────────────────────────

/**
 * Produces a canonical JSON string with recursively sorted object keys.
 * PostgreSQL JSONB does not preserve insertion order; sorting makes the
 * comparison order-independent. Used for SHA-256 payload hashing.
 */
function canonicalJson(value: unknown): string {
  if (value === null)    return "null";
  if (value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number")  return String(value);
  if (typeof value === "string")  return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Computes a SHA-256 hex digest over the canonical public response payload.
 * Payload is the exact same object that will be sent to the GU's inbox —
 * no internal NU fields included.
 */
export function computeResponsePayloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateInput(input: ProcessNuResponseInput): void {
  const { decision, acceptedTimeWindow, alternatives, comment } = input;

  if (comment && comment.length > 2000) {
    throw new TaktResponseValidationError("comment must not exceed 2000 characters");
  }

  if (decision === "ACCEPTED") {
    if (!acceptedTimeWindow?.start || !acceptedTimeWindow.end) {
      throw new TaktResponseValidationError("ACCEPTED decision requires acceptedTimeWindow.{start,end}");
    }
    const s = new Date(acceptedTimeWindow.start);
    const e = new Date(acceptedTimeWindow.end);
    if (e <= s) {
      throw new TaktResponseValidationError("acceptedTimeWindow.end must be after acceptedTimeWindow.start");
    }
  }

  if (decision === "ALTERNATIVES_PROPOSED") {
    if (!alternatives || alternatives.length === 0) {
      throw new TaktResponseValidationError("ALTERNATIVES_PROPOSED requires at least one alternative");
    }
    if (alternatives.length > 3) {
      throw new TaktResponseValidationError("ALTERNATIVES_PROPOSED may have at most 3 alternatives");
    }
  }

  if (alternatives && alternatives.length > 0) {
    const seenIds = new Set<string>();
    const seenRanks = new Set<number>();
    for (const alt of alternatives) {
      if (alt.rank < 1) throw new TaktResponseValidationError(`alternative rank must be >= 1, got ${alt.rank}`);
      const s = new Date(alt.timeWindow.start);
      const e = new Date(alt.timeWindow.end);
      if (e <= s) throw new TaktResponseValidationError(`alternative ${alt.alternativeId}: timeWindow.end must be after start`);
      if (alt.crewSize !== undefined && alt.crewSize < 1) {
        throw new TaktResponseValidationError(`alternative ${alt.alternativeId}: crewSize must be >= 1`);
      }
      if (seenIds.has(alt.alternativeId)) throw new TaktResponseValidationError(`duplicate alternativeId: ${alt.alternativeId}`);
      if (seenRanks.has(alt.rank)) throw new TaktResponseValidationError(`duplicate rank: ${alt.rank}`);
      seenIds.add(alt.alternativeId);
      seenRanks.add(alt.rank);
    }
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export async function processNuResponse(
  input: ProcessNuResponseInput,
): Promise<ProcessNuResponseResult> {
  validateInput(input);

  const {
    taktRequestId, userId, decision,
    acceptedTimeWindow, reasonCode, comment, alternatives, nextAvailableDate,
    answerableStatuses, currentRequestStatus, messageId,
  } = input;

  // ── Build canonical public payload (what goes in the GU's inbox) ────────────
  const canonicalPayload: Record<string, unknown> = {
    taktRequestId,
    decision,
    reasonCode:         reasonCode          ?? null,
    comment:            comment             ?? null,
    acceptedTimeWindow: acceptedTimeWindow  ?? null,
    alternatives: alternatives?.map(a => ({
      alternativeId: a.alternativeId,
      rank:          a.rank,
      timeWindow:    a.timeWindow,
      crewSize:      a.crewSize   ?? null,
      conditions:    a.conditions ?? null,
    })) ?? null,
    nextAvailableDate: nextAvailableDate ?? null,
  };

  const payloadHash = computeResponsePayloadHash(canonicalPayload);

  // ── Idempotency / revision check against existing response ──────────────
  const existing = await getTaktResponseWithAlternatives(taktRequestId);
  if (existing) {
    if (existing.response.responsePayloadHash === payloadHash) {
      // Identical payload — idempotent return
      const newStatus: TaktRequestStatus =
        existing.response.decision === "ACCEPTED"              ? "ACCEPTED" :
        existing.response.decision === "ALTERNATIVES_PROPOSED" ? "ALTERNATIVES_PROPOSED" :
                                                                 "REJECTED";
      return {
        response:    existing.response,
        alternatives: existing.alternatives,
        newStatus,
        payloadHash,
        idempotent: true,
      };
    }

    if (currentRequestStatus !== "REVISION_REQUIRED") {
      // Normal case: conflict — NU already responded and GU has not requested revision
      const reason = existing.response.decision !== decision
        ? "DIFFERENT_DECISION" as const
        : "DIFFERENT_PAYLOAD" as const;
      throw new ResponseConflictError(existing.response.decision, decision, reason);
    }
    // REVISION_REQUIRED + different payload → the GU requested a revision and the NU is
    // now submitting a revised response. The schema intentionally keeps one current
    // response per request, so the existing row is updated below. The original
    // response remains represented by the immutable GU decision and audit events.
  } else {
    // First-time response: enforce answerable-status guard
    if (!answerableStatuses.has(currentRequestStatus)) {
      throw new ResponseStatusError(currentRequestStatus, answerableStatuses);
    }
  }

  // ── Single DB transaction: replace response + alternatives + update status ─
  const nextStatus: TaktRequestStatus =
    decision === "ACCEPTED"              ? "ACCEPTED" :
    decision === "ALTERNATIVES_PROPOSED" ? "ALTERNATIVES_PROPOSED" :
                                           "REJECTED";

  const txResult = await agDb.transaction(async (tx) => {
    const responseValues = {
      messageId,
      decision,
      reasonCode:          (reasonCode as TaktResponse["reasonCode"]) ?? null,
      comment:             comment             ?? null,
      acceptedStart:       acceptedTimeWindow  ? new Date(acceptedTimeWindow.start) : null,
      acceptedEnd:         acceptedTimeWindow  ? new Date(acceptedTimeWindow.end)   : null,
      nextAvailableDate:   nextAvailableDate   ?? null,
      responsePayloadHash: payloadHash,
      createdByUserId:     userId,
    };

    // A revision replaces the current response in place. This preserves the
    // response ID referenced by the GU's REQUEST_REVISION decision and avoids
    // violating the one-response-per-request constraint.
    const [responseRow] = existing
      ? await tx
          .update(taktResponsesTable)
          .set(responseValues)
          .where(eq(taktResponsesTable.id, existing.response.id))
          .returning()
      : await tx
          .insert(taktResponsesTable)
          .values({
            taktRequestId,
            ...responseValues,
          })
          .returning();

    if (!responseRow) throw new Error("Failed to insert TaktResponse");

    // Replace alternatives when revising; normal first responses have none to delete.
    if (existing) {
      await tx
        .delete(taktResponseAlternativesTable)
        .where(eq(taktResponseAlternativesTable.responseId, responseRow.id));
    }

    // Insert alternatives (if any)
    let alternativeRows: TaktResponseAlternativeRow[] = [];
    if (alternatives && alternatives.length > 0) {
      alternativeRows = await tx
        .insert(taktResponseAlternativesTable)
        .values(
          alternatives.map(alt => ({
            responseId:    responseRow.id,
            alternativeId: alt.alternativeId,
            rank:          alt.rank,
            proposedStart: new Date(alt.timeWindow.start),
            proposedEnd:   new Date(alt.timeWindow.end),
            crewSize:      alt.crewSize   ?? null,
            conditions:    alt.conditions ?? null,
          })),
        )
        .returning();
    }

    // Update request status inside the same transaction
    await tx
      .update(taktRequestsTable)
      .set({ status: nextStatus })
      .where(eq(taktRequestsTable.id, taktRequestId));

    return { response: responseRow, alternatives: alternativeRows };
  });

  return {
    response:    withCanonicalResponse(txResult.response),
    alternatives: txResult.alternatives,
    newStatus:   nextStatus,
    payloadHash,
    idempotent:  false,
  };
}

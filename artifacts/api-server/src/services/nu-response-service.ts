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
import { db } from "@workspace/db";
import {
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktRequestsTable,
  type TaktResponse,
  type TaktResponseAlternativeRow,
  type TaktDecision,
  type TaktRequestStatus,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { getTaktResponseWithAlternatives, TaktResponseValidationError } from "../lib/takt-response-repository";

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

  const txResult = await db.transaction(async (tx) => {
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
    response:    txResult.response,
    alternatives: txResult.alternatives,
    newStatus:   nextStatus,
    payloadHash,
    idempotent:  false,
  };
}

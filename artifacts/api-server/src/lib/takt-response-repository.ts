/**
 * Repository layer for TaktResponse and TaktResponseAlternative (Task 2.6).
 *
 * Rules:
 *   - At most ONE response per TaktRequest (UNIQUE DB constraint + pre-check).
 *   - Alternatives are created atomically within the same transaction as the response.
 *   - Max 3 alternatives enforced in the service layer here.
 *   - No internal NU data (employee names, resource IDs, other projects) may appear
 *     in any response payload.
 *   - No transport logic (no Hub messages, webhooks, or EDC).
 */
import { db } from "@workspace/db";
import {
  taktResponsesTable,
  taktResponseAlternativesTable,
  type TaktResponse,
  type InsertTaktResponse,
  type TaktResponseAlternativeRow,
  type InsertTaktResponseAlternative,
  type TaktDecision,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { withCanonicalResponse } from "./legacy-takt-mappers";

export type { TaktDecision };

export interface CreateAlternativeInput {
  alternativeId: string;
  rank: number;
  proposedStart: Date;
  proposedEnd: Date;
  crewSize?: number;
  conditions?: string[];
}

export interface CreateTaktResponseInput {
  taktRequestId: string;
  decision: TaktDecision;
  reasonCode?: string;
  comment?: string;
  acceptedStart?: Date;
  acceptedEnd?: Date;
  nextAvailableDate?: string;
  createdByUserId: string;
  alternatives?: CreateAlternativeInput[];
  /** Deterministic transport message ID for idempotency (optional). */
  messageId?: string;
}

export interface TaktResponseWithAlternatives {
  response: TaktResponse;
  alternatives: TaktResponseAlternativeRow[];
}

/** Domain error thrown when business rules are violated */
export class TaktResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaktResponseValidationError";
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateTaktResponse(input: CreateTaktResponseInput): void {
  const { decision, acceptedStart, acceptedEnd, alternatives, comment } = input;

  if (comment && comment.length > 2000) {
    throw new TaktResponseValidationError("comment must not exceed 2000 characters");
  }

  if (decision === "ACCEPTED") {
    if (!acceptedStart || !acceptedEnd) {
      throw new TaktResponseValidationError(
        "ACCEPTED decision requires both acceptedStart and acceptedEnd",
      );
    }
    if (acceptedEnd <= acceptedStart) {
      throw new TaktResponseValidationError(
        "acceptedEnd must be after acceptedStart",
      );
    }
  }

  if (decision === "ALTERNATIVES_PROPOSED") {
    if (!alternatives || alternatives.length === 0) {
      throw new TaktResponseValidationError(
        "ALTERNATIVES_PROPOSED decision requires at least one alternative",
      );
    }
    if (alternatives.length > 3) {
      throw new TaktResponseValidationError(
        "ALTERNATIVES_PROPOSED may have at most 3 alternatives",
      );
    }
  }

  if (alternatives && alternatives.length > 0) {
    const alternativeIds = new Set<string>();
    const ranks = new Set<number>();

    for (const alt of alternatives) {
      if (alt.rank < 1) {
        throw new TaktResponseValidationError(
          `alternative rank must be at least 1, got ${alt.rank}`,
        );
      }
      if (alt.proposedEnd <= alt.proposedStart) {
        throw new TaktResponseValidationError(
          `alternative ${alt.alternativeId}: proposedEnd must be after proposedStart`,
        );
      }
      if (alt.crewSize !== undefined && alt.crewSize < 1) {
        throw new TaktResponseValidationError(
          `alternative ${alt.alternativeId}: crewSize must be at least 1 if set`,
        );
      }
      if (alternativeIds.has(alt.alternativeId)) {
        throw new TaktResponseValidationError(
          `duplicate alternativeId: ${alt.alternativeId}`,
        );
      }
      if (ranks.has(alt.rank)) {
        throw new TaktResponseValidationError(
          `duplicate rank: ${alt.rank}`,
        );
      }
      alternativeIds.add(alt.alternativeId);
      ranks.add(alt.rank);
    }
  }
}

// ── TaktResponse functions ────────────────────────────────────────────────────

/**
 * Creates a TaktResponse and its alternatives atomically.
 * Validates business rules before writing.
 * Throws if a response already exists for the given TaktRequest.
 */
export async function createTaktResponse(
  input: CreateTaktResponseInput,
): Promise<TaktResponseWithAlternatives> {
  validateTaktResponse(input);

  return db.transaction(async (tx) => {
    const [response] = await tx
      .insert(taktResponsesTable)
      .values({
        id: crypto.randomUUID(),
        taktRequestId: input.taktRequestId,
        messageId: input.messageId ?? null,
        decision: input.decision,
        reasonCode: (input.reasonCode as TaktResponse["reasonCode"]) ?? null,
        comment: input.comment ?? null,
        acceptedStart: input.acceptedStart ?? null,
        acceptedEnd: input.acceptedEnd ?? null,
        nextAvailableDate: input.nextAvailableDate ?? null,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    if (!response) throw new Error("Failed to insert TaktResponse");

    const alternatives: TaktResponseAlternativeRow[] = [];
    if (input.alternatives && input.alternatives.length > 0) {
      const rows = await tx
        .insert(taktResponseAlternativesTable)
        .values(
          input.alternatives.map((alt) => ({
            id: crypto.randomUUID(),
            responseId: response.id,
            alternativeId: alt.alternativeId,
            rank: alt.rank,
            proposedStart: alt.proposedStart,
            proposedEnd: alt.proposedEnd,
            crewSize: alt.crewSize ?? null,
            conditions: alt.conditions ?? null,
          })),
        )
        .returning();
      alternatives.push(...rows);
    }

    return { response: withCanonicalResponse(response), alternatives };
  });
}

/**
 * Retrieves the TaktResponse for a given TaktRequest.
 * Returns null if no response exists yet.
 */
export async function getTaktResponseByRequestId(
  taktRequestId: string,
): Promise<TaktResponse | null> {
  const [row] = await db
    .select()
    .from(taktResponsesTable)
    .where(eq(taktResponsesTable.taktRequestId, taktRequestId))
    .limit(1);
  return row ? withCanonicalResponse(row) : null;
}

/**
 * Retrieves the TaktResponse and all its alternatives for a given TaktRequest.
 * Returns null if no response exists.
 */
export async function getTaktResponseWithAlternatives(
  taktRequestId: string,
): Promise<TaktResponseWithAlternatives | null> {
  const response = await getTaktResponseByRequestId(taktRequestId);
  if (!response) return null;

  const alternatives = await db
    .select()
    .from(taktResponseAlternativesTable)
    .where(eq(taktResponseAlternativesTable.responseId, response.id));

  return { response: withCanonicalResponse(response), alternatives };
}

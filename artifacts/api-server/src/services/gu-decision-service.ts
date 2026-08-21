/**
 * Task 6.3 / 6.4 / 6.6 — GuDecisionService
 *
 * createGuDecision(params)
 *   1. Validate GU ownership of the TaktRequest.
 *   2. Ensure a TaktResponse exists and is in a decidable state.
 *   3. Validate the decision type against the response's decision.
 *   4. For ACCEPT_ALTERNATIVE: verify the alternative belongs to the response.
 *   5. Check idempotency (key + content equality).
 *   6. Inside a transaction:
 *      a. Insert takt_response_decisions.
 *      b. Transition TaktRequest status.
 *      c. Apply takt content change (Task 6.4):
 *         - CONFIRM_ACCEPTED → applyConfirmAccepted (may or may not create new version)
 *         - ACCEPT_ALTERNATIVE → applyAcceptAlternative (always creates new version)
 *         - REQUEST_REVISION → only status change (version/round created in Task 6.5)
 *         - CLOSE_WITHOUT_AGREEMENT → only status change
 *   7. After commit: send transport message to NU (Task 6.6).
 *
 * Privacy invariants:
 *   - acceptedAlternativeId references only public alternative data.
 *   - No internal NU data is stored in takt_response_decisions.
 *   - Transport payload contains only whitelisted fields (no full Takt).
 */
import pino from "pino";
import { db } from "@workspace/db";
import {
  taktRequestsTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktResponseDecisionsTable,
  takteTable,
  resourceBookingsTable,
  availabilityChecksTable,
  taktRequestResourceRequirementsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { evaluateAvailabilityWindow } from "./availability-check-service";
import type {
  TaktResponseDecision,
  TaktCoordinationDecisionType,
  TaktRequest,
  TaktVersion,
} from "@workspace/db";
import {
  getTaktRequestById,
  TaktRequestTransitionError,
  type TaktRequestStatus,
} from "../lib/takt-request-repository";
import {
  applyConfirmAccepted,
  applyAcceptAlternative,
  VersionConflictError,
} from "./takt-version-service";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
import { DataspaceMessageType } from "@workspace/api-zod";
import {
  withCanonicalDecision,
  withCanonicalTaktRequest,
  withCanonicalVersion,
} from "../lib/legacy-takt-mappers";

const logger = pino({ name: "gu-decision-service" });
const transport = new LocalHubTransport();

// ── Domain errors ─────────────────────────────────────────────────────────────

export class GuDecisionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "GuDecisionError";
  }
}

export class GuDecisionIdempotencyConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuDecisionIdempotencyConflict";
  }
}

export { VersionConflictError };

// ── Valid decision types per NU response decision ─────────────────────────────

const VALID_DECISIONS_BY_RESPONSE: Record<
  "ACCEPTED" | "ALTERNATIVES_PROPOSED" | "REJECTED",
  readonly TaktCoordinationDecisionType[]
> = {
  ACCEPTED:              ["CONFIRM_ACCEPTED", "REQUEST_REVISION", "CLOSE_WITHOUT_AGREEMENT"],
  ALTERNATIVES_PROPOSED: ["ACCEPT_ALTERNATIVE", "REQUEST_REVISION", "CLOSE_WITHOUT_AGREEMENT"],
  REJECTED:              ["REQUEST_REVISION", "CLOSE_WITHOUT_AGREEMENT"],
};

// ── Status transitions per GU decision type ───────────────────────────────────

function targetRequestStatus(
  decisionType: TaktCoordinationDecisionType,
): TaktRequestStatus {
  switch (decisionType) {
    case "CONFIRM_ACCEPTED":       return "ACCEPTED";
    case "ACCEPT_ALTERNATIVE":     return "ACCEPTED";
    case "REQUEST_REVISION":       return "REVISION_REQUIRED";
    case "CLOSE_WITHOUT_AGREEMENT":return "CANCELLED";
  }
}

// ── Input / Output ────────────────────────────────────────────────────────────

export interface CreateGuDecisionParams {
  taktRequestId:          string;
  guOrgId:                string;
  userId:                 string;
  decisionType:           TaktCoordinationDecisionType;
  acceptedAlternativeId?: string | null;
  comment?:               string | null;
  idempotencyKey?:        string | null;
}

export interface GuDecisionResult {
  decision:       TaktResponseDecision;
  updatedRequest: TaktRequest;
  newTaktVersion: TaktVersion | null;
  /** true when the idempotency key matched an existing identical decision */
  idempotent:     boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export async function createGuDecision(
  params: CreateGuDecisionParams,
): Promise<GuDecisionResult> {
  const {
    taktRequestId, guOrgId, userId, decisionType,
    acceptedAlternativeId, comment, idempotencyKey,
  } = params;

  // ── 1. Load and authorise the TaktRequest ────────────────────────────────────
  const request = await getTaktRequestById(taktRequestId);
  if (!request) {
    throw new GuDecisionError("TaktRequest not found", 404);
  }
  if (request.guOrgId !== guOrgId) {
    throw new GuDecisionError(
      "Only the creating GU organisation may decide on this TaktRequest", 403,
    );
  }

  // ── 2. Load the TaktResponse ─────────────────────────────────────────────────
  const [responseRow] = await db
    .select()
    .from(taktResponsesTable)
    .where(eq(taktResponsesTable.taktRequestId, taktRequestId))
    .limit(1);

  if (!responseRow) {
    throw new GuDecisionError(
      "No TaktResponse exists for this TaktRequest. Cannot make a GU decision before the NU has responded.",
      400,
    );
  }

  const nuDecision = responseRow.decision as "ACCEPTED" | "ALTERNATIVES_PROPOSED" | "REJECTED";

  // ── 3. Validate decision type against NU response ────────────────────────────
  const allowedDecisions = VALID_DECISIONS_BY_RESPONSE[nuDecision];
  if (!allowedDecisions.includes(decisionType)) {
    throw new GuDecisionError(
      `Decision type "${decisionType}" is not allowed when the NU response is "${nuDecision}". ` +
        `Allowed: ${allowedDecisions.join(", ")}`,
      400,
    );
  }

  // ── 4. Validate ACCEPT_ALTERNATIVE constraints ───────────────────────────────
  // Also capture the alternative row so we can use its time window for auto-booking.
  let acceptedAltRow: typeof taktResponseAlternativesTable.$inferSelect | null = null;

  if (decisionType === "ACCEPT_ALTERNATIVE") {
    if (!acceptedAlternativeId) {
      throw new GuDecisionError(
        "acceptedAlternativeId is required for ACCEPT_ALTERNATIVE decisions", 400,
      );
    }
    const [alt] = await db
      .select()
      .from(taktResponseAlternativesTable)
      .where(
        and(
          eq(taktResponseAlternativesTable.id, acceptedAlternativeId),
          eq(taktResponseAlternativesTable.responseId, responseRow.id),
        ),
      )
      .limit(1);

    if (!alt) {
      throw new GuDecisionError(
        `Alternative "${acceptedAlternativeId}" does not exist or does not belong to the TaktResponse for this request`,
        400,
      );
    }
    acceptedAltRow = alt;
  } else if (acceptedAlternativeId) {
    throw new GuDecisionError(
      `acceptedAlternativeId must not be set for decision type "${decisionType}"`, 400,
    );
  }

  // ── 5. Check for existing decision on this response ──────────────────────────
  const [existingDecision] = await db
    .select()
    .from(taktResponseDecisionsTable)
    .where(eq(taktResponseDecisionsTable.responseId, responseRow.id))
    .limit(1);

  if (existingDecision) {
    // Idempotent retry check
    if (
      idempotencyKey &&
      existingDecision.idempotencyKey === idempotencyKey &&
      existingDecision.decisionType === decisionType &&
      existingDecision.acceptedAlternativeId === (acceptedAlternativeId ?? null) &&
      existingDecision.comment === (comment ?? null)
    ) {
      logger.info({ taktRequestId, idempotencyKey }, "Idempotent GU decision retry — returning existing");
      const updatedRequest = await getTaktRequestById(taktRequestId);
      return {
        decision: withCanonicalDecision(existingDecision),
        updatedRequest: withCanonicalTaktRequest(updatedRequest!),
        newTaktVersion: null,
        idempotent: true,
      };
    }
    if (idempotencyKey && existingDecision.idempotencyKey === idempotencyKey) {
      throw new GuDecisionIdempotencyConflict(
        `Idempotency key "${idempotencyKey}" was already used with different decision content for this GU organisation`,
      );
    }
    throw new GuDecisionError(
      `A GU decision already exists for this TaktResponse (existing type: "${existingDecision.decisionType}"). ` +
        "Decisions are immutable. Start a new coordination round to make a different decision.",
      409,
    );
  }

  // ── 6. Idempotency key uniqueness within this GU org ─────────────────────────
  if (idempotencyKey) {
    const [keyConflict] = await db
      .select()
      .from(taktResponseDecisionsTable)
      .where(
        and(
          eq(taktResponseDecisionsTable.guOrgId, guOrgId),
          eq(taktResponseDecisionsTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (keyConflict) {
      throw new GuDecisionIdempotencyConflict(
        `Idempotency key "${idempotencyKey}" was already used with different decision content for this GU organisation`,
      );
    }
  }

  // ── 7. Load current takt version for optimistic locking ─────────────────────
  const [taktRow] = await db
    .select({ version: takteTable.version, id: takteTable.id })
    .from(takteTable)
    .where(eq(takteTable.id, request.taktId))
    .limit(1);

  if (!taktRow) throw new GuDecisionError("Referenced Takt no longer exists", 404);

  const expectedTaktVersion = taktRow.version;
  const nextRequestStatus   = targetRequestStatus(decisionType);

  // ── 7b. Resolve booking time window + available resources (pre-tx) ────────────
  // For acceptance decisions we auto-create resource_bookings from the latest
  // completed availability check so the resources appear in Ressourcenbelegung
  // and Terminübersicht without any manual step by the NU.
  let bookingStart: Date | null = null;
  let bookingEnd:   Date | null = null;
  let autoBookResources: Array<{
    resourceId: string | null;
    resourceTypeId?: string;
    quantity?: number;
    utilizationPercent?: number;
    periodStart?: string | null;
    periodEnd?: string | null;
  }> = [];

  const isAcceptance =
    decisionType === "CONFIRM_ACCEPTED" || decisionType === "ACCEPT_ALTERNATIVE";

  if (isAcceptance) {
    // Determine accepted time window
    if (decisionType === "CONFIRM_ACCEPTED") {
      bookingStart = responseRow.acceptedStart ?? null;
      bookingEnd   = responseRow.acceptedEnd   ?? null;
    } else if (acceptedAltRow) {
      bookingStart = acceptedAltRow.proposedStart;
      bookingEnd   = acceptedAltRow.proposedEnd;
    }

    // Load the latest completed availability check to get concrete resource IDs
    const [dtcRequirement] = decisionType === "ACCEPT_ALTERNATIVE"
      ? await db
          .select({ id: taktRequestResourceRequirementsTable.id })
          .from(taktRequestResourceRequirementsTable)
          .where(eq(taktRequestResourceRequirementsTable.taktRequestId, taktRequestId))
          .limit(1)
      : [];
    if (bookingStart && bookingEnd && request.nuOrgId && decisionType === "ACCEPT_ALTERNATIVE" && dtcRequirement) {
      const reevaluated = await evaluateAvailabilityWindow(
        taktRequestId,
        request.nuOrgId,
        bookingStart,
        bookingEnd,
      );
      if (reevaluated.conflicts.some((conflict) => !conflict.isTentative)) {
        throw new GuDecisionError(
          "The accepted alternative is no longer feasible for all resource requirements",
          409,
        );
      }
      autoBookResources = reevaluated.availableResources.map((r) => ({
        resourceId: r.resourceId ?? null,
        ...(r.resourceTypeId ? { resourceTypeId: r.resourceTypeId } : {}),
        ...(r.quantity != null ? { quantity: r.quantity } : {}),
        utilizationPercent: r.utilizationPercent,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
      }));
    } else if (bookingStart && bookingEnd && request.nuOrgId) {
      const [latestCheck] = await db
        .select({ internalResultPayload: availabilityChecksTable.internalResultPayload })
        .from(availabilityChecksTable)
        .where(
          and(
            eq(availabilityChecksTable.taktRequestId, taktRequestId),
            eq(availabilityChecksTable.nuOrgId, request.nuOrgId),
            eq(availabilityChecksTable.status, "COMPLETED"),
          ),
        )
        .orderBy(desc(availabilityChecksTable.runNumber))
        .limit(1);

      const available = latestCheck?.internalResultPayload?.availableResources ?? [];
      autoBookResources = available.map((r) => ({
        resourceId: r.resourceId ?? null,
        ...(r.resourceTypeId ? { resourceTypeId: r.resourceTypeId } : {}),
        ...(r.quantity != null ? { quantity: r.quantity } : {}),
        ...(r.utilizationPercent != null ? { utilizationPercent: r.utilizationPercent } : {}),
        ...(r.periodStart != null ? { periodStart: r.periodStart } : {}),
        ...(r.periodEnd != null ? { periodEnd: r.periodEnd } : {}),
      }));
    }
  }

  // ── 8. Transactional write ────────────────────────────────────────────────────
  const result = await db.transaction(async (tx) => {
    // a. Insert GU decision
    const [decision] = await tx
      .insert(taktResponseDecisionsTable)
      .values({
        taktRequestId,
        responseId:             responseRow.id,
        guOrgId,
        decisionType,
        acceptedAlternativeId:  acceptedAlternativeId ?? null,
        comment:                comment ?? null,
        idempotencyKey:         idempotencyKey ?? null,
        decidedByUserId:        userId,
        decidedAt:              new Date(),
      })
      .returning();

    // b. Apply takt content change (Task 6.4)
    let newTaktVersion: TaktVersion | null = null;

    if (decisionType === "CONFIRM_ACCEPTED") {
      const r = await applyConfirmAccepted(tx, {
        taktRequestId,
        responseId:          responseRow.id,
        decisionId:          decision.id,
        guOrgId,
        userId,
        expectedTaktVersion,
      });
      newTaktVersion = r.newVersion;
    } else if (decisionType === "ACCEPT_ALTERNATIVE") {
      const r = await applyAcceptAlternative(tx, {
        taktRequestId,
        responseId:           responseRow.id,
        decisionId:           decision.id,
        acceptedAlternativeId: acceptedAlternativeId!,
        guOrgId,
        userId,
        expectedTaktVersion,
      });
      newTaktVersion = r.newVersion;
    } else if (decisionType === "REQUEST_REVISION") {
      // Status only — content change comes in Task 6.5 (revision service)
      await tx
        .update(taktRequestsTable)
        .set({ status: "REVISION_REQUIRED" })
        .where(eq(taktRequestsTable.id, taktRequestId));
    } else if (decisionType === "CLOSE_WITHOUT_AGREEMENT") {
      // Request → CANCELLED; Takt → PLANNED (not CANCELLED — only explicit GU action cancels Takt)
      await tx
        .update(takteTable)
        .set({ lifecycleStatus: "PLANNED" })
        .where(eq(takteTable.id, request.taktId));

      // Cancel any auto-created resource bookings for this TaktRequest so they
      // no longer appear as blocked capacity in Terminübersicht / Ressourcenbelegung.
      const cancelledBookings = await tx
        .update(resourceBookingsTable)
        .set({ status: "CANCELLED" })
        .where(
          and(
            eq(resourceBookingsTable.sourceType, "TAKT_REQUEST"),
            eq(resourceBookingsTable.sourceReferenceId, taktRequestId),
          ),
        )
        .returning({ id: resourceBookingsTable.id });
      if (cancelledBookings.length > 0) {
        logger.info(
          { taktRequestId, count: cancelledBookings.length },
          "Cancelled resource bookings on CLOSE_WITHOUT_AGREEMENT",
        );
      }
    }

    // c. Update TaktRequest status (for CONFIRM/ACCEPT this was already done inside apply*)
    //    For REVISION_REQUIRED we already did it above; for CANCELLED do it here.
    if (decisionType === "CLOSE_WITHOUT_AGREEMENT") {
      await tx
        .update(taktRequestsTable)
        .set({ status: "CANCELLED" })
        .where(eq(taktRequestsTable.id, taktRequestId));
    } else if (decisionType === "REQUEST_REVISION") {
      // Already updated above — nothing more to do
    } else {
      // For CONFIRM_ACCEPTED / ACCEPT_ALTERNATIVE, the applyConfirm* functions
      // already updated lifecycle_status on takte. Make sure request status = ACCEPTED.
      if (request.status !== "ACCEPTED") {
        await tx
          .update(taktRequestsTable)
          .set({
            status: "ACCEPTED",
            ...(bookingStart && bookingEnd
              ? { agreedStart: bookingStart, agreedEnd: bookingEnd }
              : {}),
          })
          .where(eq(taktRequestsTable.id, taktRequestId));
      }
    }

    // d. Auto-create resource bookings for accepted resources
    // Only for acceptance decisions where we have a time window and resources
    // from the latest availability check.
    if (
      isAcceptance &&
      bookingStart &&
      bookingEnd &&
      autoBookResources.length > 0 &&
      request.nuOrgId
    ) {
      const bookingValues = autoBookResources.map((resource) => ({
        ...(() => {
          if (!resource.periodStart || !resource.periodEnd) {
            return { startAt: bookingStart!, endAt: bookingEnd! };
          }
          const startAt = new Date(`${resource.periodStart}T00:00:00Z`);
          const endAt = new Date(`${resource.periodEnd}T00:00:00Z`);
          endAt.setUTCDate(endAt.getUTCDate() + 1);
          return { startAt, endAt };
        })(),
        nuOrgId:           request.nuOrgId as string,
        resourceId:        resource.resourceId,
        resourceTypeId:    resource.resourceTypeId ?? null,
        quantity:          resource.quantity ?? null,
        sourceType:        "TAKT_REQUEST" as const,
        sourceReferenceId: taktRequestId,
        utilizationPercent: resource.utilizationPercent ?? 100,
        status:            "CONFIRMED" as const,
      }));
      await tx.insert(resourceBookingsTable).values(bookingValues);
      logger.info(
        { taktRequestId, count: bookingValues.length },
        "Auto-created resource bookings for accepted TaktRequest",
      );
    }

    const [updatedRequest] = await tx
      .select()
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, taktRequestId))
      .limit(1);

    return {
      decision: withCanonicalDecision(decision),
      updatedRequest: withCanonicalTaktRequest(updatedRequest),
      newTaktVersion: newTaktVersion
        ? withCanonicalVersion(newTaktVersion)
        : null,
    };
  });

  logger.info(
    {
      taktRequestId, decisionType,
      decisionId:       result.decision.id,
      newRequestStatus: result.updatedRequest.status,
      newTaktVersionId: result.newTaktVersion?.id ?? null,
    },
    "GU decision created",
  );

  // ── 9. Post-commit transport message to NU (Task 6.6) ─────────────────────
  // Fire-and-forget post-commit: transport failure does NOT roll back the decision.
  try {
    await sendGuDecisionMessage({
      decision:       withCanonicalDecision(result.decision),
      request,
      newTaktVersion: result.newTaktVersion,
    });
  } catch (err) {
    // Transport failure is non-fatal — decision is already committed.
    // The outbox FAILED state allows retry later.
    logger.warn({ err, decisionId: result.decision.id }, "Transport message failed after GU decision commit");
  }

  return {
    decision:       withCanonicalDecision(result.decision),
    updatedRequest: withCanonicalTaktRequest(result.updatedRequest),
    newTaktVersion: result.newTaktVersion
      ? withCanonicalVersion(result.newTaktVersion)
      : null,
    idempotent:     false,
  };
}

// ── Transport helpers (Task 6.6) ──────────────────────────────────────────────

interface SendGuDecisionMessageParams {
  decision:       TaktResponseDecision;
  request:        TaktRequest;
  newTaktVersion: TaktVersion | null;
}

async function sendGuDecisionMessage(params: SendGuDecisionMessageParams): Promise<void> {
  const { decision, request, newTaktVersion } = params;

  // Load the current (possibly updated) takt for confirmedTimeWindow
  const [takt] = await db
    .select()
    .from(takteTable)
    .where(eq(takteTable.id, request.taktId))
    .limit(1);

  const messageId = `gu-decision-${decision.id}`;

  if (
    decision.decisionType === "CONFIRM_ACCEPTED" ||
    decision.decisionType === "ACCEPT_ALTERNATIVE"
  ) {
    // TAKT_RESPONSE_ACCEPTED
    const payload = {
      taktRequestId:        decision.taktRequestId,
      decisionType:         decision.decisionType,
      acceptedAlternativeId: decision.acceptedAlternativeId ?? null,
      confirmedTimeWindow: takt
        ? { start: takt.plannedStart, end: takt.plannedEnd }
        : null,
      taktVersion: newTaktVersion?.version ?? request.taktVersion,
      comment:     decision.comment ?? null,
    };

    await transport.send({
      messageId,
      schemaVersion: "1.0",
      messageType:   DataspaceMessageType.TAKT_RESPONSE_ACCEPTED,
      senderOrgId:   request.guOrgId,
      recipientOrgId: request.nuOrgId,
      correlationId: decision.taktRequestId,
      createdAt:     new Date(),
      causationId:   null,
      payload,
    });
  } else if (decision.decisionType === "REQUEST_REVISION") {
    // TAKT_RESPONSE_REVISION_REQUESTED
    const payload = {
      taktRequestId: decision.taktRequestId,
      decisionType:  "REQUEST_REVISION",
      comment:       decision.comment ?? null,
    };

    await transport.send({
      messageId,
      schemaVersion: "1.0",
      messageType:   DataspaceMessageType.TAKT_RESPONSE_REVISION_REQUESTED,
      senderOrgId:   request.guOrgId,
      recipientOrgId: request.nuOrgId,
      correlationId: decision.taktRequestId,
      createdAt:     new Date(),
      causationId:   null,
      payload,
    });
  } else if (decision.decisionType === "CLOSE_WITHOUT_AGREEMENT") {
    // TAKT_REQUEST_CANCELLED
    const payload = {
      taktRequestId: decision.taktRequestId,
      comment:       decision.comment ?? null,
      closedAt:      decision.decidedAt?.toISOString() ?? new Date().toISOString(),
    };

    await transport.send({
      messageId,
      schemaVersion: "1.0",
      messageType:   DataspaceMessageType.TAKT_REQUEST_CANCELLED,
      senderOrgId:   request.guOrgId,
      recipientOrgId: request.nuOrgId,
      correlationId: decision.taktRequestId,
      createdAt:     new Date(),
      causationId:   null,
      payload,
    });
  }
}

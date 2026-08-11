/**
 * HTTP routes for TaktRequest coordination.
 *
 * GU endpoints (Sprint 3):
 *   POST /takt-requests                          — create DRAFT + snapshot (Task 3.6)
 *   POST /takt-requests/:id/send                 — send via LocalHubTransport (Task 3.6)
 *
 * GU endpoints (legacy, Task 2.x):
 *   POST /projects/:projectId/takt-requests      — create DRAFT only (no snapshot)
 *   GET  /takt-requests                          — list (GU sees own, NU sees incoming)
 *
 * NU endpoints:
 *   GET  /takt-requests/:id/snapshot             — pull released Takt details
 *   POST /takt-requests/:id/response             — submit ACCEPTED / ALTERNATIVES_PROPOSED / REJECTED
 *
 * Convention: no direct DB queries in route handlers; use repository or service layer.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  takteTable,
  projectsTable,
  messageOutboxTable,
  hubMessagesTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  taktRequestResourceRequirementsTable,
  resourceTypesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { requireRole } from "../middlewares/requireRole";
import { z } from "zod";
import {
  createTaktRequestDraft,
  getTaktRequestById,
  getTaktRequestWithSnapshot,
  getTaktRequestDetailForGu,
  listTaktRequestsForGu,
  listTaktRequestsForGuEnriched,
  listTaktRequestsForNu,
  listTaktRequestsForNuEnriched,
  updateTaktRequestStatus,
  transitionToDetailsRetrievedAtomic,
  createTaktRequestSnapshot,
  TaktRequestTransitionError,
  DuplicateSnapshotError,
  type TaktRequestStatus,
} from "../lib/takt-request-repository";
import {
  createTaktRequestWithSnapshot,
  TaktNotFoundError,
  UnauthorizedSnapshotError,
  NuNotContractorError,
  InvalidTaktForSnapshotError,
} from "../lib/takt-request-snapshot-service";
import {
  getTaktResponseWithAlternatives,
  TaktResponseValidationError,
} from "../lib/takt-response-repository";
import {
  processNuResponse,
  ResponseConflictError,
  ResponseStatusError,
} from "../services/nu-response-service";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
import { IdempotencyConflictError } from "../lib/transport/transport-errors";
import {
  MalformedSchemaVersionError,
  UnsupportedSchemaVersionError,
} from "../lib/schema-version";
import { DataspaceMessageType } from "@workspace/api-zod";
import {
  runAvailabilityCheck,
  getLatestAvailabilityCheck,
  AvailabilityCheckError,
} from "../services/availability-check-service";
import {
  createGuDecision,
  GuDecisionError,
  GuDecisionIdempotencyConflict,
  VersionConflictError,
} from "../services/gu-decision-service";
import {
  createRevision,
  RevisionError,
} from "../services/revision-service";
import { writeAuditEvent, getAuditTrail } from "../lib/takt-request-audit-service";
import type { TaktCoordinationDecisionType } from "@workspace/db";

// Module-level transport singleton — stateless, safe to share across requests.
const transport = new LocalHubTransport();

/**
 * Wraps transport.send() and maps schema / idempotency errors to proper HTTP
 * responses.  Returns null when an error response has already been sent (the
 * caller must `return` immediately); returns the TransportResult on success.
 *
 * HTTP status mapping:
 *   MalformedSchemaVersionError   → 400  (missing / invalid format)
 *   UnsupportedSchemaVersionError → 422  (valid format, unsupported major)
 *   IdempotencyConflictError      → 409  (same messageId, different fields)
 */
async function safeSend(
  envelope: Parameters<(typeof transport)["send"]>[0],
  res: import("express").Response,
): Promise<Awaited<ReturnType<(typeof transport)["send"]>> | null> {
  try {
    return await transport.send(envelope);
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      res.status(409).json({ error: err.message, conflictingFields: err.conflictingFields });
      return null;
    }
    if (err instanceof UnsupportedSchemaVersionError) {
      res.status(422).json({ error: err.message });
      return null;
    }
    if (err instanceof MalformedSchemaVersionError) {
      res.status(400).json({ error: err.message });
      return null;
    }
    throw err;
  }
}

/**
 * Returns a deterministic outbox messageId for a TaktRequest notification.
 * Using the same messageId on every /send attempt means LocalHubTransport
 * will detect it as idempotent if the envelope content is identical.
 */
function notificationMessageId(requestId: string): string {
  return `taktrequest-notification-${requestId}`;
}

const router = Router();

// ── GET /takt-requests ────────────────────────────────────────────────────────
// GU sees requests where they are the guOrgId.
// NU sees requests where they are the nuOrgId.
// Role is determined by the `role` query param (gu|nu); defaults to guOrgId check.
router.get("/takt-requests", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;
  const { role, status, taktId, nuOrgId } = req.query as Record<string, string>;

  const validStatuses: TaktRequestStatus[] = [
    "DRAFT",
    "SENT",
    "DELIVERED",
    "DETAILS_RETRIEVED",
    "UNDER_REVIEW",
    "ACCEPTED",
    "ALTERNATIVES_PROPOSED",
    "REJECTED",
    "REVISION_REQUIRED",
    "CANCELLED",
    "EXPIRED",
    "SUPERSEDED",
  ];

  const statusFilter =
    status && (validStatuses as string[]).includes(status)
      ? (status as TaktRequestStatus)
      : undefined;

  if (role === "nu") {
    const requests = await listTaktRequestsForNuEnriched(orgId, {
      status: statusFilter,
    });
    res.json(requests);
    return;
  }

  // Default: GU enriched list (joins takt, project, NU org, outbox status)
  const requests = await listTaktRequestsForGuEnriched(orgId, {
    status: statusFilter,
    taktId: taktId ?? undefined,
    nuOrgId: nuOrgId ?? undefined,
  });
  res.json(requests);
});

// ── POST /projects/:projectId/takt-requests ───────────────────────────────────
// GU creates a DRAFT TaktRequest for a Takt in their project (legacy endpoint).
// Now delegates to createTaktRequestWithSnapshot() — same service as the
// canonical POST /takt-requests — so every new request has an immutable snapshot
// from creation time. requestNumber is optional; auto-generated if omitted.
router.post(
  "/projects/:projectId/takt-requests",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const userId = req.user!.userId!;

    const schema = z.object({
      taktId:              z.string().min(1),
      nuOrgId:             z.string().min(1),
      requestNumber:       z.string().min(1).optional(),
      responseRequiredBy:  z.string().datetime({ offset: true }).optional(),
      dataPublicationId:   z.string().min(1).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { taktId, nuOrgId, responseRequiredBy } = parsed.data;
    const requestNumber = parsed.data.requestNumber ?? `TKR-${Date.now().toString(36).toUpperCase()}`;

    if (responseRequiredBy) {
      const deadline = new Date(responseRequiredBy);
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      if (deadline < oneHourFromNow) {
        res.status(400).json({ error: "Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen." });
        return;
      }
    }

    let result;
    try {
      result = await createTaktRequestWithSnapshot({
        taktId,
        guOrgId,
        nuOrgId,
        requestNumber,
        responseRequiredBy: responseRequiredBy ? new Date(responseRequiredBy) : undefined,
        createdByUserId: userId,
        dataPublicationId: parsed.data.dataPublicationId,
      });
    } catch (err) {
      if (err instanceof TaktNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof UnauthorizedSnapshotError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof NuNotContractorError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidTaktForSnapshotError) {
        res.status(422).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Write REQUEST_CREATED and SNAPSHOT_CREATED audit events (legacy path)
    await writeAuditEvent({
      requestId: result.request.id,
      eventType: "REQUEST_CREATED",
      actorOrgId: guOrgId,
      actorUserId: userId,
      actorRole: "GU",
      metadata: { requestNumber: result.request.requestNumber, nuOrgId: parsed.data.nuOrgId, taktId: parsed.data.taktId },
    });
    await writeAuditEvent({
      requestId: result.request.id,
      eventType: "SNAPSHOT_CREATED",
      actorOrgId: guOrgId,
      actorUserId: userId,
      actorRole: "GU",
      metadata: { snapshotId: result.snapshot.id, taktVersion: result.request.taktVersion },
    });

    res.status(201).json({
      id:                  result.request.id,
      taktId:              result.request.taktId,
      taktVersion:         result.request.taktVersion,
      guOrgId:             result.request.guOrgId,
      nuOrgId:             result.request.nuOrgId,
      requestNumber:       result.request.requestNumber,
      status:              result.request.status,
      responseRequiredBy:  result.request.responseRequiredBy ?? null,
      snapshotId:          result.snapshot.id,
      createdAt:           result.request.createdAt,
    });
  },
);

// ── GET /takt-requests/:id (Task 5.4) ────────────────────────────────────────
// GU-only detail view: full metadata, snapshot, notification, transport, timeline, response.
// Access: the creating GU org only. Other GU / NU / hub → 403.
router.get(
  "/takt-requests/:id",
  requireJwt,
  async (req, res): Promise<void> => {
    const callerOrgId = req.user!.orgId;
    const isHubAdmin  = req.user!.hubAdmin;
    const id = req.params.id as string;

    if (isHubAdmin || !callerOrgId) {
      res.status(403).json({ error: "Hub admins may not access TaktRequest detail views." });
      return;
    }

    const detail = await getTaktRequestDetailForGu(id, callerOrgId);

    if (!detail) {
      // Either not found, or belongs to a different GU — return 404 to avoid leaking existence.
      res.status(404).json({ error: "TaktRequest not found." });
      return;
    }

    res.json(detail);
  },
);

// ── POST /takt-requests (Sprint 3) ───────────────────────────────────────────
// GU creates a TaktRequest in DRAFT status with an immutable Takt snapshot.
// Uses createTaktRequestWithSnapshot() — atomic, whitelist-scoped, validated.
// No message is sent; call /takt-requests/:id/send to deliver the notification.
router.post("/takt-requests", requireJwt, requireRole("AG_ADMIN", "GENERAL_PLANNER"), async (req, res): Promise<void> => {
  const guOrgId = req.user!.orgId!;
  const userId = req.user!.userId!;

  const bodySchema = z.object({
    taktId:              z.string().min(1),
    nuOrgId:             z.string().min(1),
    responseRequiredBy:  z.string().datetime({ offset: true }).optional(),
    subject:             z.string().max(255).optional(),
    message:             z.string().max(2000).optional(),
    dataPublicationId:   z.string().min(1).optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { taktId, nuOrgId, responseRequiredBy, subject, message } = parsed.data;

  if (responseRequiredBy) {
    const deadline = new Date(responseRequiredBy);
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (deadline < oneHourFromNow) {
      res.status(400).json({ error: "Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen." });
      return;
    }
  }

  // Generate a unique, human-readable request number.
  const requestNumber = `TKR-${Date.now().toString(36).toUpperCase()}`;

  let result;
  try {
    result = await createTaktRequestWithSnapshot({
      taktId,
      guOrgId,
      nuOrgId,
      requestNumber,
      responseRequiredBy: responseRequiredBy ? new Date(responseRequiredBy) : undefined,
      createdByUserId: userId,
      subject,
      message,
      dataPublicationId: parsed.data.dataPublicationId,
    });
  } catch (err) {
    if (err instanceof TaktNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof UnauthorizedSnapshotError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof NuNotContractorError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidTaktForSnapshotError) {
      res.status(422).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Write REQUEST_CREATED and SNAPSHOT_CREATED audit events
  await writeAuditEvent({
    requestId: result.request.id,
    eventType: "REQUEST_CREATED",
    actorOrgId: guOrgId,
    actorUserId: userId,
    actorRole: "GU",
    metadata: { requestNumber: result.request.requestNumber, nuOrgId, taktId },
  });
  await writeAuditEvent({
    requestId: result.request.id,
    eventType: "SNAPSHOT_CREATED",
    actorOrgId: guOrgId,
    actorUserId: userId,
    actorRole: "GU",
    metadata: { snapshotId: result.snapshot.id, taktVersion: result.request.taktVersion },
  });

  res.status(201).json({
    id: result.request.id,
    taktId: result.request.taktId,
    taktVersion: result.request.taktVersion,
    guOrgId: result.request.guOrgId,
    nuOrgId: result.request.nuOrgId,
    requestNumber: result.request.requestNumber,
    status: result.request.status,
    responseRequiredBy: result.request.responseRequiredBy ?? null,
    snapshotId: result.snapshot.id,
    createdAt: result.request.createdAt,
  });
});

// ── POST /takt-requests/:id/send ─────────────────────────────────────────────
// GU sends a DRAFT TaktRequest as a TaktRequestNotification via LocalHubTransport.
//
// Flow: load request → verify GU ownership → idempotency check → load snapshot
//   → build notification envelope (minimal payload, no full snapshot)
//   → transport.send() → update status DRAFT→SENT→DELIVERED → set Takt IN_COORDINATION
//
// Idempotency: the messageId is deterministic (taktrequest-notification-{requestId}).
//   Repeating /send with the same content returns the existing transport result.
//   If already DELIVERED: returns 200 immediately (no second message created).
router.post(
  "/takt-requests/:id/send",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const id = req.params.id as string;

    // ── 1. Load and validate request ownership ─────────────────────────────
    const existing = await getTaktRequestById(id);
    if (!existing) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }
    if (existing.guOrgId !== guOrgId) {
      res.status(403).json({ error: "Only the GU organisation may send this request" });
      return;
    }

    // ── 2. Idempotency: if already DELIVERED, return existing state ─────────
    if (existing.status === "DELIVERED") {
      const taktRow = await db
        .select()
        .from(takteTable)
        .where(eq(takteTable.id, existing.taktId))
        .limit(1)
        .then((r) => r[0]);

      res.status(200).json({
        requestId: existing.id,
        status: existing.status,
        sentAt: existing.sentAt ?? null,
        deliveredAt: existing.deliveredAt ?? null,
        messageId: notificationMessageId(id),
        taktLifecycleStatus: taktRow?.lifecycleStatus ?? null,
      });
      return;
    }

    // ── 3. Status guard: only DRAFT may be sent ────────────────────────────
    if (existing.status !== "DRAFT") {
      res.status(409).json({
        error: `Cannot send a TaktRequest with status "${existing.status}". Only DRAFT requests may be sent.`,
      });
      return;
    }

    // ── 4. Snapshot must exist ─────────────────────────────────────────────
    // Since Task 81, every TaktRequest created via POST /takt-requests or the
    // legacy POST /projects/:id/takt-requests gets a snapshot atomically at
    // creation time. If there is no snapshot here the request is malformed.
    const snapResult = await getTaktRequestWithSnapshot(id);
    if (!snapResult?.snapshot) {
      res.status(422).json({
        error:
          "Cannot send TaktRequest: no snapshot exists. " +
          "Create the request via POST /takt-requests which creates a snapshot atomically at creation time.",
      });
      return;
    }

    // ── 5. Validate linked data publication (only when one is set) ───────────
    // When dataPublicationId is present the publication must be PUBLISHED,
    // the correct type, belong to the same project, include the takt, and
    // have the addressed AN as a recipient.
    // Requests without a dataPublicationId are sent without a publication
    // (legacy or explicitly opted-out flows); the policy gate is enforced at
    // GET /takt-requests/:id/details instead.

    // ── 5a. Optional: validate the linked data publication ────────────────────
    // When dataPublicationId is present, the publication must be PUBLISHED,
    // the correct type, belong to the same project, include the takt, and
    // have the addressed AN as a recipient.
    // Requests without a dataPublicationId are sent as "legacy" requests;
    // the AN-access policy gate is enforced at GET /details instead.
    let pubPolicyCode: string | null = null;

    if (existing.dataPublicationId) {
      const [pub] = await db
        .select()
        .from(dataPublicationsTable)
        .where(eq(dataPublicationsTable.id, existing.dataPublicationId))
        .limit(1);

      if (!pub) {
        res.status(409).json({ error: "DATA_PUBLICATION_NOT_FOUND" });
        return;
      }
      if (pub.dataProductType !== "TAKT_INFORMATION_PACKAGE") {
        res.status(409).json({
          error: "DATA_PUBLICATION_WRONG_TYPE",
          message: "Die verknüpfte Veröffentlichung muss vom Typ TAKT_INFORMATION_PACKAGE sein.",
        });
        return;
      }
      if (pub.status !== "PUBLISHED") {
        res.status(409).json({
          error: "DATA_PUBLICATION_NOT_PUBLISHED",
          message: "Die verknüpfte Veröffentlichung muss den Status PUBLISHED haben.",
          publicationStatus: pub.status,
        });
        return;
      }
      // Check takt belongs to the publication's project (also confirms same GU)
      const [taktForPub] = await db
        .select({ projectId: takteTable.projectId })
        .from(takteTable)
        .where(eq(takteTable.id, existing.taktId))
        .limit(1);
      if (!taktForPub || pub.projectId !== taktForPub.projectId) {
        res.status(409).json({
          error: "DATA_PUBLICATION_WRONG_PROJECT",
          message: "Die Veröffentlichung gehört nicht zum Projekt dieses Takts.",
        });
        return;
      }
      // Check takt is included in the publication
      if (pub.selectedTaktIds && !pub.selectedTaktIds.includes(existing.taktId)) {
        res.status(409).json({
          error: "DATA_PUBLICATION_TAKT_NOT_INCLUDED",
          message: "Der Takt ist nicht in der Veröffentlichung enthalten.",
        });
        return;
      }
      // Check AN is a recipient of the publication
      const [pubRecipient] = await db
        .select({ id: dataPublicationRecipientsTable.id })
        .from(dataPublicationRecipientsTable)
        .where(
          and(
            eq(dataPublicationRecipientsTable.publicationId, pub.id),
            eq(dataPublicationRecipientsTable.anOrgId, existing.nuOrgId),
          ),
        )
        .limit(1);
      if (!pubRecipient) {
        res.status(409).json({
          error: "DATA_PUBLICATION_AN_NOT_RECIPIENT",
          message: "Der adressierte AN ist kein Empfänger der Veröffentlichung.",
        });
        return;
      }
      // Load policy code for notification enrichment
      const [loadedPolicy] = await db
        .select({ code: policyTemplatesTable.code })
        .from(policyTemplatesTable)
        .where(eq(policyTemplatesTable.id, pub.policyTemplateId))
        .limit(1);
      pubPolicyCode = loadedPolicy?.code ?? null;
    } // end if (existing.dataPublicationId)

    // ── 5b. Build notification payload ────────────────────────────────────────
    // Pull coordinationContext from snapshot payload if present (set via
    // POST /takt-requests using createTaktRequestWithSnapshot).
    const currentSnap = snapResult?.snapshot;
    const snapPayload = (currentSnap?.snapshotPayload as Record<string, unknown> | null) ?? {};
    const coordCtx = (snapPayload.coordinationContext as Record<string, unknown> | undefined) ?? {};

    const notificationPayload = {
      taktRequestId: id,
      projectReference: snapPayload.projectReference ?? existing.taktId,
      taktReference: existing.taktId,
      taktVersion: existing.taktVersion,
      responseRequiredBy: existing.responseRequiredBy?.toISOString() ?? null,
      detailsRef: `/takt-requests/${id}/details`,
      subject: (coordCtx.subject as string | undefined) ?? null,
      message: (coordCtx.message as string | undefined) ?? null,
      // Dataspace policy gate fields (null when no publication is linked)
      dataPublicationId: existing.dataPublicationId ?? null,
      policyCode: pubPolicyCode,
      dataOfferRef: existing.dataPublicationId
        ? `/an/data-offers/${existing.dataPublicationId}`
        : null,
    };

    // ── 6. Build MessageEnvelope and send via transport ────────────────────
    const envelope = {
      messageId: notificationMessageId(id),
      schemaVersion: "1.0",
      messageType: DataspaceMessageType.TAKT_REQUEST_NOTIFICATION,
      senderOrgId: guOrgId,
      recipientOrgId: existing.nuOrgId,
      correlationId: id,
      createdAt: new Date(),
      causationId: null,
      payload: notificationPayload,
    };

    const transportResult = await safeSend(envelope, res);
    if (!transportResult) return;

    // ── 7. Update TaktRequest status based on transport outcome ────────────
    const now = new Date();
    let finalRequest;

    if (transportResult.status === "DELIVERED") {
      // Happy path: DRAFT → SENT → DELIVERED
      try {
        await updateTaktRequestStatus(id, "SENT", { sentAt: transportResult.sentAt ?? now });
        finalRequest = await updateTaktRequestStatus(id, "DELIVERED", {
          deliveredAt: transportResult.deliveredAt ?? now,
        });
      } catch (err) {
        if (err instanceof TaktRequestTransitionError) {
          // Already advanced by a concurrent call — load current state
          finalRequest = await getTaktRequestById(id);
        } else {
          throw err;
        }
      }

      // ── 8. Set Takt lifecycle to IN_COORDINATION ───────────────────────
      await db
        .update(takteTable)
        .set({ lifecycleStatus: "IN_COORDINATION" })
        .where(eq(takteTable.id, existing.taktId));

      // ── 9. Write hub audit message ─────────────────────────────────────
      await db.insert(hubMessagesTable).values({
        type: "TAKT_REQUEST_SENT",
        senderOrgId: guOrgId,
        recipientOrgId: existing.nuOrgId,
        correlationId: id,
        payload: { taktRequestId: id, taktId: existing.taktId },
      });

      // ── 9a. Write structured audit events ─────────────────────────────
      await writeAuditEvent({
        requestId: id,
        eventType: "NOTIFICATION_SENT",
        actorOrgId: guOrgId,
        actorUserId: req.user!.userId,
        actorRole: "GU",
        metadata: { transportMessageId: transportResult.messageId },
      });
      await writeAuditEvent({
        requestId: id,
        eventType: "NOTIFICATION_DELIVERED",
        actorOrgId: guOrgId,
        actorUserId: req.user!.userId,
        actorRole: "GU",
        metadata: {
          transportMessageId: transportResult.messageId,
          deliveredAt: (transportResult.deliveredAt ?? new Date()).toISOString(),
        },
      });

      const [taktAfter] = await db
        .select()
        .from(takteTable)
        .where(eq(takteTable.id, existing.taktId))
        .limit(1);

      res.status(200).json({
        requestId: id,
        status: finalRequest?.status ?? "DELIVERED",
        sentAt: finalRequest?.sentAt ?? transportResult.sentAt,
        deliveredAt: finalRequest?.deliveredAt ?? transportResult.deliveredAt,
        messageId: transportResult.messageId,
        taktLifecycleStatus: taktAfter?.lifecycleStatus ?? "IN_COORDINATION",
      });
    } else {
      // Transport failed — advance to SENT (we attempted delivery) but not DELIVERED
      try {
        finalRequest = await updateTaktRequestStatus(id, "SENT", { sentAt: now });
      } catch (transitionErr) {
        if (!(transitionErr instanceof TaktRequestTransitionError)) throw transitionErr;
        finalRequest = existing;
      }

      res.status(502).json({
        error: `Transport delivery failed: ${transportResult.error?.message ?? "unknown error"}`,
        requestId: id,
        status: finalRequest?.status ?? "SENT",
        messageId: transportResult.messageId,
      });
    }
  },
);

// ── GET /takt-requests/:id/details ───────────────────────────────────────────
// Returns the immutable Takt snapshot released for a TaktRequest.
//
// Access:
//   - Addressed NU: may access in DELIVERED / DETAILS_RETRIEVED / UNDER_REVIEW.
//     First access (DELIVERED) transitions → DETAILS_RETRIEVED + sets detailsRetrievedAt.
//     Subsequent access is idempotent (no second transition).
//   - Creating GU: always has read access for control/preview. No status change.
//   - All others (other NU, other GU, hub admins, unauthenticated): 403.
//
// Response: { taktRequestId, requestNumber, schemaVersion, taktVersion, status,
//             guOrgId, nuOrgId, responseRequiredBy, detailsRetrievedAt,
//             snapshotPayload, createdAt }
// The snapshotPayload is the immutable whitelist-scoped copy from creation time —
// never the live Takt row.
router.get(
  "/takt-requests/:id/details",
  requireJwt,
  async (req, res): Promise<void> => {
    const callerOrgId = req.user!.orgId;
    const isHubAdmin  = req.user!.hubAdmin;
    const id = req.params.id as string;

    // ── 1. Load request + snapshot ────────────────────────────────────────
    const result = await getTaktRequestWithSnapshot(id);
    if (!result) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }
    const { request, snapshot } = result;

    // ── 2. Determine caller role ──────────────────────────────────────────
    const isAddressedNu = callerOrgId === request.nuOrgId;
    const isOwnerGu     = callerOrgId === request.guOrgId;

    if (isHubAdmin || (!isAddressedNu && !isOwnerGu)) {
      res.status(403).json({
        error:
          "Access denied. Only the addressed NU or the creating GU organisation may retrieve these details.",
      });
      return;
    }

    // ── 3. Snapshot must exist ────────────────────────────────────────────
    if (!snapshot) {
      res.status(404).json({
        error: "Snapshot is not yet available for this TaktRequest.",
      });
      return;
    }

    // ── 4. NU: enforce retrievable states ────────────────────────────────
    // GU (preview) has no state restriction — skip the checks.
    const RETRIEVABLE_STATUSES = new Set<string>([
      "DELIVERED",
      "DETAILS_RETRIEVED",
      "UNDER_REVIEW",
    ]);

    if (isAddressedNu && !RETRIEVABLE_STATUSES.has(request.status)) {
      res.status(409).json({
        error:
          `TaktRequest cannot be retrieved in status "${request.status}". ` +
          `Details are available once the request is DELIVERED.`,
        currentStatus: request.status,
      });
      return;
    }

    // ── 4b. NU: policy gate — AN must have accepted the publication policy ───
    // Only applies when the request has a linked dataPublicationId.
    // GU preview is never gated.

    // Legacy requests (no dataPublicationId) block all NU access to details.
    if (isAddressedNu && !request.dataPublicationId) {
      res.status(403).json({
        error: "LEGACY_NO_PUBLICATION",
        message:
          "Diese TaktAnfrage wurde ohne Datenraum-Veröffentlichung erstellt. " +
          "Der Auftraggeber muss zunächst Taktinformationen im Datenraum veröffentlichen.",
      });
      return;
    }

    if (isAddressedNu && request.dataPublicationId) {
      const [gatePub] = await db
        .select({ status: dataPublicationsTable.status })
        .from(dataPublicationsTable)
        .where(eq(dataPublicationsTable.id, request.dataPublicationId))
        .limit(1);

      // Publication has been suspended or withdrawn after sending
      if (
        !gatePub ||
        gatePub.status === "SUSPENDED" ||
        gatePub.status === "WITHDRAWN" ||
        gatePub.status === "EXPIRED"
      ) {
        res.status(403).json({
          error: "DATA_PUBLICATION_INACTIVE",
          message: "Die zugehörige Datenveröffentlichung ist nicht mehr aktiv.",
          publicationStatus: gatePub?.status ?? "NOT_FOUND",
          dataPublicationId: request.dataPublicationId,
          dataOfferRef: `/an/data-offers/${request.dataPublicationId}`,
        });
        return;
      }

      // Check that this AN has accepted the policy
      const [gateRecipient] = await db
        .select({
          status:           dataPublicationRecipientsTable.status,
          policyAcceptedAt: dataPublicationRecipientsTable.policyAcceptedAt,
        })
        .from(dataPublicationRecipientsTable)
        .where(
          and(
            eq(dataPublicationRecipientsTable.publicationId, request.dataPublicationId),
            eq(dataPublicationRecipientsTable.anOrgId, callerOrgId!),
          ),
        )
        .limit(1);

      if (
        !gateRecipient ||
        gateRecipient.status !== "ACCEPTED" ||
        !gateRecipient.policyAcceptedAt
      ) {
        res.status(403).json({
          error: "POLICY_ACCEPTANCE_REQUIRED",
          message: "Bitte akzeptieren Sie zunächst die Nutzungs-Policy.",
          dataPublicationId: request.dataPublicationId,
          dataOfferRef: `/an/data-offers/${request.dataPublicationId}`,
          recipientStatus: gateRecipient?.status ?? "OFFERED",
        });
        return;
      }
    }

    // ── 5. First NU access: atomic DELIVERED → DETAILS_RETRIEVED ────────────
    // transitionToDetailsRetrievedAtomic uses a single conditional UPDATE
    // (WHERE status='DELIVERED') so only one concurrent caller can win.
    // The returned row is non-null only for the winner; concurrent callers
    // get null and must NOT write the audit event.
    let updatedRequest = request;
    let firstAccessTransitionSucceeded = false;
    if (isAddressedNu && request.status === "DELIVERED") {
      const transitioned = await transitionToDetailsRetrievedAtomic(id, new Date());
      if (transitioned) {
        updatedRequest = transitioned;
        firstAccessTransitionSucceeded = true;
      } else {
        // Another concurrent call won the race — reload current state.
        updatedRequest = (await getTaktRequestWithSnapshot(id))?.request ?? request;
      }
    }

    // ── 6. Audit log ────────────────────────────────────────────────────────
    // detailsRetrievedAt on the request row is the durable timestamp.
    // Structured log + DB audit event are the queryable complement.
    req.log.info(
      {
        requestId: id,
        callerOrgId,
        callerUserId: req.user!.userId,
        role: isAddressedNu ? "NU" : "GU",
        requestStatus: updatedRequest.status,
        firstAccess: firstAccessTransitionSucceeded,
      },
      "takt-request details retrieved",
    );

    // Persist to structured audit trail only when THIS call won the race for
    // the DELIVERED → DETAILS_RETRIEVED transition.  Concurrent losers and
    // all subsequent re-reads do NOT write a second event.
    // GU preview accesses are never recorded as coordination events.
    if (firstAccessTransitionSucceeded) {
      await writeAuditEvent({
        requestId: id,
        eventType: "DETAILS_RETRIEVED",
        actorOrgId: callerOrgId ?? null,
        actorUserId: req.user!.userId,
        actorRole: "NU",
        metadata: {
          firstAccess: true,
          requestStatusBefore: "DELIVERED",
          requestStatusAfter: updatedRequest.status,
        },
      });
    }

    // ── 7. Build response — snapshot payload, never live Takt data ────────
    res.json({
      taktRequestId: id,
      requestNumber: updatedRequest.requestNumber,
      schemaVersion: snapshot.schemaVersion,
      taktVersion: updatedRequest.taktVersion,
      status: updatedRequest.status,
      guOrgId: updatedRequest.guOrgId,
      nuOrgId: updatedRequest.nuOrgId,
      responseRequiredBy: updatedRequest.responseRequiredBy?.toISOString() ?? null,
      detailsRetrievedAt: updatedRequest.detailsRetrievedAt?.toISOString() ?? null,
      snapshotPayload: snapshot.snapshotPayload,
      createdAt: snapshot.createdAt.toISOString(),
    });
  },
);

// ── GET /takt-requests/:id/snapshot ─────────────────────────────────────────
// NU pulls the released Takt details.
// Transitions DELIVERED → DETAILS_RETRIEVED (idempotent if already past DELIVERED).
router.get(
  "/takt-requests/:id/snapshot",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const id = req.params.id as string;

    const result = await getTaktRequestWithSnapshot(id);
    if (!result) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }

    const { request, snapshot } = result;
    if (request.nuOrgId !== nuOrgId) {
      res
        .status(403)
        .json({ error: "Only the addressed NU organisation may pull this snapshot" });
      return;
    }

    if (!snapshot) {
      res.status(404).json({ error: "Snapshot not yet available" });
      return;
    }

    // Advance to DETAILS_RETRIEVED atomically (WHERE status='DELIVERED').
    // Only the winning caller (non-null return) writes the audit event.
    let snapshotTransitionSucceeded = false;
    if (request.status === "DELIVERED") {
      const transitioned = await transitionToDetailsRetrievedAtomic(id, new Date());
      snapshotTransitionSucceeded = transitioned !== null;
    }

    // Write audit event only when THIS call successfully performed the transition.
    if (snapshotTransitionSucceeded) {
      await writeAuditEvent({
        requestId: id,
        eventType: "DETAILS_RETRIEVED",
        actorOrgId: nuOrgId,
        actorRole: "NU",
        metadata: { firstAccess: true, requestStatusBefore: "DELIVERED" },
      });
    }

    res.json({ request, snapshot });
  },
);

// ── POST /takt-requests/:id/response ─────────────────────────────────────────
// Legacy NU response endpoint — kept for backward compatibility.
// Translates the old flat acceptedStart/acceptedEnd fields to the canonical
// acceptedTimeWindow format, then delegates to processNuResponse() — the same
// service used by the canonical POST /takt-requests/:id/responses endpoint.
// Both endpoints are now fully unified at the service layer.
router.post(
  "/takt-requests/:id/response",
  requireJwt,
  requireRole("AN_ADMIN", "AN_DISPATCHER"),
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const userId  = req.user!.userId!;
    const id      = req.params.id as string;

    // ── 1. NU-only guard ────────────────────────────────────────────────────
    if (!nuOrgId || req.user!.orgType !== "AN" || req.user!.hubAdmin) {
      res.status(403).json({ error: "Only NU (AN) organisations may submit a TaktResponse" });
      return;
    }

    // ── 2. Parse body (legacy flat format) ──────────────────────────────────
    const alternativeSchema = z.object({
      alternativeId: z.string().min(1),
      rank:          z.number().int().min(1),
      proposedStart: z.string().datetime({ offset: true }),
      proposedEnd:   z.string().datetime({ offset: true }),
      crewSize:      z.number().int().min(1).optional(),
      conditions:    z.array(z.string()).optional(),
    });

    const schema = z.object({
      decision:          z.enum(["ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED"]),
      reasonCode:        z.enum(["RESOURCE_CONFLICT","NO_CAPACITY","EQUIPMENT_UNAVAILABLE",
                                 "QUALIFICATION_MISSING","TIME_WINDOW_TOO_SHORT",
                                 "OUTSIDE_PLANNING_HORIZON","OTHER"]).optional(),
      comment:           z.string().max(2000).optional(),
      acceptedStart:     z.string().datetime({ offset: true }).optional(),
      acceptedEnd:       z.string().datetime({ offset: true }).optional(),
      nextAvailableDate: z.string().optional(),
      alternatives:      z.array(alternativeSchema).max(3).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // ── 3. Load TaktRequest ─────────────────────────────────────────────────
    const request = await getTaktRequestById(id);
    if (!request) { res.status(404).json({ error: "TaktRequest not found" }); return; }
    if (request.nuOrgId !== nuOrgId) {
      res.status(403).json({ error: "Only the addressed NU organisation may respond" });
      return;
    }

    // ── 4. Translate flat → canonical format ────────────────────────────────
    const { decision, reasonCode, comment, acceptedStart, acceptedEnd,
            nextAvailableDate, alternatives } = parsed.data;

    const acceptedTimeWindow = acceptedStart && acceptedEnd
      ? { start: acceptedStart, end: acceptedEnd }
      : undefined;

    const canonicalAlternatives = alternatives?.map(alt => ({
      alternativeId: alt.alternativeId,
      rank:          alt.rank,
      timeWindow:    { start: alt.proposedStart, end: alt.proposedEnd },
      crewSize:      alt.crewSize,
      conditions:    alt.conditions,
    }));

    // ── 5. Call unified service ─────────────────────────────────────────────
    const msgId = `taktresponse-${id}`;
    let result;
    try {
      result = await processNuResponse({
        taktRequestId:        id,
        nuOrgId,
        userId,
        decision,
        acceptedTimeWindow,
        reasonCode,
        comment,
        alternatives:         canonicalAlternatives,
        nextAvailableDate,
        answerableStatuses:   new Set(["UNDER_REVIEW", "DETAILS_RETRIEVED"]),
        currentRequestStatus: request.status,
        messageId:            msgId,
      });
    } catch (err) {
      if (err instanceof TaktResponseValidationError) {
        res.status(422).json({ error: err.message }); return;
      }
      if (err instanceof ResponseConflictError) {
        res.status(409).json({ error: err.message }); return;
      }
      if (err instanceof ResponseStatusError) {
        res.status(409).json({ error: err.message }); return;
      }
      throw err;
    }

    // ── 6. Idempotent: return existing without re-sending ───────────────────
    if (result.idempotent) {
      const [existingOutbox] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, msgId)).limit(1);
      res.status(200).json({
        id:               result.response.id,
        taktRequestId:    id,
        decision:         result.response.decision,
        requestStatus:    result.response.decision === "ACCEPTED" ? "ACCEPTED"
                        : result.response.decision === "ALTERNATIVES_PROPOSED" ? "ALTERNATIVES_PROPOSED"
                        : "REJECTED",
        transportStatus:  existingOutbox?.status ?? "UNKNOWN",
      });
      return;
    }

    // ── 7. Send to GU inbox via transport ────────────────────────────────────
    const guPayload = buildGuPayload(
      id, decision, reasonCode, comment, acceptedTimeWindow, canonicalAlternatives, nextAvailableDate,
    );
    const envelope = {
      messageId:     msgId,
      schemaVersion: "1.0",
      messageType:   DataspaceMessageType.TAKT_RESPONSE_SUBMITTED,
      senderOrgId:   nuOrgId,
      recipientOrgId: request.guOrgId,
      correlationId: id,
      createdAt:     new Date(),
      causationId:   null,
      payload:       guPayload,
    };
    const transportResult = await safeSend(envelope, res);
    if (!transportResult) return;

    res.status(201).json({
      id:              result.response.id,
      taktRequestId:   id,
      decision:        result.response.decision,
      reasonCode:      result.response.reasonCode ?? null,
      comment:         result.response.comment    ?? null,
      requestStatus:   result.newStatus,
      transportStatus: transportResult.status,
    });
  },
);

// ── POST /takt-requests/:id/availability-checks ──────────────────────────────
// NU triggers a feasibility check. Only the addressed NU may call this.
//
// Flow: validate NU access → call runAvailabilityCheck() service →
//   return full NU-visible result (internalResult + publicResult).
//
// Status transition (inside service): DETAILS_RETRIEVED → UNDER_REVIEW (first run).
// Subsequent runs from UNDER_REVIEW are allowed (produces a new history row).
//
// Permissions: NU (AN) only, must be the addressed NU. GU, Hub → 403.
router.post(
  "/takt-requests/:id/availability-checks",
  requireJwt,
  requireRole("AN_ADMIN", "AN_DISPATCHER"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const id = req.params.id as string;

    // ── 1. NU-only guard ──────────────────────────────────────────────────────
    if (!user.orgId || user.orgType !== "AN" || user.hubAdmin) {
      res.status(403).json({ error: "Only NU (AN) organisations may run availability checks" });
      return;
    }
    const nuOrgId = user.orgId;
    const userId  = user.userId!;

    try {
      const check = await runAvailabilityCheck(id, nuOrgId, userId);
      res.status(201).json(formatCheckResponse(check));
    } catch (err) {
      if (err instanceof AvailabilityCheckError) {
        const status =
          err.code === "REQUEST_NOT_FOUND"  ? 404 :
          err.code === "SNAPSHOT_MISSING"   ? 404 :
          err.code === "WRONG_NU_ORG"       ? 403 :
          err.code === "INVALID_STATUS"     ? 409 :
          err.code === "INVALID_TIME_WINDOW"? 422 : 400;
        res.status(status).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);

// ── GET /takt-requests/:id/availability-checks/latest ────────────────────────
// Returns the latest availability check for this TaktRequest.
//
// "Latest" strategy: prefer the COMPLETED check with the highest runNumber;
// fall back to the most recent check of any status if no COMPLETED exists.
//
// Only the addressed NU may retrieve checks (privacy — internalResult included).
// GU, Hub → 403.
router.get(
  "/takt-requests/:id/availability-checks/latest",
  requireJwt,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const id = req.params.id as string;

    // ── 1. NU-only guard ──────────────────────────────────────────────────────
    if (!user.orgId || user.orgType !== "AN" || user.hubAdmin) {
      res.status(403).json({ error: "Only NU (AN) organisations may access availability checks" });
      return;
    }
    const nuOrgId = user.orgId;

    // ── 2. Load request to verify NU addressing ───────────────────────────────
    const request = await getTaktRequestById(id);
    if (!request) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }
    if (request.nuOrgId !== nuOrgId) {
      res.status(403).json({ error: "Only the addressed NU organisation may access these checks" });
      return;
    }

    // ── 3. Return latest check ────────────────────────────────────────────────
    const check = await getLatestAvailabilityCheck(id, nuOrgId);
    if (!check) {
      res.status(404).json({ error: "No availability checks found for this TaktRequest" });
      return;
    }

    res.json(formatCheckResponse(check));
  },
);

// ── POST /takt-requests/:id/responses ────────────────────────────────────────
// NU creates a business response (ACCEPTED / ALTERNATIVES_PROPOSED / REJECTED)
// and delivers it to the GU's inbox via LocalHubTransport.
//
// This is the canonical response endpoint. Both this endpoint and the legacy
// /response endpoint now delegate to processNuResponse() — all business logic
// (validation, hash-based idempotency, atomic transaction) is in the service.
//
// Request body (canonical schema v1.0):
//   { decision, acceptedTimeWindow?.{start,end}, reasonCode?, comment?,
//     alternatives?: [{alternativeId, rank, timeWindow.{start,end}, crewSize?, conditions?}],
//     nextAvailableDate? }
//
// Idempotency (SHA-256 payload hash):
//   - Same request + identical payload → 200 with existing response (no duplicate row)
//   - Same request + different payload (any field) → 409
//
// Transaction: response insert + alternatives insert + request status update
//   all succeed or all roll back; transport.send() runs after commit.
//
// Permissions: NU (AN), addressed NU only. GU, Hub → 403.
router.post(
  "/takt-requests/:id/responses",
  requireJwt,
  requireRole("AN_ADMIN", "AN_DISPATCHER"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const id   = req.params.id as string;

    // ── 1. NU-only guard ──────────────────────────────────────────────────────
    if (!user.orgId || user.orgType !== "AN" || user.hubAdmin) {
      res.status(403).json({ error: "Only NU (AN) organisations may submit a TaktResponse" });
      return;
    }
    const nuOrgId = user.orgId;
    const userId  = user.userId!;

    // ── 2. Privacy filter (allowlist — run before Zod to give clear errors) ───
    const privacyError = checkResponsePrivacy(req.body);
    if (privacyError) {
      res.status(400).json({ error: privacyError });
      return;
    }

    // ── 3. Parse + validate canonical schema ──────────────────────────────────
    const alternativeSchema = z.object({
      alternativeId: z.string().min(1),
      rank:          z.number().int().min(1),
      timeWindow:    z.object({ start: z.string().min(1), end: z.string().min(1) }),
      crewSize:      z.number().int().min(1).optional(),
      conditions:    z.array(z.string()).optional(),
    });

    const bodySchema = z.object({
      decision:          z.enum(["ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED"]),
      acceptedTimeWindow: z.object({ start: z.string().min(1), end: z.string().min(1) }).optional(),
      reasonCode:        z.enum(["RESOURCE_CONFLICT","NO_CAPACITY","EQUIPMENT_UNAVAILABLE",
                                  "QUALIFICATION_MISSING","TIME_WINDOW_TOO_SHORT",
                                  "OUTSIDE_PLANNING_HORIZON","OTHER"]).optional(),
      comment:           z.string().max(2000).optional(),
      alternatives:      z.array(alternativeSchema).max(3).optional(),
      nextAvailableDate: z.string().optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { decision, acceptedTimeWindow, reasonCode, comment, alternatives, nextAvailableDate } =
      parsed.data;

    // ── 4. Load TaktRequest ────────────────────────────────────────────────────
    const request = await getTaktRequestById(id);
    if (!request) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }
    if (request.nuOrgId !== nuOrgId) {
      res.status(403).json({ error: "Only the addressed NU organisation may respond" });
      return;
    }

    // ── 5. Call unified service (idempotency + transaction + status update) ───
    const ANSWERABLE_STATUSES = new Set(["UNDER_REVIEW", "DETAILS_RETRIEVED"]);
    const msgId = `taktresponse-${id}`;

    let result;
    try {
      result = await processNuResponse({
        taktRequestId:        id,
        nuOrgId,
        userId,
        decision,
        acceptedTimeWindow,
        reasonCode,
        comment,
        alternatives,
        nextAvailableDate,
        answerableStatuses:   ANSWERABLE_STATUSES,
        currentRequestStatus: request.status,
        messageId:            msgId,
      });
    } catch (err) {
      if (err instanceof TaktResponseValidationError) {
        res.status(422).json({ error: err.message }); return;
      }
      if (err instanceof ResponseConflictError) {
        res.status(409).json({ error: err.message }); return;
      }
      if (err instanceof ResponseStatusError) {
        res.status(409).json({ error: err.message, currentStatus: request.status }); return;
      }
      throw err;
    }

    // ── 6. Idempotent: return existing without re-sending ────────────────────
    if (result.idempotent) {
      const [existingOutbox] = await db
        .select()
        .from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, msgId))
        .limit(1);

      res.status(200).json({
        responseId:        result.response.id,
        taktRequestId:     id,
        decision:          result.response.decision,
        reasonCode:        result.response.reasonCode ?? null,
        comment:           result.response.comment    ?? null,
        acceptedTimeWindow: result.response.acceptedStart
          ? { start: result.response.acceptedStart.toISOString(), end: result.response.acceptedEnd!.toISOString() }
          : null,
        alternatives: result.alternatives.map(a => ({
          alternativeId: a.alternativeId,
          rank:          a.rank,
          timeWindow:    { start: a.proposedStart.toISOString(), end: a.proposedEnd.toISOString() },
          crewSize:      a.crewSize   ?? null,
          conditions:    a.conditions ?? null,
        })),
        nextAvailableDate:   result.response.nextAvailableDate ?? null,
        // Report actual outbox status — never silently say DELIVERED when unknown
        transportStatus:     existingOutbox?.status ?? "UNKNOWN",
        transportMessageId:  existingOutbox?.messageId ?? msgId,
        requestStatus:       result.newStatus,
        createdAt:           result.response.createdAt.toISOString(),
      });
      return;
    }

    // ── 7. Send TaktResponseMessage to GU inbox ────────────────────────────────
    const guPayload = buildGuPayload(
      id, decision, reasonCode, comment, acceptedTimeWindow, alternatives, nextAvailableDate,
    );
    const envelope = {
      messageId:      msgId,
      schemaVersion:  "1.0",
      messageType:    DataspaceMessageType.TAKT_RESPONSE_SUBMITTED,
      senderOrgId:    nuOrgId,
      recipientOrgId: request.guOrgId,
      correlationId:  id,
      createdAt:      new Date(),
      causationId:    null,
      payload:        guPayload,
    };

    const transportResult = await safeSend(envelope, res);
    if (!transportResult) return;

    // ── 8. Write audit events ─────────────────────────────────────────────────
    await writeAuditEvent({
      requestId: id, eventType: "RESPONSE_SUBMITTED",
      actorOrgId: nuOrgId, actorUserId: userId, actorRole: "NU",
      metadata: { decision, reasonCode: reasonCode ?? null,
                  transportMessageId: transportResult.messageId,
                  transportStatus: transportResult.status },
    });
    if (transportResult.status === "DELIVERED") {
      await writeAuditEvent({
        requestId: id, eventType: "RESPONSE_DELIVERED",
        actorOrgId: nuOrgId, actorUserId: userId, actorRole: "NU",
        metadata: { transportMessageId: transportResult.messageId },
      });
    }

    res.status(201).json({
      responseId:         result.response.id,
      taktRequestId:      id,
      decision:           result.response.decision,
      reasonCode:         result.response.reasonCode ?? null,
      comment:            result.response.comment    ?? null,
      acceptedTimeWindow: result.response.acceptedStart
        ? { start: result.response.acceptedStart.toISOString(), end: result.response.acceptedEnd!.toISOString() }
        : null,
      alternatives: result.alternatives.map(a => ({
        alternativeId: a.alternativeId,
        rank:          a.rank,
        timeWindow:    { start: a.proposedStart.toISOString(), end: a.proposedEnd.toISOString() },
        crewSize:      a.crewSize   ?? null,
        conditions:    a.conditions ?? null,
      })),
      nextAvailableDate:   result.response.nextAvailableDate ?? null,
      transportStatus:     transportResult.status,
      transportMessageId:  transportResult.messageId,
      requestStatus:       result.newStatus,
      createdAt:           result.response.createdAt.toISOString(),
    });
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Formats a check row for NU-facing API responses (includes both internal + public results). */
function formatCheckResponse(check: import("@workspace/db").AvailabilityCheck) {
  return {
    checkId:        check.id,
    status:         check.status,
    result:         check.result,
    runNumber:      check.runNumber,
    internalResult: check.internalResultPayload,
    publicResult:   check.publicResultPayload,
    checkedAt:      check.checkedAt?.toISOString() ?? null,
    createdAt:      check.createdAt.toISOString(),
  };
}

/** Strict privacy filter for the new /responses endpoint body.
 *  Returns an error string on failure, null on pass. */
const FORBIDDEN_RESPONSE_FIELDS = new Set([
  "localProjectId", "localProjectCode", "customerAlias", "customerName",
  "resourceId", "resourceName", "employeeId", "employeeName",
  "internalCost", "internalPriority", "internalConflicts", "conflicts",
  "internalResultPayload", "availabilityCheckId",
]);
const ALLOWED_RESPONSE_FIELDS = new Set([
  "decision", "acceptedTimeWindow", "reasonCode", "comment",
  "alternatives", "nextAvailableDate",
]);

function checkResponsePrivacy(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (FORBIDDEN_RESPONSE_FIELDS.has(key)) {
      return `Forbidden field in response body: "${key}". Internal NU data must not be included.`;
    }
    if (!ALLOWED_RESPONSE_FIELDS.has(key)) {
      return `Unknown field not permitted in response body: "${key}". Allowed: ${[...ALLOWED_RESPONSE_FIELDS].join(", ")}.`;
    }
  }
  return null;
}

/** Builds the GU-facing message payload — public fields only, no internal NU data. */
function buildGuPayload(
  taktRequestId: string,
  decision: string,
  reasonCode?: string,
  comment?: string,
  acceptedTimeWindow?: { start: string; end: string },
  alternatives?: Array<{ alternativeId: string; rank: number; timeWindow: { start: string; end: string }; crewSize?: number; conditions?: string[] }>,
  nextAvailableDate?: string,
): Record<string, unknown> {
  return {
    taktRequestId,
    decision,
    reasonCode:         reasonCode         ?? null,
    comment:            comment            ?? null,
    acceptedTimeWindow: acceptedTimeWindow ?? null,
    alternatives: alternatives?.map(a => ({
      alternativeId: a.alternativeId,
      rank:          a.rank,
      timeWindow:    a.timeWindow,
      crewSize:      a.crewSize ?? null,
      conditions:    a.conditions ?? null,
    })) ?? null,
    nextAvailableDate: nextAvailableDate ?? null,
  };
}

// ── POST /takt-requests/:id/gu-decisions ─────────────────────────────────────
// GU creates a business decision on a TaktResponse.
//
// Decision types:
//   CONFIRM_ACCEPTED       — confirm the NU's accepted time window
//   ACCEPT_ALTERNATIVE     — select one of the NU's proposed alternatives
//   REQUEST_REVISION       — request a revised coordination round
//   CLOSE_WITHOUT_AGREEMENT— close this round without an agreement
//
// Permissions:
//   - GU (AG) only — the GU organisation that created the TaktRequest.
//   - NU (AN) → 403. Hub → 403.
//
// Idempotency:
//   - Optional Idempotency-Key header. Same key + same content → 200 (existing).
//   - Same key + different content → 409.
//   - Second decision for the same Response → 409.
//
// Transactions:
//   - Decision insert + Request status update are atomic.
//   - Takt lifecycle_status updated within the same transaction.
router.post(
  "/takt-requests/:id/gu-decisions",
  requireJwt,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const id   = req.params.id as string;

    // ── 1. GU-only guard ──────────────────────────────────────────────────────
    if (user.hubAdmin || !user.orgId) {
      res.status(403).json({ error: "Hub admins may not create GU decisions" });
      return;
    }
    if (user.orgType !== "AG") {
      res.status(403).json({ error: "Only GU (AG) organisations may create GU decisions" });
      return;
    }

    const guOrgId = user.orgId;
    const userId  = user.userId!;

    // ── 2. Parse + validate body ──────────────────────────────────────────────
    const bodySchema = z.object({
      decisionType: z.enum([
        "CONFIRM_ACCEPTED",
        "ACCEPT_ALTERNATIVE",
        "REQUEST_REVISION",
        "CLOSE_WITHOUT_AGREEMENT",
      ]),
      acceptedAlternativeId: z.string().min(1).optional(),
      comment:               z.string().max(2000).optional(),
      idempotencyKey:        z.string().min(1).max(255).optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { decisionType, acceptedAlternativeId, comment, idempotencyKey } = parsed.data;

    // ── 3. Optionally read Idempotency-Key from header ────────────────────────
    const idempotencyKeyFinal =
      idempotencyKey ??
      (req.headers["idempotency-key"] as string | undefined) ??
      null;

    // ── 4. Delegate to service ────────────────────────────────────────────────
    try {
      const result = await createGuDecision({
        taktRequestId: id,
        guOrgId,
        userId,
        decisionType: decisionType as TaktCoordinationDecisionType,
        acceptedAlternativeId: acceptedAlternativeId ?? null,
        comment: comment ?? null,
        idempotencyKey: idempotencyKeyFinal,
      });

      const { decision, updatedRequest, newTaktVersion, idempotent } = result;

      // Write hub audit message (skip for idempotent replays)
      if (!idempotent) {
        const guDecisionHubType =
          decisionType === "CONFIRM_ACCEPTED"     ? "TAKT_REQUEST_CONFIRMED"
          : decisionType === "ACCEPT_ALTERNATIVE" ? "TAKT_REQUEST_ALT_ACCEPTED"
          : decisionType === "CLOSE_WITHOUT_AGREEMENT" ? "TAKT_REQUEST_CLOSED"
          : null; // REQUEST_REVISION — no hub message needed (new round will have its own SENT)
        if (guDecisionHubType) {
          const taktReq = await getTaktRequestById(id);
          if (taktReq) {
            await db.insert(hubMessagesTable).values({
              type: guDecisionHubType as any,
              senderOrgId: guOrgId,
              recipientOrgId: taktReq.nuOrgId,
              correlationId: id,
              payload: { taktRequestId: id, decisionType, comment: comment ?? null },
            });
          }
        }

        // Write structured audit event
        await writeAuditEvent({
          requestId: id,
          eventType: "GU_DECISION_MADE",
          actorOrgId: guOrgId,
          actorUserId: userId,
          actorRole: "GU",
          metadata: {
            decisionType,
            acceptedAlternativeId: acceptedAlternativeId ?? null,
            updatedRequestStatus: updatedRequest.status,
          },
        });
      }

      res.status(idempotent ? 200 : 201).json({
        decisionId:              decision.id,
        taktRequestId:           decision.taktRequestId,
        responseId:              decision.responseId,
        decisionType:            decision.decisionType,
        acceptedAlternativeId:   decision.acceptedAlternativeId ?? null,
        comment:                 decision.comment ?? null,
        decidedAt:               decision.decidedAt,
        createdAt:               decision.createdAt,
        updatedRequestStatus:    updatedRequest.status,
        newTaktVersion:          newTaktVersion?.version ?? null,
        newTaktVersionId:        newTaktVersion?.id      ?? null,
        idempotent,
      });
    } catch (err) {
      if (err instanceof GuDecisionError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      if (err instanceof GuDecisionIdempotencyConflict) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof VersionConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof TaktRequestTransitionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// ── POST /takt-requests/:id/revisions ────────────────────────────────────────
// GU starts a new coordination round after a REQUEST_REVISION decision.
//
// Flow: validate preconditions → transaction: new takt_version + new TaktRequest +
//   new snapshot + old request → SUPERSEDED → optional TAKT_REQUEST_REVISED transport
//
// Idempotency: supersedesRequestId is unique → a duplicate request returns 409.
router.post(
  "/takt-requests/:id/revisions",
  requireJwt,
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const userId  = req.user!.userId!;
    const id      = req.params.id as string;

    const bodySchema = z.object({
      plannedTimeWindow: z.object({
        start: z.string().min(1),
        end:   z.string().min(1),
      }),
      responseRequiredBy: z.string().optional().nullable(),
      subject:            z.string().optional().nullable(),
      message:            z.string().optional().nullable(),
      sendImmediately:    z.boolean().optional().default(false),
      idempotencyKey:     z.string().optional().nullable(),
      taktUpdates: z
        .object({
          taktBezeichnung:   z.string().optional(),
          zone:              z.string().optional(),
          gewerk:            z.string().optional(),
          description:       z.string().optional(),
          earliestStart:     z.string().optional(),
          latestEnd:         z.string().optional(),
          lvReference:       z.string().optional(),
          bimReference:      z.string().optional(),
          requiredResources: z.string().optional(),
        })
        .optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const { plannedTimeWindow, responseRequiredBy, subject, message, sendImmediately, idempotencyKey, taktUpdates } =
      parsed.data;

    try {
      const result = await createRevision({
        oldRequestId: id,
        guOrgId,
        userId,
        plannedTimeWindow,
        responseRequiredBy: responseRequiredBy ? new Date(responseRequiredBy) : undefined,
        subject:            subject ?? null,
        message:            message ?? null,
        sendImmediately,
        idempotencyKey:     idempotencyKey ?? null,
        taktUpdates,
      });

      // Write audit event on the OLD request (the one being superseded)
      await writeAuditEvent({
        requestId: id,
        eventType: "REVISION_CREATED",
        actorOrgId: guOrgId,
        actorUserId: userId,
        actorRole: "GU",
        metadata: {
          newRequestId: result.newRequest.id,
          newTaktVersion: result.newTaktVersion.version,
          sent: result.sent,
        },
      });

      res.status(201).json({
        oldRequestId:        result.oldRequest.id,
        oldRequestStatus:    "SUPERSEDED",
        newRequestId:        result.newRequest.id,
        newRequestNumber:    result.newRequest.requestNumber,
        newRequestStatus:    result.newRequest.status,
        newTaktVersion:      result.newTaktVersion.version,
        newTaktVersionId:    result.newTaktVersion.id,
        snapshotId:          result.newSnapshot.id,
        sent:                result.sent,
        createdAt:           result.newRequest.createdAt,
      });
    } catch (err) {
      if (err instanceof RevisionError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      if (err instanceof VersionConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// ── GET /takt-requests/:id/audit-trail ───────────────────────────────────────
// Returns the coordination audit trail for a TaktRequest.
//
// Access:
//   GU (owning org):  full event list — all event types.
//   NU (addressed):   filtered to externally visible events only
//                     (NOTIFICATION_DELIVERED, DETAILS_RETRIEVED,
//                      AVAILABILITY_CHECK_DONE, RESPONSE_SUBMITTED,
//                      RESPONSE_DELIVERED).
//   Hub admin:        full event list (read-only oversight).
//   Other callers:    403.
//
// Events are returned in ascending chronological order (occurredAt ASC).
// Each entry: { id, requestId, eventType, actorOrgId, actorUserId, actorRole,
//               metadata, occurredAt }
router.get(
  "/takt-requests/:id/audit-trail",
  requireJwt,
  async (req, res): Promise<void> => {
    const callerOrgId = req.user!.orgId;
    const isHubAdmin  = req.user!.hubAdmin;
    const id = req.params.id as string;

    // ── 1. Load request to check access ──────────────────────────────────────
    const request = await getTaktRequestById(id);
    if (!request) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }

    // ── 2. Determine caller role ──────────────────────────────────────────────
    const isOwnerGu     = callerOrgId === request.guOrgId;
    const isAddressedNu = callerOrgId === request.nuOrgId;

    if (!isHubAdmin && !isOwnerGu && !isAddressedNu) {
      res.status(403).json({
        error: "Access denied. Only the creating GU, addressed NU, or a Hub admin may view this audit trail.",
      });
      return;
    }

    // ── 3. Query audit trail ──────────────────────────────────────────────────
    const callerRole = isHubAdmin ? "HUB_ADMIN" : isOwnerGu ? "GU" : "NU";
    const events = await getAuditTrail(id, callerRole);

    res.json({
      requestId: id,
      callerRole,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actorOrgId: e.actorOrgId,
        actorUserId: e.actorUserId,
        actorRole: e.actorRole,
        metadata: e.metadata,
        occurredAt: e.occurredAt.toISOString(),
      })),
    });
  },
);

// ── GET /takt-requests/:id/resource-requirements ─────────────────────────────
// NU lists their recorded resource requirements for a TaktRequest.
router.get(
  "/takt-requests/:id/resource-requirements",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const id = req.params.id as string;

    // Verify the request exists and is addressed to this NU
    const request = await getTaktRequestById(id);
    if (!request || request.nuOrgId !== nuOrgId) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }

    const rows = await db
      .select({
        req: taktRequestResourceRequirementsTable,
        rt: {
          name: resourceTypesTable.name,
          category: resourceTypesTable.category,
        },
      })
      .from(taktRequestResourceRequirementsTable)
      .leftJoin(
        resourceTypesTable,
        eq(taktRequestResourceRequirementsTable.resourceTypeId, resourceTypesTable.id),
      )
      .where(
        and(
          eq(taktRequestResourceRequirementsTable.taktRequestId, id),
          eq(taktRequestResourceRequirementsTable.anOrgId, nuOrgId),
        ),
      )
      .orderBy(desc(taktRequestResourceRequirementsTable.createdAt));

    res.json(
      rows.map(({ req: r, rt }) => ({
        id: r.id,
        taktRequestId: r.taktRequestId,
        anOrgId: r.anOrgId,
        resourceTypeId: r.resourceTypeId,
        resourceTypeName: rt?.name ?? null,
        resourceTypeCategory: rt?.category ?? null,
        requiredCapacity: r.requiredCapacity,
        utilizationPercent: r.utilizationPercent,
        requiredQualification: r.requiredQualification,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        notes: r.notes,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    );
  },
);

// ── POST /takt-requests/:id/resource-requirements ─────────────────────────────
// NU adds a resource requirement for a TaktRequest.
router.post(
  "/takt-requests/:id/resource-requirements",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const id = req.params.id as string;

    const schema = z.object({
      resourceTypeId:       z.string().min(1).nullable().optional(),
      requiredCapacity:     z.number().positive().nullable().optional(),
      utilizationPercent:   z.number().int().min(1).max(100).optional().default(100),
      requiredQualification: z.string().max(500).nullable().optional(),
      periodStart:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      periodEnd:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      notes:                z.string().max(1000).nullable().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Verify the request exists and is addressed to this NU
    const request = await getTaktRequestById(id);
    if (!request || request.nuOrgId !== nuOrgId) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }

    const [inserted] = await db
      .insert(taktRequestResourceRequirementsTable)
      .values({
        taktRequestId:        id,
        anOrgId:              nuOrgId,
        resourceTypeId:       parsed.data.resourceTypeId ?? null,
        requiredCapacity:     parsed.data.requiredCapacity?.toString() ?? null,
        utilizationPercent:   parsed.data.utilizationPercent ?? 100,
        requiredQualification: parsed.data.requiredQualification ?? null,
        periodStart:          parsed.data.periodStart ?? null,
        periodEnd:            parsed.data.periodEnd ?? null,
        notes:                parsed.data.notes ?? null,
      })
      .returning();

    res.status(201).json(inserted);
  },
);

// ── DELETE /takt-requests/:id/resource-requirements/:reqId ───────────────────
// NU removes a resource requirement.
router.delete(
  "/takt-requests/:id/resource-requirements/:reqId",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const id      = req.params.id as string;
    const reqId   = req.params.reqId as string;

    const [deleted] = await db
      .delete(taktRequestResourceRequirementsTable)
      .where(
        and(
          eq(taktRequestResourceRequirementsTable.id, reqId),
          eq(taktRequestResourceRequirementsTable.taktRequestId, id),
          eq(taktRequestResourceRequirementsTable.anOrgId, nuOrgId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Resource requirement not found" });
      return;
    }

    res.status(204).end();
  },
);

export default router;



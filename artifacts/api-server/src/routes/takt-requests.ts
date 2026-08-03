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
import { takteTable, projectsTable, messageOutboxTable, hubMessagesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { z } from "zod";
import {
  createTaktRequestDraft,
  getTaktRequestById,
  getTaktRequestWithSnapshot,
  getTaktRequestDetailForGu,
  listTaktRequestsForGu,
  listTaktRequestsForGuEnriched,
  listTaktRequestsForNu,
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
  createTaktResponse,
  getTaktResponseWithAlternatives,
  TaktResponseValidationError,
} from "../lib/takt-response-repository";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
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
    const requests = await listTaktRequestsForNu(orgId, {
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
// GU creates a DRAFT TaktRequest for a Takt in their project.
router.post(
  "/projects/:projectId/takt-requests",
  requireJwt,
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const userId = req.user!.userId!;
    const projectId = req.params.projectId as string;

    const schema = z.object({
      taktId: z.string().min(1),
      nuOrgId: z.string().min(1),
      requestNumber: z.string().min(1),
      responseRequiredBy: z.string().datetime({ offset: true }).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { taktId, nuOrgId, requestNumber, responseRequiredBy } = parsed.data;

    // Verify the project exists and is owned by the calling GU org
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.agOrgId !== guOrgId) {
      res
        .status(403)
        .json({ error: "You are not authorized to create requests for this project" });
      return;
    }

    // Verify the Takt belongs to this project
    const [takt] = await db
      .select()
      .from(takteTable)
      .where(and(eq(takteTable.id, taktId), eq(takteTable.projectId, projectId)))
      .limit(1);

    if (!takt) {
      res.status(404).json({ error: "Takt not found in the specified project" });
      return;
    }

    const request = await createTaktRequestDraft({
      taktId,
      taktVersion: takt.version ?? 1,
      guOrgId,
      nuOrgId,
      requestNumber,
      responseRequiredBy: responseRequiredBy
        ? new Date(responseRequiredBy)
        : undefined,
      createdByUserId: userId,
    });

    res.status(201).json(request);
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
router.post("/takt-requests", requireJwt, async (req, res): Promise<void> => {
  const guOrgId = req.user!.orgId!;
  const userId = req.user!.userId!;

  const bodySchema = z.object({
    taktId: z.string().min(1),
    nuOrgId: z.string().min(1),
    responseRequiredBy: z.string().datetime({ offset: true }).optional(),
    subject: z.string().max(255).optional(),
    message: z.string().max(2000).optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { taktId, nuOrgId, responseRequiredBy, subject, message } = parsed.data;

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
    const snapResult = await getTaktRequestWithSnapshot(id);
    if (!snapResult?.snapshot) {
      // Fallback: create snapshot from current Takt state (backward compat with
      // requests created via legacy POST /projects/:projectId/takt-requests).
      const [taktJoin] = await db
        .select({ takt: takteTable, project: projectsTable })
        .from(takteTable)
        .innerJoin(projectsTable, eq(takteTable.projectId, projectsTable.id))
        .where(eq(takteTable.id, existing.taktId))
        .limit(1);

      if (!taktJoin) {
        res.status(422).json({ error: "Referenced Takt no longer exists" });
        return;
      }
      if (taktJoin.project.agOrgId !== guOrgId) {
        res.status(403).json({ error: "You are not authorised to send this request" });
        return;
      }

      const fallbackPayload: Record<string, unknown> = {
        taktId: taktJoin.takt.id,
        taktVersion: taktJoin.takt.version,
        taktBezeichnung: taktJoin.takt.taktBezeichnung,
        zone: taktJoin.takt.zone,
        gewerk: taktJoin.takt.gewerk,
        description: taktJoin.takt.description ?? null,
        plannedStart: taktJoin.takt.plannedStart,
        plannedEnd: taktJoin.takt.plannedEnd,
      };
      try {
        await createTaktRequestSnapshot({
          taktRequestId: id,
          schemaVersion: "1.0",
          snapshotPayload: fallbackPayload,
        });
      } catch (err) {
        if (!(err instanceof DuplicateSnapshotError)) throw err;
      }
    }

    // ── 5. Build notification payload — minimal, no full Takt data ─────────
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

    const transportResult = await transport.send(envelope);

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
// NU submits ACCEPTED / ALTERNATIVES_PROPOSED / REJECTED.
router.post(
  "/takt-requests/:id/response",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const userId = req.user!.userId!;
    const id = req.params.id as string;

    const alternativeSchema = z.object({
      alternativeId: z.string().min(1),
      rank: z.number().int().min(1),
      proposedStart: z.string().datetime({ offset: true }),
      proposedEnd: z.string().datetime({ offset: true }),
      crewSize: z.number().int().min(1).optional(),
      conditions: z.array(z.string()).optional(),
    });

    const schema = z.object({
      decision: z.enum(["ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED"]),
      reasonCode: z
        .enum([
          "RESOURCE_CONFLICT",
          "NO_CAPACITY",
          "EQUIPMENT_UNAVAILABLE",
          "QUALIFICATION_MISSING",
          "TIME_WINDOW_TOO_SHORT",
          "OUTSIDE_PLANNING_HORIZON",
          "OTHER",
        ])
        .optional(),
      comment: z.string().max(2000).optional(),
      acceptedStart: z.string().datetime({ offset: true }).optional(),
      acceptedEnd: z.string().datetime({ offset: true }).optional(),
      nextAvailableDate: z.string().optional(),
      alternatives: z.array(alternativeSchema).max(3).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const existing = await getTaktRequestById(id);
    if (!existing) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }
    if (existing.nuOrgId !== nuOrgId) {
      res
        .status(403)
        .json({ error: "Only the addressed NU organisation may respond" });
      return;
    }

    // Check no response exists yet
    const existingResponse = await getTaktResponseWithAlternatives(id);
    if (existingResponse) {
      res
        .status(409)
        .json({ error: "A response already exists for this TaktRequest" });
      return;
    }

    const { decision, reasonCode, comment, acceptedStart, acceptedEnd, nextAvailableDate, alternatives } =
      parsed.data;

    let result;
    try {
      result = await createTaktResponse({
        taktRequestId: id,
        decision,
        reasonCode,
        comment,
        acceptedStart: acceptedStart ? new Date(acceptedStart) : undefined,
        acceptedEnd: acceptedEnd ? new Date(acceptedEnd) : undefined,
        nextAvailableDate,
        createdByUserId: userId,
        alternatives: alternatives?.map((alt) => ({
          alternativeId: alt.alternativeId,
          rank: alt.rank,
          proposedStart: new Date(alt.proposedStart),
          proposedEnd: new Date(alt.proposedEnd),
          crewSize: alt.crewSize,
          conditions: alt.conditions,
        })),
      });
    } catch (err) {
      if (err instanceof TaktResponseValidationError) {
        res.status(422).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Transition the TaktRequest status to match the decision
    const nextStatus =
      decision === "ACCEPTED"
        ? "ACCEPTED"
        : decision === "ALTERNATIVES_PROPOSED"
          ? "ALTERNATIVES_PROPOSED"
          : "REJECTED";

    try {
      await updateTaktRequestStatus(id, nextStatus as TaktRequestStatus);
    } catch (err) {
      if (err instanceof TaktRequestTransitionError) {
        // Response was saved — return it but note the transition failed
        res.status(201).json({
          ...result,
          warning: `Response recorded but status transition failed: ${(err as Error).message}`,
        });
        return;
      }
      throw err;
    }

    // Write hub audit message
    const responseHubType =
      decision === "ACCEPTED"
        ? "TAKT_REQUEST_ACCEPTED"
        : decision === "ALTERNATIVES_PROPOSED"
          ? "TAKT_REQUEST_ALTERNATIVES_PROPOSED"
          : "TAKT_REQUEST_REJECTED";
    await db.insert(hubMessagesTable).values({
      type: responseHubType as any,
      senderOrgId: nuOrgId,
      recipientOrgId: existing.guOrgId,
      correlationId: id,
      payload: { taktRequestId: id, decision, reasonCode, comment },
    });

    res.status(201).json(result);
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
// Request body format (NEW — uses timeWindow objects, not flat dates):
//   { decision, acceptedTimeWindow?, reasonCode?, comment?,
//     alternatives?: [{alternativeId, rank, timeWindow, crewSize, conditions}],
//     nextAvailableDate? }
//
// Privacy:
//   - Strict allowlist — unknown fields are rejected with 400.
//   - Forbidden fields (localProjectId, resourceId, etc.) → 400.
//   - Only public fields are transmitted to the GU's inbox.
//
// Idempotency:
//   - messageId = deterministic `taktresponse-{requestId}`.
//   - If a response already exists with the same decision → transport retried, 200.
//   - If a response exists with a different decision → 409.
//   - On transport failure: business response is saved; retry re-delivers.
//
// Status: UNDER_REVIEW → ACCEPTED | ALTERNATIVES_PROPOSED | REJECTED.
//         DETAILS_RETRIEVED is also accepted as starting state.
//
// Permissions: NU (AN), addressed NU only. GU, Hub → 403.
router.post(
  "/takt-requests/:id/responses",
  requireJwt,
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

    // ── 2. Privacy filter (run before Zod parse) ──────────────────────────────
    const privacyError = checkResponsePrivacy(req.body);
    if (privacyError) {
      res.status(400).json({ error: privacyError });
      return;
    }

    // ── 3. Parse + validate body ──────────────────────────────────────────────
    const alternativeSchema = z.object({
      alternativeId: z.string().min(1),
      rank: z.number().int().min(1),
      // timeWindow.start/end accept ISO date ("YYYY-MM-DD") or datetime strings
      timeWindow: z.object({
        start: z.string().min(1),
        end:   z.string().min(1),
      }),
      crewSize:   z.number().int().min(1).optional(),
      conditions: z.array(z.string()).optional(),
    });

    const bodySchema = z.object({
      decision: z.enum(["ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED"]),
      // acceptedTimeWindow accepts ISO date or datetime strings
      acceptedTimeWindow: z.object({
        start: z.string().min(1),
        end:   z.string().min(1),
      }).optional(),
      reasonCode: z
        .enum([
          "RESOURCE_CONFLICT",
          "NO_CAPACITY",
          "EQUIPMENT_UNAVAILABLE",
          "QUALIFICATION_MISSING",
          "TIME_WINDOW_TOO_SHORT",
          "OUTSIDE_PLANNING_HORIZON",
          "OTHER",
        ])
        .optional(),
      comment:           z.string().max(2000).optional(),
      alternatives:      z.array(alternativeSchema).max(3).optional(),
      nextAvailableDate: z.string().optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const {
      decision, acceptedTimeWindow, reasonCode, comment, alternatives, nextAvailableDate,
    } = parsed.data;

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

    // ── 5. Answerable status check ─────────────────────────────────────────────
    const ANSWERABLE_STATUSES = new Set(["UNDER_REVIEW", "DETAILS_RETRIEVED"]);

    // ── 6. Idempotency: check existing response ───────────────────────────────
    const msgId = `taktresponse-${id}`;
    const existing = await getTaktResponseWithAlternatives(id);
    if (existing) {
      if (existing.response.decision !== decision) {
        res.status(409).json({
          error: `A response with decision "${existing.response.decision}" already exists. ` +
                 `Cannot replace it with "${decision}" for the same TaktRequest.`,
        });
        return;
      }
      // Same decision: idempotent — look up the existing outbox entry directly
      // (avoids re-sending with a reconstructed payload that may not match the stored one,
      //  which would cause InvalidEnvelopeError due to date format differences)
      const [existingOutbox] = await db
        .select()
        .from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, msgId))
        .limit(1);

      const transportStatus = existingOutbox?.status ?? "DELIVERED";
      const transportMessageId = existingOutbox?.messageId ?? msgId;

      res.status(200).json({
        responseId: existing.response.id,
        taktRequestId: id,
        decision: existing.response.decision,
        reasonCode: existing.response.reasonCode ?? null,
        comment: existing.response.comment ?? null,
        acceptedTimeWindow: existing.response.acceptedStart
          ? { start: existing.response.acceptedStart.toISOString(), end: existing.response.acceptedEnd!.toISOString() }
          : null,
        alternatives: existing.alternatives.map(a => ({
          alternativeId: a.alternativeId,
          rank: a.rank,
          timeWindow: { start: a.proposedStart.toISOString(), end: a.proposedEnd.toISOString() },
          crewSize: a.crewSize ?? null,
          conditions: a.conditions ?? null,
        })),
        nextAvailableDate: existing.response.nextAvailableDate ?? null,
        transportStatus: transportStatus,
        transportMessageId: transportMessageId,
        requestStatus: request.status,
        createdAt: existing.response.createdAt.toISOString(),
      });
      return;
    }

    // ── 7. Status guard (first-time response) ─────────────────────────────────
    if (!ANSWERABLE_STATUSES.has(request.status)) {
      res.status(409).json({
        error: `TaktRequest cannot be answered in status "${request.status}". ` +
               `Expected: ${[...ANSWERABLE_STATUSES].join(", ")}`,
        currentStatus: request.status,
      });
      return;
    }

    // ── 8. Save response transactionally (business response first) ────────────
    let result;
    try {
      result = await createTaktResponse({
        taktRequestId: id,
        decision,
        reasonCode,
        comment,
        acceptedStart:  acceptedTimeWindow ? new Date(acceptedTimeWindow.start) : undefined,
        acceptedEnd:    acceptedTimeWindow ? new Date(acceptedTimeWindow.end)   : undefined,
        nextAvailableDate,
        createdByUserId: userId,
        messageId: msgId,
        alternatives: alternatives?.map(alt => ({
          alternativeId: alt.alternativeId,
          rank:          alt.rank,
          proposedStart: new Date(alt.timeWindow.start),
          proposedEnd:   new Date(alt.timeWindow.end),
          crewSize:      alt.crewSize,
          conditions:    alt.conditions,
        })),
      });
    } catch (err) {
      if (err instanceof TaktResponseValidationError) {
        res.status(422).json({ error: err.message });
        return;
      }
      throw err;
    }

    // ── 9. Send TaktResponseMessage to GU inbox ───────────────────────────────
    const guPayload = buildGuPayload(
      id, decision, reasonCode, comment, acceptedTimeWindow, alternatives, nextAvailableDate,
    );
    const envelope = {
      messageId: msgId,
      schemaVersion: "1.0",
      messageType: DataspaceMessageType.TAKT_RESPONSE_SUBMITTED,
      senderOrgId: nuOrgId,
      recipientOrgId: request.guOrgId,
      correlationId: id,
      createdAt: new Date(),
      causationId: null,
      payload: guPayload,
    };

    const transportResult = await transport.send(envelope);

    // ── 10. Update TaktRequest status ─────────────────────────────────────────
    const nextStatus: TaktRequestStatus =
      decision === "ACCEPTED"              ? "ACCEPTED" :
      decision === "ALTERNATIVES_PROPOSED" ? "ALTERNATIVES_PROPOSED" :
                                             "REJECTED";
    try {
      await updateTaktRequestStatus(id, nextStatus);
    } catch (err) {
      if (!(err instanceof TaktRequestTransitionError)) throw err;
      // Non-fatal: response and message already saved — status may have advanced
    }

    // ── 11. Write audit events ─────────────────────────────────────────────────
    await writeAuditEvent({
      requestId: id,
      eventType: "RESPONSE_SUBMITTED",
      actorOrgId: nuOrgId,
      actorUserId: userId,
      actorRole: "NU",
      metadata: {
        decision,
        reasonCode: reasonCode ?? null,
        transportMessageId: transportResult.messageId,
        transportStatus: transportResult.status,
      },
    });
    if (transportResult.status === "DELIVERED") {
      await writeAuditEvent({
        requestId: id,
        eventType: "RESPONSE_DELIVERED",
        actorOrgId: nuOrgId,
        actorUserId: userId,
        actorRole: "NU",
        metadata: { transportMessageId: transportResult.messageId },
      });
    }

    res.status(201).json({
      responseId:       result.response.id,
      taktRequestId:    id,
      decision:         result.response.decision,
      reasonCode:       result.response.reasonCode ?? null,
      comment:          result.response.comment ?? null,
      acceptedTimeWindow: result.response.acceptedStart
        ? { start: result.response.acceptedStart.toISOString(), end: result.response.acceptedEnd!.toISOString() }
        : null,
      alternatives: result.alternatives.map(a => ({
        alternativeId: a.alternativeId,
        rank:          a.rank,
        timeWindow:    { start: a.proposedStart.toISOString(), end: a.proposedEnd.toISOString() },
        crewSize:      a.crewSize ?? null,
        conditions:    a.conditions ?? null,
      })),
      nextAvailableDate:   result.response.nextAvailableDate ?? null,
      transportStatus:     transportResult.status,
      transportMessageId:  transportResult.messageId,
      requestStatus:       nextStatus,
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

export default router;


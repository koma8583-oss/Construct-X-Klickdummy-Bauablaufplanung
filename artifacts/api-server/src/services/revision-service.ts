/**
 * Task 6.5 — RevisionService
 *
 * createRevision(params)
 *   Creates a new coordination round after a REQUEST_REVISION decision.
 *
 *   Preconditions:
 *     - Old request must exist and have status REVISION_REQUIRED
 *     - GU must own the TaktRequest
 *     - A GU decision of REQUEST_REVISION must exist
 *     - No successor request may already exist
 *     - New time window must be valid (start < end, future dates preferred)
 *
 *   Atomic transaction:
 *     1. Increment takt version (optimistic lock)
 *     2. Insert takt_versions entry (sourceType = REVISION)
 *     3. Update takt (plannedStart, plannedEnd, version, lifecycleStatus = IN_COORDINATION)
 *     4. Insert new TaktRequest (DRAFT, supersedesRequestId = old request)
 *     5. Insert new TaktRequestSnapshot
 *     6. Set old request status = SUPERSEDED
 *
 *   Post-commit (sendImmediately = true):
 *     - Send TAKT_REQUEST_REVISED notification to NU (reuses transport layer)
 *
 * Task 6.6 transport:
 *   - Message type: TAKT_REQUEST_REVISED (existing in DataspaceMessageType)
 *   - Payload: standard notification + supersedesRequestId + previousTaktVersion
 *   - No full snapshot in the message
 */
import pino from "pino";
import { db } from "@workspace/db";
import {
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktResponseDecisionsTable,
  taktResponsesTable,
  takteTable,
  projectsTable,
  taktVersionsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { TaktRequest, TaktRequestSnapshot, TaktVersion } from "@workspace/db";
import { VersionConflictError } from "./takt-version-service";
import { LocalHubTransport } from "../lib/transport/local-hub-transport";
import type { MessageTransport } from "../lib/transport/message-transport";
import { DataspaceMessageType } from "@workspace/api-zod";

const logger = pino({ name: "revision-service" });
const transport = new LocalHubTransport();

// ── Domain errors ─────────────────────────────────────────────────────────────

export class RevisionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "RevisionError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRequestNumber(): string {
  return `TKR-${Date.now().toString(36).toUpperCase()}-R`;
}

function buildVersionSnapshotPayload(takt: {
  taktBezeichnung: string;
  zone:             string;
  gewerk:           string;
  description:      string | null;
  plannedStart:     string;
  plannedEnd:       string;
  earliestStart:    string | null;
  latestEnd:        string | null;
  lvReference:      string | null;
  bimReference:     string | null;
  requiredResources: string | null;
  version:          number;
}): Record<string, unknown> {
  return {
    taktBezeichnung:   takt.taktBezeichnung,
    zone:              takt.zone,
    gewerk:            takt.gewerk,
    description:       takt.description  ?? null,
    plannedStart:      takt.plannedStart,
    plannedEnd:        takt.plannedEnd,
    earliestStart:     takt.earliestStart ?? null,
    latestEnd:         takt.latestEnd     ?? null,
    lvReference:       takt.lvReference   ?? null,
    bimReference:      takt.bimReference  ?? null,
    requiredResources: takt.requiredResources ?? null,
    version:           takt.version,
  };
}

/** Extract date string (YYYY-MM-DD) from ISO datetime or date string. */
function toDateString(v: string | Date): string {
  const s = typeof v === "string" ? v : v.toISOString();
  return s.slice(0, 10);
}

// ── Input / Output ────────────────────────────────────────────────────────────

export interface CreateRevisionParams {
  oldRequestId:     string;
  guOrgId:          string;
  userId:           string;
  plannedTimeWindow: { start: string; end: string };
  responseRequiredBy?: Date | null;
  subject?:         string | null;
  message?:         string | null;
  sendImmediately?: boolean;
  idempotencyKey?:  string | null;
  /** Additional takt fields to update in the new version */
  taktUpdates?: {
    taktBezeichnung?: string;
    zone?: string;
    gewerk?: string;
    description?: string;
    earliestStart?: string;
    latestEnd?: string;
    lvReference?: string;
    bimReference?: string;
    requiredResources?: string;
  };
  /**
   * Optional transport override — used in tests to inject a failing or mock
   * transport without requiring module-level singleton replacement.
   * Production code always omits this; the module-level LocalHubTransport is used.
   */
  _transport?: MessageTransport;
}

export interface CreateRevisionResult {
  oldRequest:      TaktRequest;
  newRequest:      TaktRequest;
  newSnapshot:     TaktRequestSnapshot;
  newTaktVersion:  TaktVersion;
  sent:            boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export async function createRevision(
  params: CreateRevisionParams,
): Promise<CreateRevisionResult> {
  const {
    oldRequestId, guOrgId, userId,
    plannedTimeWindow, responseRequiredBy,
    subject, message, sendImmediately = false,
    idempotencyKey, taktUpdates,
    _transport: effectiveTransport = transport,
  } = params;

  // ── 1. Load old TaktRequest ───────────────────────────────────────────────────
  const [oldRequest] = await db
    .select()
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.id, oldRequestId))
    .limit(1);

  if (!oldRequest) {
    throw new RevisionError("TaktRequest not found", 404);
  }
  if (oldRequest.guOrgId !== guOrgId) {
    throw new RevisionError("Only the creating GU organisation may create a revision", 403);
  }
  if (oldRequest.status !== "REVISION_REQUIRED") {
    throw new RevisionError(
      `Cannot create a revision for a TaktRequest with status "${oldRequest.status}". ` +
        "Status must be REVISION_REQUIRED.",
      409,
    );
  }

  // ── 2. Verify GU decision of REQUEST_REVISION exists ─────────────────────────
  const [oldResponse] = await db
    .select()
    .from(taktResponsesTable)
    .where(eq(taktResponsesTable.taktRequestId, oldRequestId))
    .limit(1);

  if (!oldResponse) {
    throw new RevisionError(
      "Cannot create revision: old TaktRequest has no TaktResponse. " +
        "A response must exist before a revision round can be started.",
      400,
    );
  }

  const [guDecision] = await db
    .select()
    .from(taktResponseDecisionsTable)
    .where(
      and(
        eq(taktResponseDecisionsTable.taktRequestId, oldRequestId),
        eq(taktResponseDecisionsTable.decisionType, "REQUEST_REVISION"),
      ),
    )
    .limit(1);

  if (!guDecision) {
    throw new RevisionError(
      "No REQUEST_REVISION GU decision found for this TaktRequest. " +
        "A REQUEST_REVISION decision must be recorded before creating a revision.",
      400,
    );
  }

  // ── 3. Check no successor request already exists ──────────────────────────────
  const [existingSuccessor] = await db
    .select()
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.supersedesRequestId, oldRequestId))
    .limit(1);

  if (existingSuccessor) {
    throw new RevisionError(
      `A successor TaktRequest (${existingSuccessor.id}) already exists for this request.`,
      409,
    );
  }

  // ── 4. Load current Takt ──────────────────────────────────────────────────────
  const [takt] = await db
    .select()
    .from(takteTable)
    .where(eq(takteTable.id, oldRequest.taktId))
    .limit(1);

  if (!takt) throw new RevisionError("Referenced Takt no longer exists", 404);

  // Load project for projectReference in snapshot
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, takt.projectId))
    .limit(1);

  // ── 5. Validate time window ───────────────────────────────────────────────────
  const newStart = toDateString(plannedTimeWindow.start);
  const newEnd   = toDateString(plannedTimeWindow.end);

  if (newStart >= newEnd) {
    throw new RevisionError(
      `Invalid time window: start (${newStart}) must be before end (${newEnd})`, 400,
    );
  }

  // A revision must start a genuinely new coordination window. Do not allow
  // callers that bypass the UI to create a successor with the old dates.
  const [oldSnapshot] = await db
    .select()
    .from(taktRequestSnapshotsTable)
    .where(eq(taktRequestSnapshotsTable.taktRequestId, oldRequestId))
    .limit(1);
  const oldPayload = oldSnapshot?.snapshotPayload as Record<string, unknown> | undefined;
  const oldWindow = (
    oldPayload?.taktWindow ??
    oldPayload?.plannedTimeWindow
  ) as Record<string, unknown> | undefined;
  const oldStart = oldWindow?.start ?? oldPayload?.plannedStart ?? takt.plannedStart;
  const oldEnd = oldWindow?.end ?? oldPayload?.plannedEnd ?? takt.plannedEnd;

  if (oldStart && oldEnd && newStart === toDateString(String(oldStart)) && newEnd === toDateString(String(oldEnd))) {
    throw new RevisionError(
      "A revision must define a new time window different from the previous request.",
      400,
    );
  }

  if (responseRequiredBy && responseRequiredBy < new Date()) {
    throw new RevisionError("responseRequiredBy must not be in the past", 400);
  }

  const expectedTaktVersion = takt.version;
  const newVersionNumber    = takt.version + 1;

  // ── 6. Merged takt values for the new version ─────────────────────────────────
  const mergedTakt = {
    taktBezeichnung:   taktUpdates?.taktBezeichnung   ?? takt.taktBezeichnung,
    zone:              taktUpdates?.zone              ?? takt.zone,
    gewerk:            taktUpdates?.gewerk            ?? takt.gewerk,
    description:       taktUpdates?.description       ?? takt.description,
    plannedStart:      newStart,
    plannedEnd:        newEnd,
    earliestStart:     taktUpdates?.earliestStart     ?? takt.earliestStart,
    latestEnd:         taktUpdates?.latestEnd         ?? takt.latestEnd,
    lvReference:       taktUpdates?.lvReference       ?? takt.lvReference,
    bimReference:      taktUpdates?.bimReference      ?? takt.bimReference,
    requiredResources: taktUpdates?.requiredResources ?? takt.requiredResources,
    version:           newVersionNumber,
  };

  const versionPayload = buildVersionSnapshotPayload(mergedTakt);

  // ── 7. Atomic transaction ─────────────────────────────────────────────────────
  const txResult = await db.transaction(async (tx) => {
    // a. Insert new takt_versions (REVISION)
    const [newTaktVersion] = await tx
      .insert(taktVersionsTable)
      .values({
        taktId:           takt.id,
        version:          newVersionNumber,
        sourceType:       "REVISION" as const,
        sourceRequestId:  oldRequestId,
        sourceResponseId: oldResponse.id,
        sourceDecisionId: guDecision.id,
        snapshotPayload:  versionPayload,
        createdByUserId:  userId,
      })
      .returning();

    // b. Update takt with optimistic lock
    const updateResult = await tx
      .update(takteTable)
      .set({
        taktBezeichnung:   mergedTakt.taktBezeichnung,
        zone:              mergedTakt.zone,
        gewerk:            mergedTakt.gewerk,
        description:       mergedTakt.description ?? null,
        plannedStart:      mergedTakt.plannedStart,
        plannedEnd:        mergedTakt.plannedEnd,
        earliestStart:     mergedTakt.earliestStart ?? null,
        latestEnd:         mergedTakt.latestEnd     ?? null,
        lvReference:       mergedTakt.lvReference   ?? null,
        bimReference:      mergedTakt.bimReference  ?? null,
        requiredResources: mergedTakt.requiredResources ?? null,
        version:           newVersionNumber,
        lifecycleStatus:   "IN_COORDINATION",
      })
      .where(and(eq(takteTable.id, takt.id), eq(takteTable.version, expectedTaktVersion)))
      .returning();

    if (updateResult.length === 0) {
      throw new VersionConflictError(takt.id, expectedTaktVersion);
    }

    // c. Insert new TaktRequest (DRAFT)
    const newRequestId     = crypto.randomUUID();
    const newRequestNumber = generateRequestNumber();
    const now              = new Date();

    const [newRequest] = await tx
      .insert(taktRequestsTable)
      .values({
        id:                  newRequestId,
        taktId:              takt.id,
        taktVersion:         newVersionNumber,
        guOrgId:             oldRequest.guOrgId,
        nuOrgId:             oldRequest.nuOrgId,
        requestNumber:       newRequestNumber,
        status:              "DRAFT",
        responseRequiredBy:  responseRequiredBy ?? null,
        supersedesRequestId: oldRequestId,
        createdByUserId:     userId,
        createdAt:           now,
        updatedAt:           now,
      })
      .returning();

    // d. Insert new Snapshot for the new request
    const snapshotPayload: Record<string, unknown> = {
      taktId:            takt.id,
      taktVersion:       newVersionNumber,
      taktBezeichnung:   mergedTakt.taktBezeichnung,
      zone:              mergedTakt.zone,
      gewerk:            mergedTakt.gewerk,
      description:       mergedTakt.description  ?? null,
      plannedStart:      newStart,
      plannedEnd:        newEnd,
      projectReference:  project?.id ?? takt.projectId,
      ...(subject != null || message != null
        ? { coordinationContext: { subject: subject ?? null, message: message ?? null } }
        : {}),
    };

    const [newSnapshot] = await tx
      .insert(taktRequestSnapshotsTable)
      .values({
        taktRequestId: newRequestId,
        schemaVersion: "1.0",
        snapshotPayload,
      })
      .returning();

    // e. Set old request to SUPERSEDED
    await tx
      .update(taktRequestsTable)
      .set({ status: "SUPERSEDED" })
      .where(eq(taktRequestsTable.id, oldRequestId));

    return {
      oldRequest,
      newRequest,
      newSnapshot,
      newTaktVersion,
    };
  });

  logger.info(
    {
      oldRequestId, newRequestId: txResult.newRequest.id,
      newTaktVersion: newVersionNumber,
    },
    "Revision created",
  );

  // ── 8. Optional send (post-commit, Task 6.6) ──────────────────────────────────
  let sent = false;
  if (sendImmediately) {
    const msgId = `takt-revised-${txResult.newRequest.id}`;
    const payload = {
      taktRequestId:       txResult.newRequest.id,
      supersedesRequestId: oldRequestId,
      previousTaktVersion: takt.version,
      taktVersion:         newVersionNumber,
      projectReference:    project?.id ?? takt.projectId,
      taktReference:       takt.id,
      responseRequiredBy:  responseRequiredBy?.toISOString() ?? null,
      detailsRef:          `/takt-requests/${txResult.newRequest.id}/details`,
      subject:             subject ?? null,
      message:             message ?? null,
    };

    let transportResult;
    try {
      transportResult = await effectiveTransport.send({
        messageId:      msgId,
        schemaVersion:  "1.0",
        messageType:    DataspaceMessageType.TAKT_REQUEST_REVISED,
        senderOrgId:    oldRequest.guOrgId,
        recipientOrgId: oldRequest.nuOrgId,
        correlationId:  txResult.newRequest.id,
        createdAt:      new Date(),
        causationId:    oldRequestId,
        payload,
      });
    } catch (err) {
      // transport.send() threw (e.g. InvalidEnvelopeError) — leave request as DRAFT
      logger.warn({ err, newRequestId: txResult.newRequest.id }, "sendImmediately transport threw — request remains DRAFT");
      transportResult = null;
    }

    if (transportResult?.status === "DELIVERED") {
      // Happy path: DRAFT → SENT → DELIVERED
      const now = new Date();
      await db
        .update(taktRequestsTable)
        .set({
          status:      "DELIVERED",
          sentAt:      transportResult.sentAt      ?? now,
          deliveredAt: transportResult.deliveredAt ?? now,
        })
        .where(eq(taktRequestsTable.id, txResult.newRequest.id));
      txResult.newRequest = {
        ...txResult.newRequest,
        status: "DELIVERED" as typeof txResult.newRequest.status,
      };
      sent = true;
    } else if (transportResult?.status === "SENT") {
      // Async confirmation pending: advance to SENT only
      const now = new Date();
      await db
        .update(taktRequestsTable)
        .set({ status: "SENT", sentAt: transportResult.sentAt ?? now })
        .where(eq(taktRequestsTable.id, txResult.newRequest.id));
      txResult.newRequest = {
        ...txResult.newRequest,
        status: "SENT" as typeof txResult.newRequest.status,
      };
      sent = true;
    } else {
      // FAILED or null: leave business object intact (stays DRAFT)
      logger.warn(
        { transportResult, newRequestId: txResult.newRequest.id },
        "sendImmediately transport failed — request remains DRAFT",
      );
    }
  }

  return {
    oldRequest:     txResult.oldRequest,
    newRequest:     txResult.newRequest,
    newSnapshot:    txResult.newSnapshot as unknown as TaktRequestSnapshot,
    newTaktVersion: txResult.newTaktVersion,
    sent,
  };
}

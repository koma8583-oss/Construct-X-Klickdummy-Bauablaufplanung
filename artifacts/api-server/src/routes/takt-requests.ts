/**
 * HTTP routes for TaktRequest coordination (Task 45).
 *
 * GU endpoints:
 *   POST /projects/:projectId/takt-requests      — create DRAFT
 *   POST /takt-requests/:id/send                 — send (DRAFT → SENT → DELIVERED) + snapshot
 *   GET  /takt-requests                          — list (GU sees own requests, NU sees addressed requests)
 *
 * NU endpoints:
 *   GET  /takt-requests/:id/snapshot             — pull released Takt details (DELIVERED → DETAILS_RETRIEVED)
 *   POST /takt-requests/:id/response             — submit ACCEPTED / ALTERNATIVES_PROPOSED / REJECTED
 *
 * All routes use the repository layer. No direct DB queries here.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { takteTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { z } from "zod";
import {
  createTaktRequestDraft,
  getTaktRequestById,
  getTaktRequestWithSnapshot,
  listTaktRequestsForGu,
  listTaktRequestsForNu,
  updateTaktRequestStatus,
  createTaktRequestSnapshot,
  TaktRequestTransitionError,
  DuplicateSnapshotError,
  type TaktRequestStatus,
} from "../lib/takt-request-repository";
import {
  createTaktResponse,
  getTaktResponseWithAlternatives,
  TaktResponseValidationError,
} from "../lib/takt-response-repository";

const router = Router();

// ── GET /takt-requests ────────────────────────────────────────────────────────
// GU sees requests where they are the guOrgId.
// NU sees requests where they are the nuOrgId.
// Role is determined by the `role` query param (gu|nu); defaults to guOrgId check.
router.get("/takt-requests", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;
  const { role, status, taktId } = req.query as Record<string, string>;

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

  // Default: GU list
  const requests = await listTaktRequestsForGu(orgId, {
    status: statusFilter,
    taktId: taktId ?? undefined,
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

// ── POST /takt-requests/:id/send ─────────────────────────────────────────────
// GU sends the request: DRAFT → SENT → DELIVERED (simulated delivery).
// Creates an immutable snapshot of the current Takt data.
router.post(
  "/takt-requests/:id/send",
  requireJwt,
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const id = req.params.id as string;

    const existing = await getTaktRequestById(id);
    if (!existing) {
      res.status(404).json({ error: "TaktRequest not found" });
      return;
    }
    if (existing.guOrgId !== guOrgId) {
      res
        .status(403)
        .json({ error: "Only the GU organisation may send this request" });
      return;
    }

    // Fetch the Takt and verify it still belongs to a project owned by the GU org
    const [takt] = await db
      .select({ takt: takteTable, project: projectsTable })
      .from(takteTable)
      .innerJoin(projectsTable, eq(takteTable.projectId, projectsTable.id))
      .where(eq(takteTable.id, existing.taktId))
      .limit(1)
      .then((rows) => rows);

    if (!takt) {
      res.status(422).json({ error: "Referenced Takt no longer exists" });
      return;
    }
    if (takt.project.agOrgId !== guOrgId) {
      res
        .status(403)
        .json({ error: "You are not authorized to send requests for this Takt's project" });
      return;
    }

    // Transition DRAFT → SENT
    let updated;
    try {
      updated = await updateTaktRequestStatus(id, "SENT", {
        sentAt: new Date(),
      });
    } catch (err) {
      if (err instanceof TaktRequestTransitionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Create immutable snapshot — only released Takt data, no full project info
    const taktRow = takt.takt;
    const snapshotPayload: Record<string, unknown> = {
      taktId: taktRow.id,
      taktVersion: taktRow.version,
      taktBezeichnung: taktRow.taktBezeichnung,
      zone: taktRow.zone,
      gewerk: taktRow.gewerk,
      description: taktRow.description ?? null,
      plannedStart: taktRow.plannedStart,
      plannedEnd: taktRow.plannedEnd,
      earliestStart: taktRow.earliestStart ?? null,
      latestEnd: taktRow.latestEnd ?? null,
      requiredResources: taktRow.requiredResources ?? null,
    };

    try {
      await createTaktRequestSnapshot({
        taktRequestId: id,
        schemaVersion: "1.0",
        snapshotPayload,
      });
    } catch (err) {
      if (err instanceof DuplicateSnapshotError) {
        // Snapshot already exists — idempotent, continue
      } else {
        throw err;
      }
    }

    // Simulate immediate delivery: SENT → DELIVERED
    try {
      updated = await updateTaktRequestStatus(id, "DELIVERED", {
        deliveredAt: new Date(),
      });
    } catch (err) {
      if (err instanceof TaktRequestTransitionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    res.json(updated);
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

    // Advance to DETAILS_RETRIEVED if currently in DELIVERED
    if (request.status === "DELIVERED") {
      try {
        await updateTaktRequestStatus(id, "DETAILS_RETRIEVED", {
          detailsRetrievedAt: new Date(),
        });
      } catch (err) {
        if (!(err instanceof TaktRequestTransitionError)) {
          throw err;
        }
        // Already past this state — not an error
      }
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

    res.status(201).json(result);
  },
);

export default router;

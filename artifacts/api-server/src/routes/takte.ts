import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { takteTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { rescheduleTakte } from "../lib/reschedule";
import { z } from "zod";

const router = Router();

const EDITABLE_STATUSES = ["GEPLANT", "ABGELEHNT", "STORNIERT"] as const;

function isTaktEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/** Remove GU-internal fields from a Takt row when the caller is not an AG. */
function redactInternalFields(
  takt: Record<string, unknown>,
  orgType: "AG" | "AN" | null | undefined,
): Record<string, unknown> {
  if (orgType === "AG") return takt;
  // Strip every GU-internal column — this list must stay in sync with
  // docs/data-ownership.md § "GU-internal fields".
  const { internalNote, costEstimate, procurementPriority, riskClassification, ...rest } = takt as {
    internalNote: unknown; costEstimate: unknown;
    procurementPriority: unknown; riskClassification: unknown;
    [k: string]: unknown;
  };
  void internalNote; void costEstimate; void procurementPriority; void riskClassification;
  return rest;
}

/**
 * Verify the calling AG owns the project.
 * Returns the project row on success, null (and sends 403/404) on failure.
 * Caller must return early when null is returned.
 */
async function requireProjectOwner(
  req: Request,
  res: Response,
  projectId: string,
): Promise<{ id: string; agOrgId: string } | null> {
  const caller = req.user!;

  if (caller.orgType !== "AG" || !caller.orgId) {
    res.status(403).json({ error: "Forbidden: only AG organisations may access Takt data" });
    return null;
  }

  const [project] = await db
    .select({ id: projectsTable.id, agOrgId: projectsTable.agOrgId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }

  if (project.agOrgId !== caller.orgId) {
    // Return 404 (not 403) to avoid leaking existence of other organisations' projects
    res.status(404).json({ error: "Project not found" });
    return null;
  }

  return project;
}

// ── GET /projects/:projectId/takte ─────────────────────────────────────────────
router.get(
  "/projects/:projectId/takte",
  requireJwt,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const projectId = req.params.projectId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    const takte = await db
      .select()
      .from(takteTable)
      .where(eq(takteTable.projectId, projectId))
      .orderBy(takteTable.taktBezeichnung);

    res.json(takte.map(t => redactInternalFields(t as Record<string, unknown>, caller.orgType)));
  },
);

// ── POST /projects/:projectId/takte ────────────────────────────────────────────
router.post(
  "/projects/:projectId/takte",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    const schema = z.object({
      taktBezeichnung: z.string().min(1),
      zone: z.string().min(1),
      gewerk: z.string().min(1),
      description: z.string().optional(),
      plannedStart: z.string(),
      plannedEnd: z.string(),
      earliestStart: z.string().optional(),
      latestEnd: z.string().optional(),
      lvReference: z.string().optional(),
      bimReference: z.string().optional(),
      requiredResources: z.string().optional(),
      // ── GU-internal fields — never released to NU via snapshot ────────────
      internalNote: z.string().optional(),
      costEstimate: z.string().optional(),
      procurementPriority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
      riskClassification: z.enum(["A", "B", "C"]).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [takt] = await db
      .insert(takteTable)
      .values({ ...parsed.data, projectId, status: "GEPLANT" })
      .returning();

    res.status(201).json(takt);
  },
);

// ── GET /projects/:projectId/takte/:taktId ─────────────────────────────────────
router.get(
  "/projects/:projectId/takte/:taktId",
  requireJwt,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const projectId = req.params.projectId as string;
    const taktId = req.params.taktId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    const [takt] = await db
      .select()
      .from(takteTable)
      .where(
        and(
          eq(takteTable.id, taktId),
          eq(takteTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!takt) {
      res.status(404).json({ error: "Takt not found" });
      return;
    }

    res.json(redactInternalFields(takt as Record<string, unknown>, caller.orgType));
  },
);

// ── PATCH /projects/:projectId/takte/:taktId ──────────────────────────────────
router.patch(
  "/projects/:projectId/takte/:taktId",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;
    const taktId = req.params.taktId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    // Load takt constrained to BOTH taktId AND projectId to prevent cross-project access
    const [existing] = await db
      .select()
      .from(takteTable)
      .where(
        and(
          eq(takteTable.id, taktId),
          eq(takteTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Takt not found" });
      return;
    }

    if (!isTaktEditable(existing.status)) {
      res.status(409).json({
        error: "Takt cannot be edited in its current status",
        status: existing.status,
      });
      return;
    }

    const schema = z.object({
      taktBezeichnung: z.string().min(1).optional(),
      zone: z.string().min(1).optional(),
      gewerk: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      plannedStart: z.string().optional(),
      plannedEnd: z.string().optional(),
      earliestStart: z.string().optional().nullable(),
      latestEnd: z.string().optional().nullable(),
      lvReference: z.string().optional().nullable(),
      bimReference: z.string().optional().nullable(),
      requiredResources: z.string().optional().nullable(),
      // ── GU-internal fields — never released to NU via snapshot ────────────
      internalNote: z.string().optional().nullable(),
      costEstimate: z.string().optional().nullable(),
      procurementPriority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().nullable(),
      riskClassification: z.enum(["A", "B", "C"]).optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Update takt + cascade-reschedule inside a single transaction
    const result = await db.transaction(async (tx) => {
      const [takt] = await tx
        .update(takteTable)
        .set(parsed.data)
        .where(
          and(
            eq(takteTable.id, taktId),
            eq(takteTable.projectId, projectId),
          ),
        )
        .returning();

      const { moved, conflicts } = await rescheduleTakte(projectId, tx);
      return { takt, moved, conflicts };
    });

    res.json(result);
  },
);

// ── DELETE /projects/:projectId/takte/:taktId ─────────────────────────────────
router.delete(
  "/projects/:projectId/takte/:taktId",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;
    const taktId = req.params.taktId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    const [existing] = await db
      .select()
      .from(takteTable)
      .where(
        and(
          eq(takteTable.id, taktId),
          eq(takteTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Takt not found" });
      return;
    }

    if (!isTaktEditable(existing.status)) {
      res.status(409).json({
        error: "Takt cannot be deleted in its current status. Cancel the delegation first.",
        status: existing.status,
      });
      return;
    }

    await db
      .delete(takteTable)
      .where(
        and(
          eq(takteTable.id, taktId),
          eq(takteTable.projectId, projectId),
        ),
      );
    res.status(204).send();
  },
);

export default router;

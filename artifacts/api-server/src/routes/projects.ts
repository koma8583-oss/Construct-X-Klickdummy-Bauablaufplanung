import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  projectContractorsTable,
  organizationsTable,
  delegationsTable,
  delegationResponsesTable,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { z } from "zod";

const router = Router();

// ── Ownership helper ────────────────────────────────────────────────────────────
/**
 * Verify the calling AG organisation owns the project.
 *
 * - Non-AG callers (AN, Hub) → 403
 * - Unknown project or project owned by a different AG → 404
 *   (404 rather than 403 avoids leaking existence of other orgs' projects)
 *
 * Returns the project row on success, null (after sending the response) on failure.
 * Callers must return immediately when null is returned.
 */
async function requireProjectOwner(
  req: Request,
  res: Response,
  projectId: string,
): Promise<{ id: string; agOrgId: string; status: string } | null> {
  const caller = req.user!;

  if (caller.orgType !== "AG" || !caller.orgId) {
    res.status(403).json({ error: "Forbidden: only AG organisations may manage projects" });
    return null;
  }

  const [project] = await db
    .select({ id: projectsTable.id, agOrgId: projectsTable.agOrgId, status: projectsTable.status })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }

  if (project.agOrgId !== caller.orgId) {
    // 404 — do not reveal that the project exists under a different org
    res.status(404).json({ error: "Project not found" });
    return null;
  }

  return project;
}

// ── GET /projects ───────────────────────────────────────────────────────────────
router.get("/projects", requireJwt, async (req, res): Promise<void> => {
  const caller = req.user!;
  if (caller.orgType !== "AG" || !caller.orgId) {
    res.status(403).json({ error: "Forbidden: only AG organisations may list projects" });
    return;
  }

  const orgId = caller.orgId;
  const status = req.query.status as string | undefined;

  let query = db
    .select({ project: projectsTable })
    .from(projectsTable)
    .where(eq(projectsTable.agOrgId, orgId))
    .$dynamic();

  if (status) {
    query = query.where(
      and(
        eq(projectsTable.agOrgId, orgId),
        eq(projectsTable.status, status as "ACTIVE" | "COMPLETED" | "ARCHIVED"),
      ),
    );
  }

  const rows = await query;

  const projectsWithCounts = await Promise.all(
    rows.map(async ({ project }) => {
      const [delCount] = await db
        .select({ count: count() })
        .from(delegationsTable)
        .where(eq(delegationsTable.projectId, project.id));

      const [pendingCount] = await db
        .select({ count: count() })
        .from(delegationResponsesTable)
        .innerJoin(
          delegationsTable,
          eq(delegationResponsesTable.delegationId, delegationsTable.id),
        )
        .where(
          and(
            eq(delegationsTable.projectId, project.id),
            eq(delegationResponsesTable.agDecision, "PENDING"),
          ),
        );

      return {
        ...project,
        taktCount: 0,
        delegationCount: delCount?.count ?? 0,
        pendingResponseCount: pendingCount?.count ?? 0,
      };
    }),
  );

  res.json(projectsWithCounts);
});

// ── POST /projects ──────────────────────────────────────────────────────────────
router.post("/projects", requireJwt, async (req, res): Promise<void> => {
  const caller = req.user!;
  if (caller.orgType !== "AG" || !caller.orgId) {
    res.status(403).json({ error: "Forbidden: only AG organisations may create projects" });
    return;
  }

  const schema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    location: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, agOrgId: caller.orgId })
    .returning();

  res.status(201).json({ ...project, taktCount: 0, delegationCount: 0, pendingResponseCount: 0 });
});

// ── GET /projects/:projectId ────────────────────────────────────────────────────
router.get(
  "/projects/:projectId",
  requireJwt,
  async (req, res): Promise<void> => {
    const project = await requireProjectOwner(req, res, req.params.projectId as string);
    if (!project) return;

    const [delCount] = await db
      .select({ count: count() })
      .from(delegationsTable)
      .where(eq(delegationsTable.projectId, project.id));

    const [pendingCount] = await db
      .select({ count: count() })
      .from(delegationResponsesTable)
      .innerJoin(
        delegationsTable,
        eq(delegationResponsesTable.delegationId, delegationsTable.id),
      )
      .where(
        and(
          eq(delegationsTable.projectId, project.id),
          eq(delegationResponsesTable.agDecision, "PENDING"),
        ),
      );

    // Re-fetch full row so the response includes all columns
    const [full] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, project.id))
      .limit(1);

    res.json({
      ...full,
      taktCount: 0,
      delegationCount: delCount?.count ?? 0,
      pendingResponseCount: pendingCount?.count ?? 0,
    });
  },
);

// ── PATCH /projects/:projectId ──────────────────────────────────────────────────
router.patch(
  "/projects/:projectId",
  requireJwt,
  async (req, res): Promise<void> => {
    const project = await requireProjectOwner(req, res, req.params.projectId as string);
    if (!project) return;

    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [updated] = await db
      .update(projectsTable)
      .set(parsed.data)
      .where(eq(projectsTable.id, project.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json({ ...updated, taktCount: 0, delegationCount: 0, pendingResponseCount: 0 });
  },
);

// ── DELETE /projects/:projectId ─────────────────────────────────────────────────
// Soft-delete: transitions status to ARCHIVED so historical TaktRequests
// that reference this project row are not orphaned.
router.delete(
  "/projects/:projectId",
  requireJwt,
  async (req, res): Promise<void> => {
    const project = await requireProjectOwner(req, res, req.params.projectId as string);
    if (!project) return;

    await db
      .update(projectsTable)
      .set({ status: "ARCHIVED" })
      .where(eq(projectsTable.id, project.id));

    res.status(200).json({ ok: true, status: "ARCHIVED" });
  },
);

// ── GET /projects/:projectId/contractors ────────────────────────────────────────
router.get(
  "/projects/:projectId/contractors",
  requireJwt,
  async (req, res): Promise<void> => {
    const project = await requireProjectOwner(req, res, req.params.projectId as string);
    if (!project) return;

    const contractors = await db
      .select({ org: organizationsTable })
      .from(projectContractorsTable)
      .innerJoin(
        organizationsTable,
        eq(projectContractorsTable.anOrgId, organizationsTable.id),
      )
      .where(eq(projectContractorsTable.projectId, project.id));

    res.json(contractors.map((c) => c.org));
  },
);

// ── POST /projects/:projectId/contractors ───────────────────────────────────────
// Legacy endpoint — use POST /ag/projects/:projectId/subcontractors for full control.
// Kept for backward compatibility; creates an ACTIVE assignment with no trade.
router.post(
  "/projects/:projectId/contractors",
  requireJwt,
  async (req, res): Promise<void> => {
    const project = await requireProjectOwner(req, res, req.params.projectId as string);
    if (!project) return;

    const { anOrgId } = req.body as { anOrgId: string };
    if (!anOrgId) {
      res.status(400).json({ error: "anOrgId required" });
      return;
    }

    try {
      await db
        .insert(projectContractorsTable)
        .values({ projectId: project.id, anOrgId })
        .onConflictDoNothing();
    } catch {
      // Unique index violation on the trade-aware index — silently ignore
    }

    res.status(201).json({ ok: true });
  },
);

// ── DELETE /projects/:projectId/contractors/:anOrgId ───────────────────────────
// Soft-delete: transitions assignmentStatus to INACTIVE so historical
// TaktRequests that reference this contractor row are not orphaned.
router.delete(
  "/projects/:projectId/contractors/:anOrgId",
  requireJwt,
  async (req, res): Promise<void> => {
    const project = await requireProjectOwner(req, res, req.params.projectId as string);
    if (!project) return;

    const anOrgId = req.params.anOrgId as string;

    // Soft-delete all ACTIVE assignments for this AN on this project
    const updated = await db
      .update(projectContractorsTable)
      .set({ assignmentStatus: "INACTIVE" })
      .where(
        and(
          eq(projectContractorsTable.projectId, project.id),
          eq(projectContractorsTable.anOrgId, anOrgId),
          eq(projectContractorsTable.assignmentStatus, "ACTIVE"),
        ),
      )
      .returning();

    if (updated.length === 0) {
      // No active assignment found — treat as 404 (already removed or never existed)
      res.status(404).json({ error: "No active contractor assignment found" });
      return;
    }

    res.status(200).json({ ok: true, deactivated: updated.length });
  },
);

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import {
  taktDependenciesTable,
  takteTable,
  projectsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { wouldCreateCycle, rescheduleTakte } from "../lib/reschedule";
import { z } from "zod";

const router = Router();

// ── GET /projects/:projectId/takt-dependencies ──────────────────────────────
router.get(
  "/projects/:projectId/takt-dependencies",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.agOrgId !== req.user!.orgId!) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Load deps with predecessor info; enrich successors from takte list
    const rows = await db
      .select({
        dep: taktDependenciesTable,
        predecessor: takteTable,
      })
      .from(taktDependenciesTable)
      .innerJoin(
        takteTable,
        eq(taktDependenciesTable.predecessorId, takteTable.id),
      )
      .where(eq(taktDependenciesTable.projectId, projectId));

    const allTakte = await db
      .select()
      .from(takteTable)
      .where(eq(takteTable.projectId, projectId));

    const taktMap = new Map(allTakte.map((t) => [t.id, t]));

    res.json(
      rows.map(({ dep, predecessor }) => ({
        ...dep,
        predecessor,
        successor: taktMap.get(dep.successorId) ?? null,
      })),
    );
  },
);

// ── POST /projects/:projectId/takt-dependencies ─────────────────────────────
router.post(
  "/projects/:projectId/takt-dependencies",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;

    const schema = z.object({
      predecessorId: z.string(),
      successorId: z.string(),
      type: z.enum(["EA", "AA", "EE"]).default("EA"),
      lagDays: z.number().int().min(0).default(0),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { predecessorId, successorId, type, lagDays } = parsed.data;

    // Authorization
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.agOrgId !== req.user!.orgId!) {
      res.status(403).json({ error: "Only the AG organisation may manage dependencies" });
      return;
    }

    // Both takte must belong to this project
    const [pred] = await db
      .select()
      .from(takteTable)
      .where(and(eq(takteTable.id, predecessorId), eq(takteTable.projectId, projectId)))
      .limit(1);

    const [succ] = await db
      .select()
      .from(takteTable)
      .where(and(eq(takteTable.id, successorId), eq(takteTable.projectId, projectId)))
      .limit(1);

    if (!pred || !succ) {
      res.status(404).json({ error: "One or both Takte not found in this project" });
      return;
    }

    // Cycle check
    const existing = await db
      .select({
        predecessorId: taktDependenciesTable.predecessorId,
        successorId: taktDependenciesTable.successorId,
      })
      .from(taktDependenciesTable)
      .where(eq(taktDependenciesTable.projectId, projectId));

    if (wouldCreateCycle(existing, predecessorId, successorId)) {
      res.status(409).json({ error: "Diese Abhängigkeit würde einen Zirkel erzeugen" });
      return;
    }

    // Insert + reschedule atomically
    const result = await db.transaction(async (tx) => {
      const [dep] = await tx
        .insert(taktDependenciesTable)
        .values({ projectId, predecessorId, successorId, type, lagDays })
        .returning();

      const { moved, conflicts } = await rescheduleTakte(projectId, tx);
      return { dependency: { ...dep, predecessor: pred, successor: succ }, moved, conflicts };
    });

    res.status(201).json(result);
  },
);

// ── DELETE /projects/:projectId/takt-dependencies/:depId ─────────────────────
router.delete(
  "/projects/:projectId/takt-dependencies/:depId",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;
    const depId = req.params.depId as string;

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project || project.agOrgId !== req.user!.orgId!) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [existing] = await db
      .select()
      .from(taktDependenciesTable)
      .where(
        and(
          eq(taktDependenciesTable.id, depId),
          eq(taktDependenciesTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Dependency not found" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      await tx.delete(taktDependenciesTable).where(eq(taktDependenciesTable.id, depId));
      const { moved, conflicts } = await rescheduleTakte(projectId, tx);
      return { moved, conflicts };
    });

    res.json(result);
  },
);

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  projectContractorsTable,
  organizationsTable,
  delegationsTable,
  delegationResponsesTable,
} from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";

const router = Router();

// GET /projects
router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const orgId = req.session!.orgId!;
  const status = req.query.status as string | undefined;

  let query = db
    .select({
      project: projectsTable,
    })
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

  // Enrich with counts
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

// POST /projects
router.post("/projects", requireAuth, async (req, res): Promise<void> => {
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
    .values({ ...parsed.data, agOrgId: req.session!.orgId! })
    .returning();

  res.status(201).json({ ...project, taktCount: 0, delegationCount: 0, pendingResponseCount: 0 });
});

// GET /projects/:projectId
router.get(
  "/projects/:projectId",
  requireAuth,
  async (req, res): Promise<void> => {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, (req.params.projectId as string)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

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

    res.json({
      ...project,
      taktCount: 0,
      delegationCount: delCount?.count ?? 0,
      pendingResponseCount: pendingCount?.count ?? 0,
    });
  },
);

// PATCH /projects/:projectId
router.patch(
  "/projects/:projectId",
  requireAuth,
  async (req, res): Promise<void> => {
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

    const [project] = await db
      .update(projectsTable)
      .set(parsed.data)
      .where(eq(projectsTable.id, (req.params.projectId as string)))
      .returning();

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json({ ...project, taktCount: 0, delegationCount: 0, pendingResponseCount: 0 });
  },
);

// DELETE /projects/:projectId
router.delete(
  "/projects/:projectId",
  requireAuth,
  async (req, res): Promise<void> => {
    await db
      .delete(projectsTable)
      .where(eq(projectsTable.id, (req.params.projectId as string)));
    res.status(204).send();
  },
);

// GET /projects/:projectId/contractors
router.get(
  "/projects/:projectId/contractors",
  requireAuth,
  async (req, res): Promise<void> => {
    const contractors = await db
      .select({ org: organizationsTable })
      .from(projectContractorsTable)
      .innerJoin(
        organizationsTable,
        eq(projectContractorsTable.anOrgId, organizationsTable.id),
      )
      .where(eq(projectContractorsTable.projectId, (req.params.projectId as string)));

    res.json(contractors.map((c) => c.org));
  },
);

// POST /projects/:projectId/contractors
router.post(
  "/projects/:projectId/contractors",
  requireAuth,
  async (req, res): Promise<void> => {
    const { anOrgId } = req.body as { anOrgId: string };

    if (!anOrgId) {
      res.status(400).json({ error: "anOrgId required" });
      return;
    }

    await db
      .insert(projectContractorsTable)
      .values({ projectId: (req.params.projectId as string), anOrgId })
      .onConflictDoNothing();

    res.status(201).json({ ok: true });
  },
);

// DELETE /projects/:projectId/contractors/:anOrgId
router.delete(
  "/projects/:projectId/contractors/:anOrgId",
  requireAuth,
  async (req, res): Promise<void> => {
    await db
      .delete(projectContractorsTable)
      .where(
        and(
          eq(projectContractorsTable.projectId, (req.params.projectId as string)),
          eq(projectContractorsTable.anOrgId, (req.params.anOrgId as string)),
        ),
      );
    res.status(204).send();
  },
);

export default router;

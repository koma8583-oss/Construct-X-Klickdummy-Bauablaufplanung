import { Router } from "express";
import { db } from "@workspace/db";
import { takteTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";

const router = Router();

const EDITABLE_STATUSES = ["GEPLANT", "ABGELEHNT", "STORNIERT"] as const;

function isTaktEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

// GET /projects/:projectId/takte
router.get(
  "/projects/:projectId/takte",
  requireAuth,
  async (req, res): Promise<void> => {
    const takte = await db
      .select()
      .from(takteTable)
      .where(eq(takteTable.projectId, req.params.projectId as string))
      .orderBy(takteTable.taktBezeichnung);

    res.json(takte);
  },
);

// POST /projects/:projectId/takte
router.post(
  "/projects/:projectId/takte",
  requireAuth,
  async (req, res): Promise<void> => {
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
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [takt] = await db
      .insert(takteTable)
      .values({ ...parsed.data, projectId: req.params.projectId as string, status: "GEPLANT" })
      .returning();

    res.status(201).json(takt);
  },
);

// GET /projects/:projectId/takte/:taktId
router.get(
  "/projects/:projectId/takte/:taktId",
  requireAuth,
  async (req, res): Promise<void> => {
    const [takt] = await db
      .select()
      .from(takteTable)
      .where(
        and(
          eq(takteTable.id, req.params.taktId as string),
          eq(takteTable.projectId, req.params.projectId as string),
        ),
      )
      .limit(1);

    if (!takt) {
      res.status(404).json({ error: "Takt not found" });
      return;
    }

    res.json(takt);
  },
);

// PATCH /projects/:projectId/takte/:taktId
router.patch(
  "/projects/:projectId/takte/:taktId",
  requireAuth,
  async (req, res): Promise<void> => {
    // Load takt to check editability
    const [existing] = await db
      .select()
      .from(takteTable)
      .where(eq(takteTable.id, req.params.taktId as string))
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
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [takt] = await db
      .update(takteTable)
      .set(parsed.data)
      .where(eq(takteTable.id, req.params.taktId as string))
      .returning();

    res.json(takt);
  },
);

// DELETE /projects/:projectId/takte/:taktId
router.delete(
  "/projects/:projectId/takte/:taktId",
  requireAuth,
  async (req, res): Promise<void> => {
    await db
      .delete(takteTable)
      .where(eq(takteTable.id, req.params.taktId as string));
    res.status(204).send();
  },
);

export default router;

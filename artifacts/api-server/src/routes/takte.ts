import { Router } from "express";
import { db } from "@workspace/db";
import { takteTable, delegationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";

const router = Router();

// GET /projects/:projectId/takte
router.get(
  "/projects/:projectId/takte",
  requireAuth,
  async (req, res): Promise<void> => {
    const takte = await db
      .select()
      .from(takteTable)
      .where(eq(takteTable.projectId, (req.params.projectId as string)))
      .orderBy(takteTable.taktNumber);

    // Enrich with delegation status
    const enriched = await Promise.all(
      takte.map(async (takt) => {
        const [delegation] = await db
          .select({ status: delegationsTable.status })
          .from(delegationsTable)
          .where(eq(delegationsTable.taktId, takt.id))
          .orderBy(delegationsTable.createdAt)
          .limit(1);

        return {
          ...takt,
          delegationStatus: delegation?.status
            ? mapDelegationStatus(delegation.status)
            : "UNDELEGATED",
        };
      }),
    );

    res.json(enriched);
  },
);

function mapDelegationStatus(status: string): string {
  return status === "CANCELLED" ? "UNDELEGATED" : status;
}

// POST /projects/:projectId/takte
router.post(
  "/projects/:projectId/takte",
  requireAuth,
  async (req, res): Promise<void> => {
    const schema = z.object({
      taktNumber: z.number().int().positive(),
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
      .values({ ...parsed.data, projectId: (req.params.projectId as string) })
      .returning();

    res.status(201).json({ ...takt, delegationStatus: "UNDELEGATED" });
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
          eq(takteTable.id, (req.params.taktId as string)),
          eq(takteTable.projectId, (req.params.projectId as string)),
        ),
      )
      .limit(1);

    if (!takt) {
      res.status(404).json({ error: "Takt not found" });
      return;
    }

    res.json({ ...takt, delegationStatus: "UNDELEGATED" });
  },
);

// PATCH /projects/:projectId/takte/:taktId
router.patch(
  "/projects/:projectId/takte/:taktId",
  requireAuth,
  async (req, res): Promise<void> => {
    const schema = z.object({
      taktNumber: z.number().int().positive().optional(),
      zone: z.string().min(1).optional(),
      gewerk: z.string().min(1).optional(),
      description: z.string().optional(),
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
      .where(eq(takteTable.id, (req.params.taktId as string)))
      .returning();

    if (!takt) {
      res.status(404).json({ error: "Takt not found" });
      return;
    }

    res.json({ ...takt, delegationStatus: "UNDELEGATED" });
  },
);

// DELETE /projects/:projectId/takte/:taktId
router.delete(
  "/projects/:projectId/takte/:taktId",
  requireAuth,
  async (req, res): Promise<void> => {
    await db
      .delete(takteTable)
      .where(eq(takteTable.id, (req.params.taktId as string)));
    res.status(204).send();
  },
);

export default router;

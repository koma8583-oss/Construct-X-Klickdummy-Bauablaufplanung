import { Router } from "express";
import { db } from "@workspace/db";
import {
  resourcesTable,
  resourceAssignmentsTable,
  delegationsTable,
  takteTable,
  organizationsTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { z } from "zod";

const router = Router();

// GET /resources
router.get("/resources", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;
  const type = req.query.type as string | undefined;

  let query = db
    .select()
    .from(resourcesTable)
    .where(eq(resourcesTable.anOrgId, orgId))
    .$dynamic();

  if (type) {
    query = query.where(
      and(
        eq(resourcesTable.anOrgId, orgId),
        eq(
          resourcesTable.type,
          type as "EMPLOYEE" | "EQUIPMENT" | "MACHINE" | "OTHER",
        ),
      ),
    );
  }

  const resources = await query;
  res.json(resources);
});

// POST /resources
router.post("/resources", requireJwt, async (req, res): Promise<void> => {
  const schema = z.object({
    type: z.enum(["EMPLOYEE", "EQUIPMENT", "MACHINE", "OTHER"]),
    name: z.string().min(1),
    qualification: z.string().optional(),
    dailyCapacityHours: z.number().optional(),
    color: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [resource] = await db
    .insert(resourcesTable)
    .values({ ...parsed.data, anOrgId: req.user!.orgId! })
    .returning();

  res.status(201).json(resource);
});

// PATCH /resources/:resourceId
router.patch(
  "/resources/:resourceId",
  requireJwt,
  async (req, res): Promise<void> => {
    const schema = z.object({
      type: z.enum(["EMPLOYEE", "EQUIPMENT", "MACHINE", "OTHER"]).optional(),
      name: z.string().min(1).optional(),
      qualification: z.string().optional(),
      dailyCapacityHours: z.number().optional(),
      color: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [resource] = await db
      .update(resourcesTable)
      .set(parsed.data)
      .where(eq(resourcesTable.id, (req.params.resourceId as string)))
      .returning();

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    res.json(resource);
  },
);

// DELETE /resources/:resourceId
router.delete(
  "/resources/:resourceId",
  requireJwt,
  async (req, res): Promise<void> => {
    await db
      .delete(resourcesTable)
      .where(eq(resourcesTable.id, (req.params.resourceId as string)));
    res.status(204).send();
  },
);

// GET /resource-assignments
router.get(
  "/resource-assignments",
  requireJwt,
  async (req, res): Promise<void> => {
    const { delegationId, resourceId, from, to } = req.query as Record<
      string,
      string
    >;

    const assignments = await db
      .select({
        assignment: resourceAssignmentsTable,
        resource: resourcesTable,
        delegation: delegationsTable,
      })
      .from(resourceAssignmentsTable)
      .innerJoin(
        resourcesTable,
        eq(resourceAssignmentsTable.resourceId, resourcesTable.id),
      )
      .innerJoin(
        delegationsTable,
        eq(resourceAssignmentsTable.delegationId, delegationsTable.id),
      )
      .where(
        and(
          delegationId
            ? eq(resourceAssignmentsTable.delegationId, delegationId)
            : undefined,
          resourceId
            ? eq(resourceAssignmentsTable.resourceId, resourceId)
            : undefined,
          from ? gte(resourceAssignmentsTable.fromDate, from) : undefined,
          to ? lte(resourceAssignmentsTable.toDate, to) : undefined,
        ),
      );

    res.json(
      assignments.map(({ assignment, resource, delegation }) => ({
        ...assignment,
        resource,
        delegation,
      })),
    );
  },
);

// POST /resource-assignments
router.post(
  "/resource-assignments",
  requireJwt,
  async (req, res): Promise<void> => {
    const schema = z.object({
      resourceId: z.string(),
      delegationId: z.string(),
      fromDate: z.string(),
      toDate: z.string(),
      note: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [assignment] = await db
      .insert(resourceAssignmentsTable)
      .values(parsed.data)
      .returning();

    res.status(201).json(assignment);
  },
);

// PATCH /resource-assignments/:assignmentId
router.patch(
  "/resource-assignments/:assignmentId",
  requireJwt,
  async (req, res): Promise<void> => {
    const schema = z.object({
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
      note: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [assignment] = await db
      .update(resourceAssignmentsTable)
      .set(parsed.data)
      .where(eq(resourceAssignmentsTable.id, (req.params.assignmentId as string)))
      .returning();

    if (!assignment) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    res.json(assignment);
  },
);

// DELETE /resource-assignments/:assignmentId
router.delete(
  "/resource-assignments/:assignmentId",
  requireJwt,
  async (req, res): Promise<void> => {
    await db
      .delete(resourceAssignmentsTable)
      .where(eq(resourceAssignmentsTable.id, (req.params.assignmentId as string)));
    res.status(204).send();
  },
);

export default router;

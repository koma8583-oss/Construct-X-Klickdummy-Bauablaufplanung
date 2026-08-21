import { Router } from "express";
import { db } from "@workspace/db";
import {
  resourcesTable,
  resourceAssignmentsTable,
  resourceTypesTable,
  delegationsTable,
  taktRequestsTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { z } from "zod";

const router = Router();

function requireAnWrite(req: { user?: { orgType?: string | null; orgId?: string | null } }, res: { status: (code: number) => { json: (body: unknown) => unknown } }): boolean {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "Resource write access is restricted to NU organisations" });
    return false;
  }
  return true;
}

async function loadOwnResourceType(resourceTypeId: string, orgId: string) {
  const [resourceType] = await db
    .select()
    .from(resourceTypesTable)
    .where(and(eq(resourceTypesTable.id, resourceTypeId), eq(resourceTypesTable.anOrgId, orgId)))
    .limit(1);
  return resourceType ?? null;
}

// ── Helper: assert the resource belongs to the caller's org ──────────────────

async function loadOwnResource(
  resourceId: string,
  orgId: string,
): Promise<(typeof resourcesTable.$inferSelect) | null> {
  const [r] = await db
    .select()
    .from(resourcesTable)
    .where(
      and(
        eq(resourcesTable.id, resourceId),
        eq(resourcesTable.anOrgId, orgId),
      ),
    )
    .limit(1);
  return r ?? null;
}

// ── GET /resources ────────────────────────────────────────────────────────────

router.get("/resources", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;
  const type  = req.query.type as string | undefined;

  // Always scope to caller's org and only return active resources (soft-deleted are excluded)
  const conditions: Parameters<typeof and>[] = [
    eq(resourcesTable.anOrgId, orgId) as any,
    eq(resourcesTable.active, true) as any,
  ];

  if (type) {
    conditions.push(
      eq(resourcesTable.type, type as "EMPLOYEE" | "CREW" | "EQUIPMENT" | "MACHINE" | "OTHER") as any,
    );
  }

  const resources = await db
    .select()
    .from(resourcesTable)
    .where(and(...(conditions as [any, ...any[]])));

  res.json(resources);
});

// ── POST /resources ───────────────────────────────────────────────────────────

router.post("/resources", requireJwt, async (req, res): Promise<void> => {
  if (!requireAnWrite(req, res)) return;
  const orgId = req.user!.orgId!;
  const schema = z.object({
    type: z.enum(["EMPLOYEE", "CREW", "EQUIPMENT", "MACHINE", "OTHER"]).optional(),
    name: z.string().min(1),
    qualification:     z.string().optional(),
    dailyCapacityHours: z.number().optional(),
    color:             z.string().optional(),
    trade:             z.string().optional(),
    skills:            z.array(z.string()).optional(),
    qualifications:    z.array(z.string()).optional(),
    capacity:          z.number().positive().optional(),
    capacityUnit:      z.enum(["PERSONS", "UNITS", "HOURS_PER_DAY", "PERCENT"]).optional(),
    calendarId:        z.string().optional(),
    active:            z.boolean().optional(),
    resourceTypeId:    z.string().min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const resourceType = await loadOwnResourceType(parsed.data.resourceTypeId, orgId);
  if (!resourceType) {
    res.status(403).json({ error: "Resource type does not belong to your organisation" });
    return;
  }
  if (
    parsed.data.capacityUnit &&
    resourceType.capacityUnit &&
    parsed.data.capacityUnit !== resourceType.capacityUnit
  ) {
    res.status(422).json({ error: "capacityUnit must match the ResourceType" });
    return;
  }

  // Derive `type` from the linked ResourceType category when not explicitly supplied
  let resolvedType = parsed.data.type;
  if (!resolvedType) {
      const CAT_TO_TYPE: Record<string, "EMPLOYEE" | "CREW" | "EQUIPMENT" | "MACHINE" | "OTHER"> = {
        PERSONNEL: "EMPLOYEE",
        CREW: "CREW",
        EQUIPMENT: "EQUIPMENT",
        MACHINE: "MACHINE",
        OTHER: "OTHER",
      };
      resolvedType = CAT_TO_TYPE[resourceType.category] ?? "EMPLOYEE";
  }
  resolvedType ??= "EMPLOYEE";

  const [resource] = await db
    .insert(resourcesTable)
    .values({
      ...parsed.data,
      type: resolvedType,
      capacityUnit: resourceType.capacityUnit,
      anOrgId: orgId,
    })
    .returning();

  res.status(201).json(resource);
});

// ── PATCH /resources/:resourceId ──────────────────────────────────────────────

router.patch(
  "/resources/:resourceId",
  requireJwt,
  async (req, res): Promise<void> => {
    if (!requireAnWrite(req, res)) return;
    const orgId = req.user!.orgId!;
    const resourceId = req.params.resourceId as string;

    // Org-isolation check: resource must belong to caller's org
    const existing = await loadOwnResource(resourceId, orgId);
    if (!existing) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    const schema = z.object({
      type:              z.enum(["EMPLOYEE", "CREW", "EQUIPMENT", "MACHINE", "OTHER"]).optional(),
      name:              z.string().min(1).optional(),
      qualification:     z.string().optional(),
      dailyCapacityHours: z.number().optional(),
      color:             z.string().optional(),
      trade:             z.string().optional(),
      skills:            z.array(z.string()).optional(),
      qualifications:    z.array(z.string()).optional(),
      capacity:          z.number().positive().optional(),
      capacityUnit:      z.enum(["PERSONS", "UNITS", "HOURS_PER_DAY", "PERCENT"]).optional(),
      calendarId:        z.string().optional(),
      active:            z.boolean().optional(),
      resourceTypeId:    z.string().min(1).optional(),
    });

    if (req.body?.resourceTypeId === null) {
      res.status(422).json({ error: "RESOURCE_TYPE_REQUIRED" });
      return;
    }

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const nextResourceTypeId = parsed.data.resourceTypeId ?? existing.resourceTypeId;
    if (!nextResourceTypeId) {
      res.status(422).json({ error: "RESOURCE_TYPE_REQUIRED" });
      return;
    }
    const resourceType = nextResourceTypeId
      ? await loadOwnResourceType(nextResourceTypeId, orgId)
      : null;
    if (nextResourceTypeId && !resourceType) {
      res.status(403).json({ error: "Resource type does not belong to your organisation" });
      return;
    }
    if (
      parsed.data.capacityUnit &&
      resourceType?.capacityUnit &&
      parsed.data.capacityUnit !== resourceType.capacityUnit
    ) {
      res.status(422).json({ error: "capacityUnit must match the ResourceType" });
      return;
    }

    const categoryToType: Record<string, "EMPLOYEE" | "CREW" | "EQUIPMENT" | "MACHINE" | "OTHER"> = {
      PERSONNEL: "EMPLOYEE",
      CREW: "CREW",
      EQUIPMENT: "EQUIPMENT",
      MACHINE: "MACHINE",
      OTHER: "OTHER",
    };
    const [updated] = await db
      .update(resourcesTable)
      .set({
        ...parsed.data,
        resourceTypeId: nextResourceTypeId,
        capacityUnit: resourceType?.capacityUnit ?? existing.capacityUnit,
        ...(resourceType?.category ? { type: categoryToType[resourceType.category] ?? existing.type } : {}),
      })
      .where(
        and(
          eq(resourcesTable.id, resourceId),
          eq(resourcesTable.anOrgId, orgId), // double-lock: org must still match
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    res.json(updated);
  },
);

// ── DELETE /resources/:resourceId → soft-delete (active = false) ──────────────

router.delete(
  "/resources/:resourceId",
  requireJwt,
  async (req, res): Promise<void> => {
    if (!requireAnWrite(req, res)) return;
    const orgId = req.user!.orgId!;
    const resourceId = req.params.resourceId as string;

    // Org-isolation check
    const existing = await loadOwnResource(resourceId, orgId);
    if (!existing) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    // Soft-delete: set active = false; historical assignments remain readable
    await db
      .update(resourcesTable)
      .set({ active: false })
      .where(
        and(
          eq(resourcesTable.id, resourceId),
          eq(resourcesTable.anOrgId, orgId),
        ),
      );

    res.status(204).send();
  },
);

// ── GET /resource-assignments ─────────────────────────────────────────────────

router.get(
  "/resource-assignments",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;
    const { delegationId, resourceId, from, to } = req.query as Record<string, string>;

    // Scope to caller's org via resource ownership
    const assignments = await db
      .select({
        assignment: resourceAssignmentsTable,
        resource:   resourcesTable,
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
          // Org isolation: only own-org resources
          eq(resourcesTable.anOrgId, orgId),
          // Exclude soft-deleted assignments from default listing
          eq(resourceAssignmentsTable.active, true),
          delegationId ? eq(resourceAssignmentsTable.delegationId, delegationId) : undefined,
          resourceId   ? eq(resourceAssignmentsTable.resourceId, resourceId)     : undefined,
          from         ? gte(resourceAssignmentsTable.fromDate, from)             : undefined,
          to           ? lte(resourceAssignmentsTable.toDate, to)                 : undefined,
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

// ── POST /resource-assignments ────────────────────────────────────────────────

router.post(
  "/resource-assignments",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;

    const schema = z.object({
      resourceId:   z.string(),
      delegationId: z.string(),
      fromDate:     z.string(),
      toDate:       z.string(),
      note:         z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Rule 1: resource must belong to caller's org and must be active (not soft-deleted)
    const resource = await loadOwnResource(parsed.data.resourceId, orgId);
    if (!resource) {
      res.status(403).json({ error: "Resource does not belong to your organisation" });
      return;
    }
    if (!resource.active) {
      res.status(422).json({ error: "Cannot assign a deactivated resource" });
      return;
    }

    // Rule 2: delegation (or takt-request) must be addressed to caller's org
    const [delegation] = await db
      .select({ id: delegationsTable.id, anOrgId: delegationsTable.anOrgId })
      .from(delegationsTable)
      .where(eq(delegationsTable.id, parsed.data.delegationId))
      .limit(1);

    if (!delegation) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    if (delegation.anOrgId !== orgId) {
      res.status(403).json({ error: "Delegation is not addressed to your organisation" });
      return;
    }

    const [assignment] = await db
      .insert(resourceAssignmentsTable)
      .values(parsed.data)
      .returning();

    res.status(201).json(assignment);
  },
);

// ── PATCH /resource-assignments/:assignmentId ─────────────────────────────────

router.patch(
  "/resource-assignments/:assignmentId",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;
    const assignmentId = req.params.assignmentId as string;

    // Org-isolation: load assignment and verify resource ownership
    const [existing] = await db
      .select({
        assignment: resourceAssignmentsTable,
        resource:   resourcesTable,
      })
      .from(resourceAssignmentsTable)
      .innerJoin(
        resourcesTable,
        eq(resourceAssignmentsTable.resourceId, resourcesTable.id),
      )
      .where(
        and(
          eq(resourceAssignmentsTable.id, assignmentId),
          eq(resourcesTable.anOrgId, orgId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    const schema = z.object({
      fromDate: z.string().optional(),
      toDate:   z.string().optional(),
      note:     z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [updated] = await db
      .update(resourceAssignmentsTable)
      .set(parsed.data)
      .where(eq(resourceAssignmentsTable.id, assignmentId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    res.json(updated);
  },
);

// ── DELETE /resource-assignments/:assignmentId → soft-delete (status=CANCELLED) ─

router.delete(
  "/resource-assignments/:assignmentId",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;
    const assignmentId = req.params.assignmentId as string;

    // Org-isolation: verify resource belongs to caller's org
    const [existing] = await db
      .select({ id: resourceAssignmentsTable.id })
      .from(resourceAssignmentsTable)
      .innerJoin(
        resourcesTable,
        eq(resourceAssignmentsTable.resourceId, resourcesTable.id),
      )
      .where(
        and(
          eq(resourceAssignmentsTable.id, assignmentId),
          eq(resourcesTable.anOrgId, orgId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    // Soft-delete: mark as inactive so historical record remains readable
    await db
      .update(resourceAssignmentsTable)
      .set({ active: false })
      .where(eq(resourceAssignmentsTable.id, assignmentId));

    res.status(204).send();
  },
);

export default router;

import { Router } from "express";
import { anDb as db } from "@workspace/db";
import {
  resourcesTable,
  resourceTypesTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { z } from "zod";
import {
  deriveResourceFieldsFromType,
  loadOwnedResource,
  validateResourceTypeForOrg,
} from "../services/resource-domain-service";

const router = Router();

function requireAnWrite(req: { user?: { orgType?: string | null; orgId?: string | null } }, res: { status: (code: number) => { json: (body: unknown) => unknown } }): boolean {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "Resource write access is restricted to NU organisations" });
    return false;
  }
  return true;
}

function requireAnAccess(req: { user?: { orgType?: string | null; orgId?: string | null } }, res: { status: (code: number) => { json: (body: unknown) => unknown } }): boolean {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "Resource access is restricted to NU organisations" });
    return false;
  }
  return true;
}

// ── GET /resources ────────────────────────────────────────────────────────────

router.get("/resources", requireJwt, async (req, res): Promise<void> => {
  if (!requireAnAccess(req, res)) return;
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
    resourceTypeId:    z.string().min(1).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let resolvedType = parsed.data.type;
  let resolvedCapacityUnit = parsed.data.capacityUnit;

  // When a resourceTypeId is provided, validate ownership and derive fields from it
  if (parsed.data.resourceTypeId) {
    let resourceType;
    try {
      resourceType = await validateResourceTypeForOrg(parsed.data.resourceTypeId, orgId);
    } catch (error) {
      res.status(403).json({ error: (error as Error).message });
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
    const derivedFields = deriveResourceFieldsFromType(resourceType);
    resolvedType = derivedFields.type;
    resolvedCapacityUnit = derivedFields.capacityUnit ?? parsed.data.capacityUnit;
  }

  // type must be determinable either directly or via resourceTypeId
  if (!resolvedType) {
    res.status(400).json({ error: "Either 'type' or 'resourceTypeId' must be provided" });
    return;
  }

  const [resource] = await db
    .insert(resourcesTable)
    .values({
      ...parsed.data,
      type: resolvedType,
      capacityUnit: resolvedCapacityUnit,
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
    const existing = await loadOwnedResource(resourceId, orgId);
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

    // Determine which resourceTypeId to use (from body, or fall back to existing row)
    const nextResourceTypeId = parsed.data.resourceTypeId ?? existing.resourceTypeId ?? null;

    // Build the update payload
    let updatePayload: Record<string, unknown> = { ...parsed.data };

    if (nextResourceTypeId) {
      // resourceTypeId is known — validate and derive fields
      let resourceType;
      try {
        resourceType = await validateResourceTypeForOrg(nextResourceTypeId, orgId);
      } catch (error) {
        res.status(403).json({ error: (error as Error).message });
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
      const derivedFields = deriveResourceFieldsFromType(resourceType);
      updatePayload = {
        ...updatePayload,
        resourceTypeId: nextResourceTypeId,
        capacityUnit: derivedFields.capacityUnit,
        type: derivedFields.type,
      };
    }
    // If no resourceTypeId at all, just apply the partial fields as-is
    // (type and capacityUnit stay whatever is already on the row unless explicitly patched)

    const [updated] = await db
      .update(resourcesTable)
      .set(updatePayload)
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
    const existing = await loadOwnedResource(resourceId, orgId);
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

export default router;

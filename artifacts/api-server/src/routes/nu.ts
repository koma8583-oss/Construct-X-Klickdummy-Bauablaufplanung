/**
 * Task 4.4 — NU-internal REST APIs for local projects and resource bookings.
 *
 * All endpoints under /api/nu/* are AN-only.
 * GU users (orgType === "AG") and hub admins receive 403.
 * nuOrgId is always derived from req.user.orgId — clients cannot supply it.
 *
 * Data sovereignty:
 *   - No GU or hub access
 *   - No cross-NU data returned
 *   - Sensitive payloads are NOT fully logged (only IDs and counts)
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  nuLocalProjectsTable,
  resourceBookingsTable,
  resourcesTable,
  resourceTypesTable,
} from "@workspace/db";
import { and, eq, lt, gt } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import type { Request, Response } from "express";

const router = Router();

// ── Guard helper ──────────────────────────────────────────────────────────────

function requireNU(req: Request, res: Response): boolean {
  const user = req.user as {
    orgId: string | null;
    orgType: "AG" | "AN" | null;
    hubAdmin: boolean;
  };
  if (user.hubAdmin || user.orgType !== "AN" || !user.orgId) {
    res.status(403).json({ error: "NU access only" });
    return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// RESOURCE TYPES
// ────────────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = ["PERSONNEL", "CREW", "EQUIPMENT", "MACHINE", "OTHER"] as const;
const VALID_CAPACITY_UNITS = ["PERSONS", "UNITS", "HOURS_PER_DAY", "PERCENT"] as const;

type ResourceTypeCategory = typeof VALID_CATEGORIES[number];
type CapacityUnit = typeof VALID_CAPACITY_UNITS[number];

/** DTC v2 class URIs accepted by the API. */
const DTC_CLASS_TO_CATEGORY: Record<string, ResourceTypeCategory> = {
  "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedWorker": "PERSONNEL",
  "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedWorkerCrew": "CREW",
  "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedEquipment": "EQUIPMENT",
  "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedTemporaryEquipment": "MACHINE",
};
const VALID_DTC_CLASSES = Object.keys(DTC_CLASS_TO_CATEGORY);

// GET /api/nu/resource-types
router.get("/nu/resource-types", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const includeInactive = req.query.includeInactive === "true";

  const filters = [eq(resourceTypesTable.anOrgId, nuOrgId)];
  if (!includeInactive) {
    filters.push(eq(resourceTypesTable.active, true));
  }

  const rows = await db
    .select()
    .from(resourceTypesTable)
    .where(and(...filters))
    .orderBy(resourceTypesTable.name);

  res.status(200).json({ items: rows, count: rows.length });
});

// POST /api/nu/resource-types
router.post("/nu/resource-types", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;

  const schema = z.object({
    name: z.string().min(1),
    // category can be derived from dtcClass; at least one must be provided
    category: z.enum(VALID_CATEGORIES).optional(),
    dtcClass: z.string().optional(),
    code: z.string().optional(),
    classificationSystem: z.string().optional(),
    classificationCode: z.string().optional(),
    qualification: z.string().optional(),
    capacityUnit: z.enum(VALID_CAPACITY_UNITS).optional(),
    defaultDailyCapacity: z.number().positive().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues });
    return;
  }

  // Validate dtcClass if provided
  const { dtcClass, ...rest } = parsed.data;
  if (dtcClass && !VALID_DTC_CLASSES.includes(dtcClass)) {
    res.status(400).json({ error: `Invalid dtcClass. Must be one of: ${VALID_DTC_CLASSES.join(", ")}` });
    return;
  }

  // Derive category from dtcClass if not explicitly provided
  let category: ResourceTypeCategory = rest.category ?? "PERSONNEL";
  if (dtcClass && DTC_CLASS_TO_CATEGORY[dtcClass]) {
    category = DTC_CLASS_TO_CATEGORY[dtcClass];
  } else if (!rest.category) {
    res.status(400).json({ error: "Either 'category' or a valid 'dtcClass' must be provided" });
    return;
  }

  const [row] = await db
    .insert(resourceTypesTable)
    .values({
      anOrgId: nuOrgId,
      ...rest,
      category,
      dtcClass: dtcClass ?? null,
    } as typeof resourceTypesTable.$inferInsert)
    .returning();

  res.status(201).json(row);
});

// GET /api/nu/resource-types/:id
router.get("/nu/resource-types/:id", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const id = req.params.id as string;

  const [row] = await db
    .select()
    .from(resourceTypesTable)
    .where(and(eq(resourceTypesTable.id, id), eq(resourceTypesTable.anOrgId, nuOrgId)))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Resource type not found" });
    return;
  }

  res.status(200).json(row);
});

// PATCH /api/nu/resource-types/:id
router.patch("/nu/resource-types/:id", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const id = req.params.id as string;

  const schema = z.object({
    name: z.string().min(1).optional(),
    category: z.enum(VALID_CATEGORIES).optional(),
    dtcClass: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
    classificationSystem: z.string().nullable().optional(),
    classificationCode: z.string().nullable().optional(),
    qualification: z.string().nullable().optional(),
    capacityUnit: z.enum(VALID_CAPACITY_UNITS).nullable().optional(),
    defaultDailyCapacity: z.number().positive().nullable().optional(),
    active: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [existing] = await db
    .select({ id: resourceTypesTable.id })
    .from(resourceTypesTable)
    .where(and(eq(resourceTypesTable.id, id), eq(resourceTypesTable.anOrgId, nuOrgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Resource type not found" });
    return;
  }

  const { dtcClass, ...patchRest } = parsed.data;

  // If dtcClass is being updated, keep category in sync
  const categoryOverride =
    dtcClass && DTC_CLASS_TO_CATEGORY[dtcClass] ? { category: DTC_CLASS_TO_CATEGORY[dtcClass] } : {};

  const [updated] = await db
    .update(resourceTypesTable)
    .set({
      ...patchRest,
      ...(dtcClass !== undefined ? { dtcClass } : {}),
      ...categoryOverride,
      updatedAt: new Date(),
    })
    .where(and(eq(resourceTypesTable.id, id), eq(resourceTypesTable.anOrgId, nuOrgId)))
    .returning();

  res.status(200).json(updated);
});

// POST /api/nu/resource-types/:id/deactivate  (soft-delete)
router.post("/nu/resource-types/:id/deactivate", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const id = req.params.id as string;

  const [existing] = await db
    .select({ id: resourceTypesTable.id, active: resourceTypesTable.active })
    .from(resourceTypesTable)
    .where(and(eq(resourceTypesTable.id, id), eq(resourceTypesTable.anOrgId, nuOrgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Resource type not found" });
    return;
  }

  const [updated] = await db
    .update(resourceTypesTable)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(resourceTypesTable.id, id), eq(resourceTypesTable.anOrgId, nuOrgId)))
    .returning();

  res.status(200).json(updated);
});

// ────────────────────────────────────────────────────────────────────────────
// LOCAL PROJECTS
// ────────────────────────────────────────────────────────────────────────────

// GET /api/nu/local-projects
router.get("/nu/local-projects", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;

  const q = req.query as Record<string, string>;
  const limitVal  = Math.min(Math.max(parseInt(q.limit  ?? "50", 10) || 50, 1), 100);
  const offsetVal = Math.max(parseInt(q.offset ?? "0",  10) || 0, 0);

  const filters = [eq(nuLocalProjectsTable.nuOrgId, nuOrgId)];

  if (q.status) {
    const validStatuses = ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
    if (!validStatuses.includes(q.status as never)) {
      res.status(400).json({ error: "Invalid status filter" });
      return;
    }
    filters.push(eq(nuLocalProjectsTable.status, q.status as typeof validStatuses[number]));
  }

  const rows = await db
    .select()
    .from(nuLocalProjectsTable)
    .where(and(...filters))
    .orderBy(nuLocalProjectsTable.createdAt)
    .limit(limitVal)
    .offset(offsetVal);

  res.status(200).json({ items: rows, limit: limitVal, offset: offsetVal, count: rows.length });
});

// POST /api/nu/local-projects
router.post("/nu/local-projects", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;

  const schema = z.object({
    localProjectCode: z.string().min(1),
    displayName: z.string().min(1),
    customerAlias: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues });
    return;
  }

  const data = parsed.data;

  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    res.status(400).json({ error: "endDate must be >= startDate" });
    return;
  }

  try {
    const [project] = await db
      .insert(nuLocalProjectsTable)
      .values({ nuOrgId, ...data })
      .returning();

    res.status(201).json(project);
  } catch (err: unknown) {
    // drizzle wraps the pg error in err.cause — check both levels
    const code =
      (err as { code?: string }).code ??
      (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "localProjectCode already exists for this organisation" });
      return;
    }
    throw err;
  }
});

// GET /api/nu/local-projects/:projectId
router.get("/nu/local-projects/:projectId", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const projectId = req.params.projectId as string;

  const [project] = await db
    .select()
    .from(nuLocalProjectsTable)
    .where(and(eq(nuLocalProjectsTable.id, projectId), eq(nuLocalProjectsTable.nuOrgId, nuOrgId)))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Local project not found" });
    return;
  }

  res.status(200).json(project);
});

// PATCH /api/nu/local-projects/:projectId
router.patch("/nu/local-projects/:projectId", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const projectId = req.params.projectId as string;

  const schema = z.object({
    displayName: z.string().min(1).optional(),
    customerAlias: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  // Fetch current row to validate ownership and date consistency
  const [existing] = await db
    .select()
    .from(nuLocalProjectsTable)
    .where(and(eq(nuLocalProjectsTable.id, projectId), eq(nuLocalProjectsTable.nuOrgId, nuOrgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Local project not found" });
    return;
  }

  const newStart = parsed.data.startDate ?? existing.startDate;
  const newEnd   = parsed.data.endDate   ?? existing.endDate;
  if (newStart && newEnd && newEnd < newStart) {
    res.status(400).json({ error: "endDate must be >= startDate" });
    return;
  }

  const [updated] = await db
    .update(nuLocalProjectsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(nuLocalProjectsTable.id, projectId), eq(nuLocalProjectsTable.nuOrgId, nuOrgId)))
    .returning();

  res.status(200).json(updated);
});

// ────────────────────────────────────────────────────────────────────────────
// RESOURCE BOOKINGS
// ────────────────────────────────────────────────────────────────────────────

// GET /api/nu/resource-bookings
router.get("/nu/resource-bookings", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;

  const q = req.query as Record<string, string>;
  const limitVal  = Math.min(Math.max(parseInt(q.limit  ?? "50", 10) || 50, 1), 100);
  const offsetVal = Math.max(parseInt(q.offset ?? "0",  10) || 0, 0);

  const filters = [eq(resourceBookingsTable.nuOrgId, nuOrgId)];

  if (q.resourceId) {
    filters.push(eq(resourceBookingsTable.resourceId, q.resourceId));
  }
  if (q.localProjectId) {
    filters.push(eq(resourceBookingsTable.localProjectId, q.localProjectId));
  }
  if (q.sourceType) {
    const valid = ["LOCAL_PROJECT", "TAKT_REQUEST", "MANUAL_BLOCK", "ABSENCE", "MAINTENANCE"];
    if (!valid.includes(q.sourceType)) {
      res.status(400).json({ error: "Invalid sourceType filter" });
      return;
    }
    filters.push(eq(resourceBookingsTable.sourceType, q.sourceType as typeof valid[number] as "LOCAL_PROJECT" | "TAKT_REQUEST" | "MANUAL_BLOCK" | "ABSENCE" | "MAINTENANCE"));
  }
  if (q.status) {
    const valid = ["TENTATIVE", "CONFIRMED", "CANCELLED"];
    if (!valid.includes(q.status)) {
      res.status(400).json({ error: "Invalid status filter" });
      return;
    }
    filters.push(eq(resourceBookingsTable.status, q.status as "TENTATIVE" | "CONFIRMED" | "CANCELLED"));
  }

  // Overlap filter: booking.startAt < endTo AND booking.endAt > startFrom
  if (q.startFrom || q.endTo) {
    if (q.startFrom) {
      // booking.endAt > startFrom → overlaps on the right
      filters.push(gt(resourceBookingsTable.endAt, new Date(q.startFrom)));
    }
    if (q.endTo) {
      // booking.startAt < endTo → overlaps on the left
      filters.push(lt(resourceBookingsTable.startAt, new Date(q.endTo)));
    }
  }

  const rows = await db
    .select({
      id:                 resourceBookingsTable.id,
      nuOrgId:            resourceBookingsTable.nuOrgId,
      resourceId:         resourceBookingsTable.resourceId,
      resourceName:       resourcesTable.name,
      resourceColor:      resourcesTable.color,
      localProjectId:     resourceBookingsTable.localProjectId,
      sourceType:         resourceBookingsTable.sourceType,
      sourceReferenceId:  resourceBookingsTable.sourceReferenceId,
      startAt:            resourceBookingsTable.startAt,
      endAt:              resourceBookingsTable.endAt,
      utilizationPercent: resourceBookingsTable.utilizationPercent,
      status:             resourceBookingsTable.status,
      note:               resourceBookingsTable.note,
      createdAt:          resourceBookingsTable.createdAt,
      updatedAt:          resourceBookingsTable.updatedAt,
    })
    .from(resourceBookingsTable)
    .leftJoin(resourcesTable, eq(resourceBookingsTable.resourceId, resourcesTable.id))
    .where(and(...filters))
    .orderBy(resourceBookingsTable.startAt)
    .limit(limitVal)
    .offset(offsetVal);

  res.status(200).json({ items: rows, limit: limitVal, offset: offsetVal, count: rows.length });
});

// POST /api/nu/resource-bookings
router.post("/nu/resource-bookings", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;

  const schema = z.object({
    // concrete-resource booking (legacy + DTC)
    resourceId: z.string().min(1).optional(),
    // type-level capacity booking (DTC ResourceAssignment)
    resourceTypeId: z.string().min(1).optional(),
    quantity: z.number().int().positive().optional(),
    localProjectId: z.string().optional(),
    sourceType: z.enum(["LOCAL_PROJECT", "TAKT_REQUEST", "MANUAL_BLOCK", "ABSENCE", "MAINTENANCE"]),
    sourceReferenceId: z.string().optional(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    utilizationPercent: z.number().int().min(1).max(100).default(100),
    status: z.enum(["TENTATIVE", "CONFIRMED", "CANCELLED"]).default("TENTATIVE"),
    note: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues });
    return;
  }

  const data = parsed.data;

  // Business rule: at least one of resourceId or resourceTypeId must be present
  if (!data.resourceId && !data.resourceTypeId) {
    res.status(400).json({ error: "At least one of 'resourceId' or 'resourceTypeId' must be provided" });
    return;
  }

  const startAt = new Date(data.startAt);
  const endAt   = new Date(data.endAt);

  if (endAt <= startAt) {
    res.status(400).json({ error: "endAt must be after startAt" });
    return;
  }

  // If resourceId provided, verify it belongs to this NU
  if (data.resourceId) {
    const [resource] = await db
      .select({ id: resourcesTable.id, anOrgId: resourcesTable.anOrgId, resourceTypeId: resourcesTable.resourceTypeId })
      .from(resourcesTable)
      .where(eq(resourcesTable.id, data.resourceId))
      .limit(1);

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    if (resource.anOrgId !== nuOrgId) {
      res.status(403).json({ error: "Resource does not belong to your organisation" });
      return;
    }

    // Auto-fill resourceTypeId from the resource if not explicitly provided
    if (!data.resourceTypeId && resource.resourceTypeId) {
      data.resourceTypeId = resource.resourceTypeId;
    }
  }

  const [booking] = await db
    .insert(resourceBookingsTable)
    .values({ nuOrgId, ...data, startAt, endAt })
    .returning();

  res.status(201).json(booking);
});

// GET /api/nu/resource-bookings/:bookingId
router.get("/nu/resource-bookings/:bookingId", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const bookingId = req.params.bookingId as string;

  const [booking] = await db
    .select()
    .from(resourceBookingsTable)
    .where(and(eq(resourceBookingsTable.id, bookingId), eq(resourceBookingsTable.nuOrgId, nuOrgId)))
    .limit(1);

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  res.status(200).json(booking);
});

// PATCH /api/nu/resource-bookings/:bookingId
router.patch("/nu/resource-bookings/:bookingId", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const bookingId = req.params.bookingId as string;

  const schema = z.object({
    localProjectId: z.string().nullable().optional(),
    sourceReferenceId: z.string().optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    utilizationPercent: z.number().int().min(1).max(100).optional(),
    status: z.enum(["TENTATIVE", "CONFIRMED", "CANCELLED"]).optional(),
    note: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [existing] = await db
    .select()
    .from(resourceBookingsTable)
    .where(and(eq(resourceBookingsTable.id, bookingId), eq(resourceBookingsTable.nuOrgId, nuOrgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  if (existing.status === "CANCELLED") {
    res.status(409).json({ error: "Cannot update a cancelled booking" });
    return;
  }

  const patchData = parsed.data;
  const newStart = patchData.startAt ? new Date(patchData.startAt) : existing.startAt;
  const newEnd   = patchData.endAt   ? new Date(patchData.endAt)   : existing.endAt;

  if (newEnd <= newStart) {
    res.status(400).json({ error: "endAt must be after startAt" });
    return;
  }

  const [updated] = await db
    .update(resourceBookingsTable)
    .set({
      ...(patchData.localProjectId !== undefined ? { localProjectId: patchData.localProjectId } : {}),
      ...(patchData.sourceReferenceId !== undefined ? { sourceReferenceId: patchData.sourceReferenceId } : {}),
      ...(patchData.startAt !== undefined ? { startAt: new Date(patchData.startAt) } : {}),
      ...(patchData.endAt   !== undefined ? { endAt:   new Date(patchData.endAt)   } : {}),
      ...(patchData.utilizationPercent !== undefined ? { utilizationPercent: patchData.utilizationPercent } : {}),
      ...(patchData.status !== undefined ? { status: patchData.status } : {}),
      ...(patchData.note !== undefined ? { note: patchData.note } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(resourceBookingsTable.id, bookingId), eq(resourceBookingsTable.nuOrgId, nuOrgId)))
    .returning();

  res.status(200).json(updated);
});

// POST /api/nu/resource-bookings/:bookingId/cancel
router.post("/nu/resource-bookings/:bookingId/cancel", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const bookingId = req.params.bookingId as string;

  const [existing] = await db
    .select()
    .from(resourceBookingsTable)
    .where(and(eq(resourceBookingsTable.id, bookingId), eq(resourceBookingsTable.nuOrgId, nuOrgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  if (existing.status === "CANCELLED") {
    // Idempotent — already cancelled
    res.status(200).json(existing);
    return;
  }

  const [cancelled] = await db
    .update(resourceBookingsTable)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(and(eq(resourceBookingsTable.id, bookingId), eq(resourceBookingsTable.nuOrgId, nuOrgId)))
    .returning();

  res.status(200).json(cancelled);
});

// DELETE /api/nu/resource-bookings/:bookingId — hard-delete CANCELLED bookings only
router.delete("/nu/resource-bookings/:bookingId", requireJwt, async (req, res): Promise<void> => {
  if (!requireNU(req, res)) return;
  const nuOrgId = (req.user as { orgId: string }).orgId;
  const bookingId = req.params.bookingId as string;

  const [existing] = await db
    .select({ id: resourceBookingsTable.id, status: resourceBookingsTable.status })
    .from(resourceBookingsTable)
    .where(and(eq(resourceBookingsTable.id, bookingId), eq(resourceBookingsTable.nuOrgId, nuOrgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  if (existing.status !== "CANCELLED") {
    res.status(409).json({ error: "Nur stornierte Belegungen können endgültig gelöscht werden." });
    return;
  }

  await db
    .delete(resourceBookingsTable)
    .where(eq(resourceBookingsTable.id, bookingId));

  res.status(204).send();
});

export default router;

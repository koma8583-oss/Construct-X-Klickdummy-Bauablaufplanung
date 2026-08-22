/**
 * Shared CRUD service for Leistungsanfrage resource requirements.
 *
 * Used by both:
 *   - routes/takt-requests.ts  (legacy /takt-requests/:id/resource-requirements)
 *   - routes/leistungen.ts     (canonical /leistungsanfragen/:id/resource-requirements)
 *
 * Both sets of routes point at the same physical table
 * (leistungsanfrage_resource_requirements) via the canonical
 * leistungsanfrageResourceRequirementsTable Drizzle declaration.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  leistungsanfrageResourceRequirementsTable,
  resourceTypesTable,
} from "@workspace/db";
import {
  getTaktRequestById,
  getTaktRequestWithSnapshot,
} from "../lib/takt-request-repository";
import { validateResourceTypeForOrg } from "./resource-domain-service";

// ── Validation schemas ────────────────────────────────────────────────────────

export const requirementCreateSchema = z.object({
  resourceTypeId: z.string().min(1).optional(),
  requiredCapacity: z.number().positive(),
  utilizationPercent: z.number().int().min(1).max(100).optional().default(100),
  requiredQualification: z.string().max(500).nullable().optional(),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const requirementUpdateSchema = z.object({
  requiredCapacity: z.number().positive().optional(),
  utilizationPercent: z.number().int().min(1).max(100).optional(),
  requiredQualification: z.string().max(500).nullable().optional(),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// ── Error classes ──────────────────────────────────────────────────────────────

export class ResourceRequirementNotFoundError extends Error {
  constructor(message = "Resource requirement not found") {
    super(message);
    this.name = "ResourceRequirementNotFoundError";
  }
}

export class ResourceRequirementAccessDeniedError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "ResourceRequirementAccessDeniedError";
  }
}

export class InvalidRequirementPeriodError extends Error {
  readonly code = "INVALID_REQUIREMENT_PERIOD";
  constructor(message = "Invalid requirement period") {
    super(message);
    this.name = "InvalidRequirementPeriodError";
  }
}

export class ResourceTypeNotOwnedError extends Error {
  readonly code = "RESOURCE_TYPE_NOT_OWNED";
  constructor(message = "Resource type is not owned by your organisation") {
    super(message);
    this.name = "ResourceTypeNotOwnedError";
  }
}

// ── Row formatter ──────────────────────────────────────────────────────────────

function formatRow(
  r: typeof leistungsanfrageResourceRequirementsTable.$inferSelect,
  rt: { name: string | null; category: string | null } | null,
) {
  return {
    id: r.id,
    leistungsanfrageId: r.leistungsanfrageId,
    taktRequestId: r.leistungsanfrageId, // legacy alias
    anOrgId: r.anOrgId,
    resourceTypeId: r.resourceTypeId,
    resourceTypeName: rt?.name ?? null,
    resourceTypeCategory: rt?.category ?? null,
    requiredCapacity: r.requiredCapacity,
    utilizationPercent: r.utilizationPercent,
    requiredQualification: r.requiredQualification,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ── CRUD operations ────────────────────────────────────────────────────────────

/**
 * List all resource requirements for a Leistungsanfrage that belong to nuOrgId.
 * Returns 404-style null when the request is not found / not addressed to nuOrgId.
 */
export async function listResourceRequirements(
  leistungsanfrageId: string,
  nuOrgId: string,
): Promise<ReturnType<typeof formatRow>[] | null> {
  const request = await getTaktRequestById(leistungsanfrageId);
  if (!request || request.nuOrgId !== nuOrgId) return null;

  const rows = await db
    .select({
      req: leistungsanfrageResourceRequirementsTable,
      rt: {
        name: resourceTypesTable.name,
        category: resourceTypesTable.category,
      },
    })
    .from(leistungsanfrageResourceRequirementsTable)
    .leftJoin(
      resourceTypesTable,
      eq(
        leistungsanfrageResourceRequirementsTable.resourceTypeId,
        resourceTypesTable.id,
      ),
    )
    .where(
      and(
        eq(
          leistungsanfrageResourceRequirementsTable.leistungsanfrageId,
          leistungsanfrageId,
        ),
        eq(leistungsanfrageResourceRequirementsTable.anOrgId, nuOrgId),
      ),
    )
    .orderBy(desc(leistungsanfrageResourceRequirementsTable.createdAt));

  return rows.map(({ req: r, rt }) => formatRow(r, rt));
}

/**
 * Create a new resource requirement.
 * Throws ResourceRequirementAccessDeniedError / InvalidRequirementPeriodError /
 * ResourceTypeNotOwnedError on validation failures.
 * Returns null when the request is not found / not addressed to nuOrgId.
 */
export async function createResourceRequirement(
  leistungsanfrageId: string,
  nuOrgId: string,
  data: z.infer<typeof requirementCreateSchema>,
): Promise<ReturnType<typeof formatRow> | null> {
  const request = await getTaktRequestById(leistungsanfrageId);
  if (!request || request.nuOrgId !== nuOrgId) return null;

  if (data.resourceTypeId) {
    try {
      await validateResourceTypeForOrg(data.resourceTypeId, nuOrgId);
    } catch {
      throw new ResourceTypeNotOwnedError();
    }
  }

  const snapshot = (
    await getTaktRequestWithSnapshot(leistungsanfrageId)
  )?.snapshot?.snapshotPayload as
    | { plannedTimeWindow?: { start?: string; end?: string } }
    | undefined;

  const periodStart =
    data.periodStart ?? snapshot?.plannedTimeWindow?.start ?? null;
  const periodEnd =
    data.periodEnd ?? snapshot?.plannedTimeWindow?.end ?? null;

  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    throw new InvalidRequirementPeriodError();
  }

  const [inserted] = await db
    .insert(leistungsanfrageResourceRequirementsTable)
    .values({
      leistungsanfrageId,
      anOrgId: nuOrgId,
      resourceTypeId: data.resourceTypeId,
      requiredCapacity: data.requiredCapacity.toString(),
      utilizationPercent: data.utilizationPercent ?? 100,
      requiredQualification: data.requiredQualification ?? null,
      periodStart,
      periodEnd,
      notes: data.notes ?? null,
    })
    .returning();

  return formatRow(inserted, null);
}

/**
 * Update an existing resource requirement (partial PATCH).
 * Only the owning AN (nuOrgId) may update their own requirements.
 * Returns null when the request is not found / not addressed to nuOrgId.
 * Throws ResourceRequirementNotFoundError when the requirement row itself is missing.
 * Throws InvalidRequirementPeriodError when dates are inconsistent.
 */
export async function updateResourceRequirement(
  leistungsanfrageId: string,
  requirementId: string,
  nuOrgId: string,
  patch: z.infer<typeof requirementUpdateSchema>,
): Promise<ReturnType<typeof formatRow> | null> {
  const request = await getTaktRequestById(leistungsanfrageId);
  if (!request || request.nuOrgId !== nuOrgId) return null;

  // Load the existing row to validate period consistency
  const [existing] = await db
    .select()
    .from(leistungsanfrageResourceRequirementsTable)
    .where(
      and(
        eq(leistungsanfrageResourceRequirementsTable.id, requirementId),
        eq(
          leistungsanfrageResourceRequirementsTable.leistungsanfrageId,
          leistungsanfrageId,
        ),
        eq(leistungsanfrageResourceRequirementsTable.anOrgId, nuOrgId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new ResourceRequirementNotFoundError();
  }

  // Resolve final period values
  const periodStart = patch.periodStart !== undefined ? patch.periodStart : existing.periodStart;
  const periodEnd = patch.periodEnd !== undefined ? patch.periodEnd : existing.periodEnd;
  if (periodStart && periodEnd && periodStart > periodEnd) {
    throw new InvalidRequirementPeriodError();
  }

  const updateValues: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (patch.requiredCapacity !== undefined) {
    updateValues.requiredCapacity = patch.requiredCapacity.toString();
  }
  if (patch.utilizationPercent !== undefined) {
    updateValues.utilizationPercent = patch.utilizationPercent;
  }
  if (patch.requiredQualification !== undefined) {
    updateValues.requiredQualification = patch.requiredQualification;
  }
  if (patch.periodStart !== undefined) {
    updateValues.periodStart = patch.periodStart;
  }
  if (patch.periodEnd !== undefined) {
    updateValues.periodEnd = patch.periodEnd;
  }
  if (patch.notes !== undefined) {
    updateValues.notes = patch.notes;
  }

  const [updated] = await db
    .update(leistungsanfrageResourceRequirementsTable)
    .set(updateValues as any)
    .where(
      and(
        eq(leistungsanfrageResourceRequirementsTable.id, requirementId),
        eq(
          leistungsanfrageResourceRequirementsTable.leistungsanfrageId,
          leistungsanfrageId,
        ),
        eq(leistungsanfrageResourceRequirementsTable.anOrgId, nuOrgId),
      ),
    )
    .returning();

  if (!updated) {
    throw new ResourceRequirementNotFoundError();
  }

  return formatRow(updated, null);
}

/**
 * Delete a resource requirement.
 * Only the owning AN (nuOrgId) may delete their own requirements.
 * Returns null when the parent request is not found / not addressed to nuOrgId.
 * Throws ResourceRequirementNotFoundError when the requirement row is missing.
 */
export async function deleteResourceRequirement(
  leistungsanfrageId: string,
  requirementId: string,
  nuOrgId: string,
): Promise<void> {
  const request = await getTaktRequestById(leistungsanfrageId);
  if (!request || request.nuOrgId !== nuOrgId) {
    throw new ResourceRequirementNotFoundError("Leistungsanfrage not found");
  }

  const [deleted] = await db
    .delete(leistungsanfrageResourceRequirementsTable)
    .where(
      and(
        eq(leistungsanfrageResourceRequirementsTable.id, requirementId),
        eq(
          leistungsanfrageResourceRequirementsTable.leistungsanfrageId,
          leistungsanfrageId,
        ),
        eq(leistungsanfrageResourceRequirementsTable.anOrgId, nuOrgId),
      ),
    )
    .returning();

  if (!deleted) {
    throw new ResourceRequirementNotFoundError();
  }
}

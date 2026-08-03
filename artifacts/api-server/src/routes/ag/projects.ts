/**
 * AG/GU project overview routes (Task 9.2)
 *
 * These endpoints expose project-level coordination summaries and
 * project-scoped AN assignment management for the Generalunternehmer.
 *
 * Org isolation: every query is scoped to req.user.orgId (agOrgId from JWT).
 * No client-supplied agOrgId is accepted.
 *
 * Data sovereignty:
 *   - Only coordination data visible to GU is returned (status, request counts, dates)
 *   - No NU-internal resource data, no employee names, no other-GU data
 *
 * Note: takt_requests has no projectId column — project association is via
 *       takt_requests.taktId → takte.projectId.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  projectContractorsTable,
  organizationsTable,
  taktRequestsTable,
  takteTable,
} from "@workspace/db";
import { eq, and, count, sql, inArray, max } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";
import { z } from "zod";

const router = Router();

// All AG project routes require a JWT-authenticated AG user
router.use(requireJwt);

/** Extracts and validates agOrgId from JWT. Returns null + sends 403 on failure. */
function getAgOrgId(req: any, res: any): string | null {
  const user = req.user as { orgId?: string | null; orgType?: string | null };
  if (!user.orgId || user.orgType !== "AG") {
    res.status(403).json({ error: "AG organisation required" });
    return null;
  }
  return user.orgId;
}

// ── GET /ag/projects/overview ─────────────────────────────────────────────────

router.get("/ag/projects/overview", async (req, res): Promise<void> => {
  const agOrgId = getAgOrgId(req, res);
  if (!agOrgId) return;

  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.agOrgId, agOrgId));

  if (projects.length === 0) {
    res.json([]);
    return;
  }

  const projectIds = projects.map((p) => p.id);

  // Aggregate takt request counts per project (join through takte to get projectId)
  const requestCounts = await db
    .select({
      projectId: takteTable.projectId,
      total: count().as("total"),
      open: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} IN ('SENT','DELIVERED','DETAILS_RETRIEVED','UNDER_REVIEW','ALTERNATIVES_PROPOSED','REVISION_REQUIRED'))`.as("open"),
      overdue: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.responseRequiredBy} < now() AND ${taktRequestsTable.status} IN ('SENT','DELIVERED','DETAILS_RETRIEVED','UNDER_REVIEW'))`.as("overdue"),
      accepted: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'ACCEPTED')`.as("accepted"),
      alternatives: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'ALTERNATIVES_PROPOSED')`.as("alternatives"),
      rejected: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'REJECTED')`.as("rejected"),
      revisionRequired: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'REVISION_REQUIRED')`.as("revision_required"),
      expired: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'EXPIRED')`.as("expired"),
      lastActivityAt: max(taktRequestsTable.updatedAt).as("last_activity_at"),
    })
    .from(taktRequestsTable)
    .innerJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .where(
      and(
        eq(taktRequestsTable.guOrgId, agOrgId),
        inArray(takteTable.projectId, projectIds as [string, ...string[]]),
      ),
    )
    .groupBy(takteTable.projectId);

  // Contractor counts + unique trades per project
  const contractorStats = await db
    .select({
      projectId: projectContractorsTable.projectId,
      assignedAnCount: sql<number>`COUNT(DISTINCT ${projectContractorsTable.anOrgId})`.as("assigned_an_count"),
      assignedTrades: sql<string[]>`ARRAY_AGG(DISTINCT ${projectContractorsTable.trade}) FILTER (WHERE ${projectContractorsTable.trade} IS NOT NULL)`.as("assigned_trades"),
    })
    .from(projectContractorsTable)
    .where(
      and(
        inArray(projectContractorsTable.projectId, projectIds as [string, ...string[]]),
        eq(projectContractorsTable.assignmentStatus, "ACTIVE"),
      ),
    )
    .groupBy(projectContractorsTable.projectId);

  const reqMap = new Map(requestCounts.map((r) => [r.projectId, r]));
  const ctMap  = new Map(contractorStats.map((c) => [c.projectId, c]));

  const result = projects.map((p) => {
    const req = reqMap.get(p.id);
    const ct  = ctMap.get(p.id);
    return {
      projectId:                p.id,
      projectName:              p.name,
      projectStatus:            p.status,
      startDate:                p.startDate,
      endDate:                  p.endDate,
      assignedAnCount:          ct?.assignedAnCount  ?? 0,
      assignedTrades:           (ct?.assignedTrades  ?? []).filter(Boolean),
      totalTaktRequests:        req?.total            ?? 0,
      openTaktRequests:         req?.open             ?? 0,
      overdueTaktRequests:      req?.overdue          ?? 0,
      acceptedTaktRequests:     req?.accepted         ?? 0,
      alternativeTaktRequests:  req?.alternatives     ?? 0,
      rejectedTaktRequests:     req?.rejected         ?? 0,
      revisionRequiredRequests: req?.revisionRequired ?? 0,
      expiredTaktRequests:      req?.expired          ?? 0,
      lastActivityAt:           req?.lastActivityAt   ?? null,
    };
  });

  res.json(result);
});

// ── GET /ag/projects/:projectId/overview ──────────────────────────────────────

router.get("/ag/projects/:projectId/overview", async (req, res): Promise<void> => {
  const agOrgId   = getAgOrgId(req, res);
  if (!agOrgId) return;
  const projectId = req.params.projectId as string;

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.agOrgId, agOrgId)))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  // --- All contractor assignments (any status) with AN name ---
  const contractors = await db
    .select({
      assignmentId:         projectContractorsTable.id,
      anOrgId:              projectContractorsTable.anOrgId,
      anName:               organizationsTable.name,
      trade:                projectContractorsTable.trade,
      workPackageReference: projectContractorsTable.workPackageReference,
      assignmentStatus:     projectContractorsTable.assignmentStatus,
      validFrom:            projectContractorsTable.validFrom,
      validTo:              projectContractorsTable.validTo,
    })
    .from(projectContractorsTable)
    .innerJoin(organizationsTable, eq(projectContractorsTable.anOrgId, organizationsTable.id))
    .where(eq(projectContractorsTable.projectId, projectId));

  // Per-AN request aggregates (single batch query)
  const nuOrgIds = [...new Set(contractors.map((c) => c.anOrgId))];
  type NuAgg = {
    nuOrgId: string;
    total: number; open: number; accepted: number;
    alternatives: number; rejected: number;
    lastResponseAt: Date | null;
  };
  let nuAggs: NuAgg[] = [];
  if (nuOrgIds.length > 0) {
    nuAggs = (await db
      .select({
        nuOrgId:        taktRequestsTable.nuOrgId,
        total:          count().as("total"),
        open: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} IN ('SENT','DELIVERED','DETAILS_RETRIEVED','UNDER_REVIEW','ALTERNATIVES_PROPOSED','REVISION_REQUIRED'))`.as("open"),
        accepted: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'ACCEPTED')`.as("accepted"),
        alternatives: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'ALTERNATIVES_PROPOSED')`.as("alternatives"),
        rejected: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'REJECTED')`.as("rejected"),
        lastResponseAt: sql<Date | null>`MAX(${taktRequestsTable.updatedAt})`.as("last_response_at"),
      })
      .from(taktRequestsTable)
      .innerJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
      .where(
        and(
          eq(takteTable.projectId, projectId),
          inArray(taktRequestsTable.nuOrgId, nuOrgIds as [string, ...string[]]),
        ),
      )
      .groupBy(taktRequestsTable.nuOrgId)) as NuAgg[];
  }
  const nuMap = new Map<string, NuAgg>(nuAggs.map((n) => [n.nuOrgId, n]));

  const assignedAn = contractors.map((c) => {
    const n = nuMap.get(c.anOrgId);
    return {
      assignmentId:         c.assignmentId,
      anOrgId:              c.anOrgId,
      anName:               c.anName,
      trade:                c.trade,
      workPackageReference: c.workPackageReference,
      assignmentStatus:     c.assignmentStatus,
      validFrom:            c.validFrom,
      validTo:              c.validTo,
      totalRequests:        n?.total       ?? 0,
      openRequests:         n?.open        ?? 0,
      acceptedRequests:     n?.accepted    ?? 0,
      alternativeRequests:  n?.alternatives ?? 0,
      rejectedRequests:     n?.rejected    ?? 0,
      lastResponseAt:       n?.lastResponseAt ?? null,
    };
  });

  // --- Takt coordination summary ---
  const [coordRow] = await db
    .select({
      numberOfTakts:       sql<number>`COUNT(DISTINCT t.id)`.as("number_of_takts"),
      confirmedTakts:      sql<number>`COUNT(DISTINCT t.id) FILTER (WHERE t.lifecycle_status = 'CONFIRMED')`.as("confirmed_takts"),
      taktsInCoordination: sql<number>`COUNT(DISTINCT tr.takt_id) FILTER (WHERE tr.status IN ('SENT','DELIVERED','DETAILS_RETRIEVED','UNDER_REVIEW','ALTERNATIVES_PROPOSED'))`.as("takts_in_coordination"),
      openRequests:        sql<number>`COUNT(tr.id) FILTER (WHERE tr.status IN ('SENT','DELIVERED','DETAILS_RETRIEVED','UNDER_REVIEW'))`.as("open_requests"),
      overdueRequests:     sql<number>`COUNT(tr.id) FILTER (WHERE tr.response_required_by < now() AND tr.status IN ('SENT','DELIVERED','DETAILS_RETRIEVED','UNDER_REVIEW'))`.as("overdue_requests"),
      expiredRequests:     sql<number>`COUNT(tr.id) FILTER (WHERE tr.status = 'EXPIRED')`.as("expired_requests"),
      revisionRounds:      sql<number>`COUNT(tr.id) FILTER (WHERE tr.supersedes_request_id IS NOT NULL)`.as("revision_rounds"),
    })
    .from(sql`takte t`)
    .leftJoin(
      sql`takt_requests tr`,
      sql`tr.takt_id = t.id AND tr.gu_org_id = ${agOrgId}`,
    )
    .where(sql`t.project_id = ${projectId}`);

  // --- Recent takt requests (open or recently updated) ---
  const recentRequests = await db
    .select({
      taktRequestId:      taktRequestsTable.id,
      requestNumber:      taktRequestsTable.requestNumber,
      taktReference:      taktRequestsTable.taktId,
      taktVersion:        taktRequestsTable.taktVersion,
      anOrgId:            taktRequestsTable.nuOrgId,
      anName:             organizationsTable.name,
      requestStatus:      taktRequestsTable.status,
      responseRequiredBy: taktRequestsTable.responseRequiredBy,
      lastActivityAt:     taktRequestsTable.updatedAt,
    })
    .from(taktRequestsTable)
    .innerJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .innerJoin(organizationsTable, eq(taktRequestsTable.nuOrgId, organizationsTable.id))
    .where(
      and(
        eq(takteTable.projectId, projectId),
        eq(taktRequestsTable.guOrgId, agOrgId),
      ),
    )
    .orderBy(sql`${taktRequestsTable.updatedAt} DESC`)
    .limit(20);

  res.json({
    project: {
      projectId:   project.id,
      projectName: project.name,
      status:      project.status,
      startDate:   project.startDate,
      endDate:     project.endDate,
    },
    assignedAn,
    coordination: coordRow ?? {
      numberOfTakts: 0, confirmedTakts: 0, taktsInCoordination: 0,
      openRequests: 0, overdueRequests: 0, expiredRequests: 0, revisionRounds: 0,
    },
    recentRequests,
  });
});

// ── GET /ag/projects/:projectId/subcontractors ────────────────────────────────

router.get("/ag/projects/:projectId/subcontractors", async (req, res): Promise<void> => {
  const agOrgId   = getAgOrgId(req, res);
  if (!agOrgId) return;
  const projectId = req.params.projectId as string;

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.agOrgId, agOrgId)))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const rows = await db
    .select({
      id:                   projectContractorsTable.id,
      anOrgId:              projectContractorsTable.anOrgId,
      anName:               organizationsTable.name,
      trade:                projectContractorsTable.trade,
      workPackageReference: projectContractorsTable.workPackageReference,
      assignmentStatus:     projectContractorsTable.assignmentStatus,
      validFrom:            projectContractorsTable.validFrom,
      validTo:              projectContractorsTable.validTo,
      addedAt:              projectContractorsTable.addedAt,
    })
    .from(projectContractorsTable)
    .innerJoin(organizationsTable, eq(projectContractorsTable.anOrgId, organizationsTable.id))
    .where(eq(projectContractorsTable.projectId, projectId));

  res.json(rows);
});

// ── POST /ag/projects/:projectId/subcontractors ───────────────────────────────

const createAssignmentSchema = z.object({
  anOrgId:              z.string().min(1),
  trade:                z.string().optional(),
  workPackageReference: z.string().optional(),
  assignmentStatus:     z.enum(["PLANNED", "ACTIVE", "INACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  validFrom:            z.string().optional(),
  validTo:              z.string().optional(),
});

router.post("/ag/projects/:projectId/subcontractors", async (req, res): Promise<void> => {
  const agOrgId   = getAgOrgId(req, res);
  if (!agOrgId) return;
  const projectId = req.params.projectId as string;

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.agOrgId, agOrgId)))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const parsed = createAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }
  const { anOrgId, trade, workPackageReference, assignmentStatus, validFrom, validTo } = parsed.data;

  const [anOrg] = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(and(eq(organizationsTable.id, anOrgId), eq(organizationsTable.type, "AN")))
    .limit(1);
  if (!anOrg) {
    res.status(404).json({ error: "AN organisation not found" });
    return;
  }

  try {
    const [row] = await db
      .insert(projectContractorsTable)
      .values({
        projectId,
        anOrgId,
        trade:                trade ?? null,
        workPackageReference: workPackageReference ?? null,
        assignmentStatus:     assignmentStatus ?? "ACTIVE",
        validFrom:            validFrom ?? null,
        validTo:              validTo ?? null,
        createdByUserId:      (req.user as any)?.userId ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err: unknown) {
    const code =
      (err as { cause?: { code?: string } })?.cause?.code ??
      (err as { code?: string })?.code;
    if (code === "23505") {
      res.status(409).json({
        error: "Assignment already exists for this project, AN, trade and work package",
      });
      return;
    }
    throw err;
  }
});

// ── PATCH /ag/projects/:projectId/subcontractors/:assignmentId ────────────────

const patchAssignmentSchema = z.object({
  trade:                z.string().nullable().optional(),
  workPackageReference: z.string().nullable().optional(),
  assignmentStatus:     z.enum(["PLANNED", "ACTIVE", "INACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  validFrom:            z.string().nullable().optional(),
  validTo:              z.string().nullable().optional(),
});

router.patch(
  "/ag/projects/:projectId/subcontractors/:assignmentId",
  async (req, res): Promise<void> => {
    const agOrgId      = getAgOrgId(req, res);
    if (!agOrgId) return;
    const projectId    = req.params.projectId as string;
    const assignmentId = req.params.assignmentId as string;

    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.agOrgId, agOrgId)))
      .limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const parsed = patchAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.trade !== undefined)                updates.trade                = parsed.data.trade;
    if (parsed.data.workPackageReference !== undefined) updates.workPackageReference = parsed.data.workPackageReference;
    if (parsed.data.assignmentStatus !== undefined)     updates.assignmentStatus     = parsed.data.assignmentStatus;
    if (parsed.data.validFrom !== undefined)            updates.validFrom            = parsed.data.validFrom;
    if (parsed.data.validTo !== undefined)              updates.validTo              = parsed.data.validTo;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db
      .update(projectContractorsTable)
      .set(updates as Parameters<typeof db.update>[0] extends never ? never : any)
      .where(
        and(
          eq(projectContractorsTable.id, assignmentId),
          eq(projectContractorsTable.projectId, projectId),
        ),
      )
      .returning();

    if (!updated) { res.status(404).json({ error: "Assignment not found" }); return; }
    res.json(updated);
  },
);

// ── POST /ag/projects/:projectId/subcontractors/:assignmentId/deactivate ──────

router.post(
  "/ag/projects/:projectId/subcontractors/:assignmentId/deactivate",
  async (req, res): Promise<void> => {
    const agOrgId      = getAgOrgId(req, res);
    if (!agOrgId) return;
    const projectId    = req.params.projectId as string;
    const assignmentId = req.params.assignmentId as string;

    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.agOrgId, agOrgId)))
      .limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    const [updated] = await db
      .update(projectContractorsTable)
      .set({ assignmentStatus: "INACTIVE" })
      .where(
        and(
          eq(projectContractorsTable.id, assignmentId),
          eq(projectContractorsTable.projectId, projectId),
        ),
      )
      .returning();

    if (!updated) { res.status(404).json({ error: "Assignment not found" }); return; }
    res.json({
      ok: true,
      assignmentId: updated.id,
      assignmentStatus: updated.assignmentStatus,
    });
  },
);

export default router;

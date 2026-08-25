/**
 * Summary report endpoints (Task #105)
 *
 * GET /api/reports/ag/summary  — AG_ADMIN, GENERAL_PLANNER
 * GET /api/reports/an/summary  — AN_ADMIN, AN_DISPATCHER
 * GET /api/reports/hub/summary — HUB_ADMIN
 *
 * All endpoints are org-scoped: counts are derived from live tables.
 * No full payloads; KPI numbers only.
 */
import { Router } from "express";
import { anDb, db } from "@workspace/db";
import {
  anLeistungsanfragenTable,
  anLeistungsantwortenTable,
  projectsTable,
  projectContractorsTable,
  taktRequestsTable,
  takteTable,
  taktResponsesTable,
  resourcesTable,
  resourceBookingsTable,
  messageOutboxTable,
} from "@workspace/db";
import { and, count, eq, sql } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { requireRole } from "../middlewares/requireRole";

const router = Router();

// ── GET /reports/ag/summary ────────────────────────────────────────────────────

router.get(
  "/reports/ag/summary",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const agOrgId = req.user!.orgId!;

    // Number of projects
    const [projectCount] = await db
      .select({ total: count() })
      .from(projectsTable)
      .where(eq(projectsTable.agOrgId, agOrgId));

    // Distinct active subcontractor orgs across all projects
    const [subcontractorCount] = await db
      .select({
        total: sql<number>`COUNT(DISTINCT ${projectContractorsTable.anOrgId})`,
      })
      .from(projectContractorsTable)
      .innerJoin(projectsTable, eq(projectContractorsTable.projectId, projectsTable.id))
      .where(
        and(
          eq(projectsTable.agOrgId, agOrgId),
          eq(projectContractorsTable.assignmentStatus, "ACTIVE"),
        ),
      );

    // TaktRequest status aggregates (GU side)
    const [requestAgg] = await db
      .select({
        open: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} IN ('SENT','DELIVERED','DETAILS_RETRIEVED','UNDER_REVIEW','ALTERNATIVES_PROPOSED','REVISION_REQUIRED'))`,
        overdue: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.responseRequiredBy} < now() AND ${taktRequestsTable.status} IN ('SENT','DELIVERED','DETAILS_RETRIEVED','UNDER_REVIEW'))`,
        accepted: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'ACCEPTED')`,
        alternatives: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'ALTERNATIVES_PROPOSED')`,
        rejected: sql<number>`COUNT(*) FILTER (WHERE ${taktRequestsTable.status} = 'REJECTED')`,
      })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.guOrgId, agOrgId));

    // Confirmed takte scoped to AG's projects
    const [confirmedAgg] = await db
      .select({ total: count() })
      .from(takteTable)
      .innerJoin(projectsTable, eq(takteTable.projectId, projectsTable.id))
      .where(
        and(
          eq(projectsTable.agOrgId, agOrgId),
          eq(takteTable.lifecycleStatus, "CONFIRMED"),
        ),
      );

    res.json({
      projects:                projectCount?.total              ?? 0,
      assignedSubcontractors:  Number(subcontractorCount?.total ?? 0),
      openTaktRequests:        Number(requestAgg?.open          ?? 0),
      overdueTaktRequests:     Number(requestAgg?.overdue       ?? 0),
      acceptedTaktRequests:    Number(requestAgg?.accepted      ?? 0),
      alternativeTaktRequests: Number(requestAgg?.alternatives  ?? 0),
      rejectedTaktRequests:    Number(requestAgg?.rejected      ?? 0),
      confirmedTakts:          confirmedAgg?.total              ?? 0,
    });
  },
);

// ── GET /reports/an/summary ────────────────────────────────────────────────────

router.get(
  "/reports/an/summary",
  requireJwt,
  requireRole("AN_ADMIN", "AN_DISPATCHER"),
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;

    // AN reporting is based exclusively on the immutable local projection.
    // The AG-side request/response tables are deliberately not reachable here:
    // a projected request only exists after its Dataspace inbound delivery.
    const [requestAgg] = await anDb
      .select({
        open:     sql<number>`COUNT(*) FILTER (WHERE ${anLeistungsanfragenTable.status} IN ('RECEIVED','DETAILS_RETRIEVED','UNDER_REVIEW','REVISION_REQUIRED'))`,
        dueSoon:  sql<number>`COUNT(*) FILTER (WHERE ${anLeistungsanfragenTable.status} IN ('RECEIVED','DETAILS_RETRIEVED','UNDER_REVIEW','REVISION_REQUIRED') AND (${anLeistungsanfragenTable.payloadSnapshot}->>'responseRequiredBy')::timestamptz >= now() AND (${anLeistungsanfragenTable.payloadSnapshot}->>'responseRequiredBy')::timestamptz <= now() + interval '24 hours')`,
        overdue:  sql<number>`COUNT(*) FILTER (WHERE ${anLeistungsanfragenTable.status} IN ('RECEIVED','DETAILS_RETRIEVED','UNDER_REVIEW','REVISION_REQUIRED') AND (${anLeistungsanfragenTable.payloadSnapshot}->>'responseRequiredBy')::timestamptz < now())`,
      })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.receiverAnOrgId, nuOrgId));

    // Local response projections are scoped through their local request.
    const [responseAgg] = await anDb
      .select({
        accepted:     sql<number>`COUNT(*) FILTER (WHERE ${anLeistungsantwortenTable.decision} = 'ACCEPTED')`,
        alternatives: sql<number>`COUNT(*) FILTER (WHERE ${anLeistungsantwortenTable.decision} = 'ALTERNATIVES_PROPOSED')`,
        rejected:     sql<number>`COUNT(*) FILTER (WHERE ${anLeistungsantwortenTable.decision} = 'REJECTED')`,
      })
      .from(anLeistungsantwortenTable)
      .innerJoin(
        anLeistungsanfragenTable,
        eq(anLeistungsantwortenTable.anLeistungsanfrageId, anLeistungsanfragenTable.id),
      )
      .where(eq(anLeistungsanfragenTable.receiverAnOrgId, nuOrgId));

    // Active resources
    const [resourceAgg] = await db
      .select({ total: count() })
      .from(resourcesTable)
      .where(
        and(
          eq(resourcesTable.anOrgId, nuOrgId),
          eq(resourcesTable.active, true),
        ),
      );

    // Active resource bookings (non-cancelled)
    const [bookingAgg] = await db
      .select({ total: count() })
      .from(resourceBookingsTable)
      .where(
        and(
          eq(resourceBookingsTable.nuOrgId, nuOrgId),
          sql`${resourceBookingsTable.status} != 'CANCELLED'`,
        ),
      );

    res.json({
      openTaktRequests:       Number(requestAgg?.open          ?? 0),
      dueSoonTaktRequests:    Number(requestAgg?.dueSoon        ?? 0),
      overdueTaktRequests:    Number(requestAgg?.overdue        ?? 0),
      acceptedResponses:      Number(responseAgg?.accepted      ?? 0),
      alternativeResponses:   Number(responseAgg?.alternatives  ?? 0),
      rejectedResponses:      Number(responseAgg?.rejected      ?? 0),
      activeResources:        resourceAgg?.total                ?? 0,
      activeResourceBookings: bookingAgg?.total                 ?? 0,
    });
  },
);

// ── GET /reports/hub/summary ───────────────────────────────────────────────────

router.get(
  "/reports/hub/summary",
  requireJwt,
  requireRole("HUB_ADMIN"),
  async (req, res): Promise<void> => {
    const [outboxAgg] = await db
      .select({
        pending:   sql<number>`COUNT(*) FILTER (WHERE ${messageOutboxTable.status} = 'PENDING')`,
        delivered: sql<number>`COUNT(*) FILTER (WHERE ${messageOutboxTable.status} = 'DELIVERED')`,
        failed:    sql<number>`COUNT(*) FILTER (WHERE ${messageOutboxTable.status} = 'FAILED')`,
        retries:   sql<number>`COALESCE(SUM(${messageOutboxTable.attemptCount}) FILTER (WHERE ${messageOutboxTable.status} = 'FAILED'), 0)`,
      })
      .from(messageOutboxTable);

    res.json({
      pendingMessages:   Number(outboxAgg?.pending   ?? 0),
      deliveredMessages: Number(outboxAgg?.delivered ?? 0),
      failedMessages:    Number(outboxAgg?.failed    ?? 0),
      retryCount:        Number(outboxAgg?.retries   ?? 0),
    });
  },
);

export default router;

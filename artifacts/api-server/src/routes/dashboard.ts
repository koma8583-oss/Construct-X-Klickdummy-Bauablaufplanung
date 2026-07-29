import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  delegationsTable,
  delegationResponsesTable,
  takteTable,
  organizationsTable,
  resourcesTable,
  resourceAssignmentsTable,
} from "@workspace/db";
import { eq, and, count, gte, lte } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";

const router = Router();

// GET /dashboard/ag
router.get("/dashboard/ag", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;

  const [totalProjectsRow] = await db
    .select({ count: count() })
    .from(projectsTable)
    .where(eq(projectsTable.agOrgId, orgId));

  const [activeProjectsRow] = await db
    .select({ count: count() })
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.agOrgId, orgId),
        eq(projectsTable.status, "ACTIVE"),
      ),
    );

  const [pendingRow] = await db
    .select({ count: count() })
    .from(delegationsTable)
    .where(
      and(
        eq(delegationsTable.agOrgId, orgId),
        eq(delegationsTable.status, "PENDING"),
      ),
    );

  const [confirmedRow] = await db
    .select({ count: count() })
    .from(delegationsTable)
    .where(
      and(
        eq(delegationsTable.agOrgId, orgId),
        eq(delegationsTable.status, "CONFIRMED"),
      ),
    );

  const [alternativeRow] = await db
    .select({ count: count() })
    .from(delegationsTable)
    .where(
      and(
        eq(delegationsTable.agOrgId, orgId),
        eq(delegationsTable.status, "ALTERNATIVE_PROPOSED"),
      ),
    );

  // Critical = outside buffer
  const allAlternatives = await db
    .select({
      response: delegationResponsesTable,
    })
    .from(delegationResponsesTable)
    .innerJoin(
      delegationsTable,
      eq(delegationResponsesTable.delegationId, delegationsTable.id),
    )
    .where(
      and(
        eq(delegationsTable.agOrgId, orgId),
        eq(delegationResponsesTable.agDecision, "PENDING"),
      ),
    );

  const criticalProposals = allAlternatives.filter(
    (a) => !a.response.isWithinBuffer,
  ).length;

  // Upcoming Takte (next 7 days)
  const today = new Date().toISOString().split("T")[0]!;
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;

  const userProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.agOrgId, orgId));

  const projectIds = userProjects.map((p) => p.id);

  const upcomingTakte =
    projectIds.length > 0
      ? await db
          .select()
          .from(takteTable)
          .where(
            and(
              gte(takteTable.plannedStart, today),
              lte(takteTable.plannedStart, in7Days),
            ),
          )
          .limit(10)
      : [];

  const recentActivity = await db
    .select()
    .from(delegationsTable)
    .where(eq(delegationsTable.agOrgId, orgId))
    .orderBy(delegationsTable.updatedAt)
    .limit(10);

  res.json({
    totalProjects: totalProjectsRow?.count ?? 0,
    activeProjects: activeProjectsRow?.count ?? 0,
    pendingDelegations: pendingRow?.count ?? 0,
    confirmedDelegations: confirmedRow?.count ?? 0,
    alternativeProposals: alternativeRow?.count ?? 0,
    criticalProposals,
    upcomingTakte: upcomingTakte.map((t) => ({
      ...t,
      delegationStatus: "UNDELEGATED",
    })),
    recentActivity,
  });
});

// GET /dashboard/an
router.get("/dashboard/an", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;

  const [pendingRow] = await db
    .select({ count: count() })
    .from(delegationsTable)
    .where(
      and(
        eq(delegationsTable.anOrgId, orgId),
        eq(delegationsTable.status, "PENDING"),
      ),
    );

  const [confirmedRow] = await db
    .select({ count: count() })
    .from(delegationsTable)
    .where(
      and(
        eq(delegationsTable.anOrgId, orgId),
        eq(delegationsTable.status, "CONFIRMED"),
      ),
    );

  // Upcoming deadlines (confirmed delegations starting soon)
  const today = new Date().toISOString().split("T")[0]!;
  const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;

  const upcomingDeadlinesRaw = await db
    .select({
      delegation: delegationsTable,
      takt: takteTable,
      agOrganization: organizationsTable,
    })
    .from(delegationsTable)
    .leftJoin(takteTable, eq(delegationsTable.taktId, takteTable.id))
    .leftJoin(organizationsTable, eq(delegationsTable.agOrgId, organizationsTable.id))
    .where(
      and(
        eq(delegationsTable.anOrgId, orgId),
        eq(delegationsTable.status, "CONFIRMED"),
        gte(delegationsTable.requestedStart, today),
        lte(delegationsTable.requestedStart, in14Days),
      ),
    )
    .limit(10);

  const upcomingDeadlines = upcomingDeadlinesRaw.map(({ delegation, takt, agOrganization }) => ({
    ...delegation,
    takt,
    agOrganization,
  }));

  const resources = await db
    .select()
    .from(resourcesTable)
    .where(eq(resourcesTable.anOrgId, orgId));

  // Simple utilization: count assignments per resource for current month
  const resourceUtilization = await Promise.all(
    resources.slice(0, 10).map(async (resource) => {
      const monthStart = today.substring(0, 8) + "01";
      const monthEnd = today.substring(0, 8) + "31";
      const [assignCount] = await db
        .select({ count: count() })
        .from(resourceAssignmentsTable)
        .where(
          and(
            eq(resourceAssignmentsTable.resourceId, resource.id),
            gte(resourceAssignmentsTable.fromDate, monthStart),
            lte(resourceAssignmentsTable.toDate, monthEnd),
          ),
        );

      const days = assignCount?.count ?? 0;
      const capacityDays = ((resource.dailyCapacityHours ?? 8) / 8) * 22;
      const utilizationPercent = Math.min(
        100,
        Math.round((days / Math.max(capacityDays, 1)) * 100),
      );

      return { resource, utilizationPercent };
    }),
  );

  const recentRequestsRaw = await db
    .select({
      delegation: delegationsTable,
      takt: takteTable,
      agOrganization: organizationsTable,
    })
    .from(delegationsTable)
    .leftJoin(takteTable, eq(delegationsTable.taktId, takteTable.id))
    .leftJoin(organizationsTable, eq(delegationsTable.agOrgId, organizationsTable.id))
    .where(eq(delegationsTable.anOrgId, orgId))
    .orderBy(delegationsTable.createdAt)
    .limit(10);

  const recentRequests = recentRequestsRaw.map(({ delegation, takt, agOrganization }) => ({
    ...delegation,
    takt,
    agOrganization,
  }));

  res.json({
    pendingRequests: pendingRow?.count ?? 0,
    confirmedWork: confirmedRow?.count ?? 0,
    upcomingDeadlines,
    resourceUtilization,
    recentRequests,
  });
});

export default router;

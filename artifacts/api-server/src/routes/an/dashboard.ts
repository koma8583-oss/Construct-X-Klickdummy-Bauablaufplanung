/**
 * AN dashboard route — mounted at /api/an/dashboard/an
 * Counts TaktRequests (new coordination model) for KPI cards.
 * Legacy delegation counts are preserved as 0 to avoid breaking the frontend contract.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  taktRequestsTable,
  takteTable,
  organizationsTable,
  resourcesTable,
  resourceAssignmentsTable,
} from "@workspace/db";
import { eq, and, count, gte, lte, inArray } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";

const router = Router();

router.get("/dashboard/an", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;

  // Pending = requests awaiting NU response (SENT, DELIVERED, DETAILS_RETRIEVED, UNDER_REVIEW)
  const [pendingRow] = await db
    .select({ count: count() })
    .from(taktRequestsTable)
    .where(
      and(
        eq(taktRequestsTable.nuOrgId, orgId),
        inArray(taktRequestsTable.status, [
          "SENT",
          "DELIVERED",
          "DETAILS_RETRIEVED",
          "UNDER_REVIEW",
        ] as const),
      ),
    );

  // Confirmed = GU has confirmed an accepted NU response (CONFIRM_ACCEPTED decision closes the loop)
  // We approximate "confirmed work" as requests where NU responded ACCEPTED and await GU confirmation
  const [confirmedRow] = await db
    .select({ count: count() })
    .from(taktRequestsTable)
    .where(
      and(
        eq(taktRequestsTable.nuOrgId, orgId),
        eq(taktRequestsTable.status, "ACCEPTED"),
      ),
    );

  const nowDate    = new Date();
  const today      = nowDate.toISOString().split("T")[0]!;
  const in14Date   = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  // Upcoming: active requests with responseRequiredBy in the next 14 days
  const upcomingRaw = await db
    .select({
      request: taktRequestsTable,
      takt: takteTable,
      guOrganization: organizationsTable,
    })
    .from(taktRequestsTable)
    .leftJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .leftJoin(organizationsTable, eq(taktRequestsTable.guOrgId, organizationsTable.id))
    .where(
      and(
        eq(taktRequestsTable.nuOrgId, orgId),
        inArray(taktRequestsTable.status, [
          "SENT",
          "DELIVERED",
          "DETAILS_RETRIEVED",
          "UNDER_REVIEW",
        ] as const),
        gte(taktRequestsTable.responseRequiredBy, nowDate),
        lte(taktRequestsTable.responseRequiredBy, in14Date),
      ),
    )
    .limit(10);

  const upcomingDeadlines = upcomingRaw.map(({ request, takt, guOrganization }) => ({
    ...request,
    takt,
    agOrganization: guOrganization,
  }));

  const resources = await db
    .select()
    .from(resourcesTable)
    .where(eq(resourcesTable.anOrgId, orgId));

  const resourceUtilization = await Promise.all(
    resources.slice(0, 10).map(async (resource) => {
      const monthStart = today.substring(0, 8) + "01";
      const monthEnd   = today.substring(0, 8) + "31";
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

      const days           = assignCount?.count ?? 0;
      const capacityDays   = ((resource.dailyCapacityHours ?? 8) / 8) * 22;
      const utilizationPercent = Math.min(
        100,
        Math.round((days / Math.max(capacityDays, 1)) * 100),
      );

      return { resource, utilizationPercent };
    }),
  );

  // Recent requests (latest 10 across all statuses)
  const recentRaw = await db
    .select({
      request: taktRequestsTable,
      takt: takteTable,
      guOrganization: organizationsTable,
    })
    .from(taktRequestsTable)
    .leftJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .leftJoin(organizationsTable, eq(taktRequestsTable.guOrgId, organizationsTable.id))
    .where(eq(taktRequestsTable.nuOrgId, orgId))
    .orderBy(taktRequestsTable.createdAt)
    .limit(10);

  const recentRequests = recentRaw.map(({ request, takt, guOrganization }) => ({
    ...request,
    takt,
    agOrganization: guOrganization,
  }));

  res.json({
    pendingRequests: pendingRow?.count ?? 0,
    confirmedWork:   confirmedRow?.count ?? 0,
    upcomingDeadlines,
    resourceUtilization,
    recentRequests,
  });
});

export default router;

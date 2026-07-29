/**
 * AN dashboard route — mounted at /api/an/dashboard/an
 * (path mirrors the generated hook URL so the fetch interceptor maps correctly)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  delegationsTable,
  takteTable,
  organizationsTable,
  resourcesTable,
  resourceAssignmentsTable,
} from "@workspace/db";
import { eq, and, count, gte, lte } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";

const router = Router();

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

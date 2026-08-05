/**
 * AN dashboard route — mounted at /api/an/dashboard/an
 * KPIs: open requests, policy pending, due soon, active resource bookings.
 * "Nächste Aktionen" list with priority ordering.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  taktRequestsTable,
  takteTable,
  organizationsTable,
  resourceBookingsTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
} from "@workspace/db";
import { eq, and, count, gte, lte, inArray, ne, lt, gt } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";

const router = Router();

router.get("/dashboard/an", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;
  const now   = new Date();
  const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const in14d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const OPEN_STATUSES = ["SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW"] as const;

  // ── KPI 1: Offene Taktanfragen ─────────────────────────────────────────────
  const [openRow] = await db
    .select({ count: count() })
    .from(taktRequestsTable)
    .where(
      and(
        eq(taktRequestsTable.nuOrgId, orgId),
        inArray(taktRequestsTable.status, [...OPEN_STATUSES]),
      ),
    );

  // ── KPI 2: Policy ausstehend ───────────────────────────────────────────────
  // Open requests that have a dataPublicationId but whose policy is not yet accepted
  const openWithPub = await db
    .select({
      id: taktRequestsTable.id,
      dataPublicationId: taktRequestsTable.dataPublicationId,
    })
    .from(taktRequestsTable)
    .where(
      and(
        eq(taktRequestsTable.nuOrgId, orgId),
        inArray(taktRequestsTable.status, [...OPEN_STATUSES]),
      ),
    );

  let policyPendingCount = 0;
  if (openWithPub.length > 0) {
    const pubIds = openWithPub.map(r => r.dataPublicationId).filter(Boolean) as string[];
    if (pubIds.length > 0) {
      const acceptedRecipients = await db
        .select({ pubId: dataPublicationRecipientsTable.publicationId })
        .from(dataPublicationRecipientsTable)
        .where(
          and(
            eq(dataPublicationRecipientsTable.anOrgId, orgId),
            eq(dataPublicationRecipientsTable.status, "ACCEPTED"),
            inArray(dataPublicationRecipientsTable.publicationId, pubIds),
          ),
        );
      const acceptedPubIds = new Set(acceptedRecipients.map(r => r.pubId));
      policyPendingCount = openWithPub.filter(
        r => r.dataPublicationId && !acceptedPubIds.has(r.dataPublicationId),
      ).length;
    }
  }

  // ── KPI 3: Antwort bald fällig (within 48h) ───────────────────────────────
  const [dueSoonRow] = await db
    .select({ count: count() })
    .from(taktRequestsTable)
    .where(
      and(
        eq(taktRequestsTable.nuOrgId, orgId),
        inArray(taktRequestsTable.status, [...OPEN_STATUSES]),
        gte(taktRequestsTable.responseRequiredBy, now),
        lte(taktRequestsTable.responseRequiredBy, in48h),
      ),
    );

  // ── KPI 4: Aktive Ressourcenbelegungen ────────────────────────────────────
  const [bookingRow] = await db
    .select({ count: count() })
    .from(resourceBookingsTable)
    .where(
      and(
        eq(resourceBookingsTable.nuOrgId, orgId),
        inArray(resourceBookingsTable.status, ["CONFIRMED", "TENTATIVE"]),
        lt(resourceBookingsTable.startAt, in14d),
        gt(resourceBookingsTable.endAt, now),
      ),
    );

  // ── "Nächste Aktionen" list (max 5, prioritised) ──────────────────────────
  // Load all open requests with needed fields
  const openRequests = await db
    .select({
      request: taktRequestsTable,
      takt: takteTable,
      guOrg: organizationsTable,
    })
    .from(taktRequestsTable)
    .leftJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .leftJoin(organizationsTable, eq(taktRequestsTable.guOrgId, organizationsTable.id))
    .where(
      and(
        eq(taktRequestsTable.nuOrgId, orgId),
        inArray(taktRequestsTable.status, [...OPEN_STATUSES]),
      ),
    )
    .orderBy(taktRequestsTable.responseRequiredBy)
    .limit(20);

  // Collect accepted pub IDs for action determination
  const allPubIds = openRequests
    .map(r => r.request.dataPublicationId)
    .filter(Boolean) as string[];
  let acceptedSet = new Set<string>();
  if (allPubIds.length > 0) {
    const accepted = await db
      .select({ pubId: dataPublicationRecipientsTable.publicationId })
      .from(dataPublicationRecipientsTable)
      .where(
        and(
          eq(dataPublicationRecipientsTable.anOrgId, orgId),
          eq(dataPublicationRecipientsTable.status, "ACCEPTED"),
          inArray(dataPublicationRecipientsTable.publicationId, allPubIds),
        ),
      );
    acceptedSet = new Set(accepted.map(r => r.pubId));
  }

  // Priority order: 0=overdueResponse > 1=policy > 2=retrieve_data > 3=answer
  function getPriority(
    req: typeof openRequests[0]["request"],
  ): { priority: number; action: string } {
    const deadline = req.responseRequiredBy ? new Date(req.responseRequiredBy) : null;
    const isOverdue = deadline && deadline < now;
    const policyPending =
      req.dataPublicationId && !acceptedSet.has(req.dataPublicationId);

    if (isOverdue) return { priority: 0, action: "OVERDUE" };
    if (policyPending) return { priority: 1, action: "POLICY_PENDING" };
    if (req.status === "DELIVERED" || req.status === "SENT") return { priority: 2, action: "RETRIEVE_DATA" };
    if (req.status === "DETAILS_RETRIEVED") return { priority: 3, action: "ADD_REQUIREMENTS" };
    if (req.status === "UNDER_REVIEW") return { priority: 4, action: "SUBMIT_RESPONSE" };
    return { priority: 5, action: "SUBMIT_RESPONSE" };
  }

  const actions = openRequests
    .map(({ request: req, takt, guOrg }) => ({
      id:             req.id,
      requestNumber:  req.requestNumber,
      status:         req.status,
      responseRequiredBy: req.responseRequiredBy,
      taktBezeichnung: (takt as any)?.taktBezeichnung ?? null,
      gewerk:          (takt as any)?.gewerk ?? null,
      zone:            (takt as any)?.zone ?? null,
      agName:          (guOrg as any)?.name ?? null,
      ...getPriority(req),
    }))
    .sort((a, b) => a.priority - b.priority || 0)
    .slice(0, 5);

  // ── Recent requests (latest 10) ───────────────────────────────────────────
  const recentRaw = await db
    .select({
      request: taktRequestsTable,
      takt:    takteTable,
      guOrg:   organizationsTable,
    })
    .from(taktRequestsTable)
    .leftJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .leftJoin(organizationsTable, eq(taktRequestsTable.guOrgId, organizationsTable.id))
    .where(eq(taktRequestsTable.nuOrgId, orgId))
    .orderBy(taktRequestsTable.createdAt)
    .limit(10);

  const recentRequests = recentRaw.map(({ request: req, takt, guOrg }) => ({
    ...req,
    takt,
    agOrganization: guOrg,
  }));

  // Upcoming deadlines (next 14 days)
  const upcomingRaw = await db
    .select({
      request: taktRequestsTable,
      takt:    takteTable,
      guOrg:   organizationsTable,
    })
    .from(taktRequestsTable)
    .leftJoin(takteTable, eq(taktRequestsTable.taktId, takteTable.id))
    .leftJoin(organizationsTable, eq(taktRequestsTable.guOrgId, organizationsTable.id))
    .where(
      and(
        eq(taktRequestsTable.nuOrgId, orgId),
        inArray(taktRequestsTable.status, [...OPEN_STATUSES]),
        gte(taktRequestsTable.responseRequiredBy, now),
        lte(taktRequestsTable.responseRequiredBy, in14d),
      ),
    )
    .limit(10);

  const upcomingDeadlines = upcomingRaw.map(({ request: req, takt, guOrg }) => ({
    ...req,
    takt,
    agOrganization: guOrg,
  }));

  res.json({
    // KPIs
    pendingRequests:       openRow?.count    ?? 0,
    policyPendingCount:    policyPendingCount,
    dueSoonCount:          dueSoonRow?.count ?? 0,
    activeBookingsCount:   bookingRow?.count ?? 0,
    // Legacy compat
    confirmedWork:         0,
    resourceUtilization:   [],
    // Lists
    nextActions:           actions,
    upcomingDeadlines,
    recentRequests,
  });
});

export default router;

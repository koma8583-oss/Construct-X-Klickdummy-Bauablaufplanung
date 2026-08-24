/**
 * AN Data Offer routes (Task #112).
 *
 * Mounted at /api/an/ (via an/index.ts).
 *
 *   GET  /an/data-offers                          — list offers addressed to this AN
 *   GET  /an/data-offers/:publicationId            — offer detail + policy summary
 *   POST /an/data-offers/:publicationId/accept     — accept policy
 *   POST /an/data-offers/:publicationId/reject     — reject policy
 *   GET  /an/data-offers/:publicationId/content    — pull content (only after accept)
 *
 * Access rules for /content:
 *   - Publication status must be PUBLISHED
 *   - AN must be listed as recipient
 *   - Recipient status must be ACCEPTED
 *   - validUntil must not have passed (or be null)
 *   - Publication must not be WITHDRAWN or SUSPENDED
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  anProjectInvitationsTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  organizationsTable,
  projectsTable,
  projectContractorsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";

const router = Router();

// ── GET /data-offers ──────────────────────────────────────────────────────────
// Returns all offers (OFFERED/ACCEPTED/REJECTED) addressed to the calling AN org.
router.get("/data-offers", requireJwt, async (req, res): Promise<void> => {
  const anOrgId = req.user!.orgId;
  if (!anOrgId) {
    res.status(403).json({ error: "AN organisation required" });
    return;
  }

  const rows = await db
    .select({
      recipient: dataPublicationRecipientsTable,
      pub: dataPublicationsTable,
      agName: organizationsTable.name,
    })
    .from(dataPublicationRecipientsTable)
    .innerJoin(
      dataPublicationsTable,
      eq(dataPublicationRecipientsTable.publicationId, dataPublicationsTable.id),
    )
    .innerJoin(
      organizationsTable,
      eq(dataPublicationsTable.agOrgId, organizationsTable.id),
    )
    .where(eq(dataPublicationRecipientsTable.anOrgId, anOrgId));

  // Load policy codes
  const policyIds = [...new Set(rows.map((r) => r.pub.policyTemplateId))];
  const policies =
    policyIds.length > 0
      ? await db
          .select({ id: policyTemplatesTable.id, code: policyTemplatesTable.code, name: policyTemplatesTable.name })
          .from(policyTemplatesTable)
          .where(
            policyIds.length === 1
              ? eq(policyTemplatesTable.id, policyIds[0])
              : inArray(policyTemplatesTable.id, policyIds as [string, ...string[]]),
          )
      : [];
  const policyMap = new Map(policies.map((p) => [p.id, p]));

  const offers = rows.map((r) => ({
    publicationId: r.pub.id,
    title: r.pub.title,
    agName: r.agName,
    projectReference: r.pub.projectId,
    dataProductType: r.pub.dataProductType,
    version: r.pub.version,
    publicationStatus: r.pub.status,
    recipientStatus: r.recipient.status,
    policyCode: policyMap.get(r.pub.policyTemplateId)?.code ?? null,
    policyName: policyMap.get(r.pub.policyTemplateId)?.name ?? null,
    validFrom: r.pub.validFrom?.toISOString() ?? null,
    validUntil: r.pub.validUntil?.toISOString() ?? null,
    notifiedAt: r.recipient.notifiedAt?.toISOString() ?? null,
    policyAcceptedAt: r.recipient.policyAcceptedAt?.toISOString() ?? null,
    policyRejectedAt: r.recipient.policyRejectedAt?.toISOString() ?? null,
  }));

  res.json(offers);
});

// ── GET /data-offers/:publicationId ──────────────────────────────────────────
// Offer detail including policy summary. AN must be a recipient.
router.get(
  "/data-offers/:publicationId",
  requireJwt,
  async (req, res): Promise<void> => {
    const anOrgId = req.user!.orgId;
    if (!anOrgId) {
      res.status(403).json({ error: "AN organisation required" });
      return;
    }
    const publicationId = req.params.publicationId as string;

    const [recipient] = await db
      .select()
      .from(dataPublicationRecipientsTable)
      .where(
        and(
          eq(dataPublicationRecipientsTable.publicationId, publicationId),
          eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
        ),
      )
      .limit(1);

    if (!recipient) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }

    const [pub] = await db
      .select()
      .from(dataPublicationsTable)
      .where(eq(dataPublicationsTable.id, publicationId))
      .limit(1);

    if (!pub || pub.status === "WITHDRAWN") {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }

    const [policy] = await db
      .select()
      .from(policyTemplatesTable)
      .where(eq(policyTemplatesTable.id, pub.policyTemplateId))
      .limit(1);

    const [agOrg] = await db
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, pub.agOrgId))
      .limit(1);

    // Load project info for the publication (general fields visible before acceptance)
    const [project] = await db
      .select({
        name: projectsTable.name,
        status: projectsTable.status,
        startDate: projectsTable.startDate,
        endDate: projectsTable.endDate,
        location: projectsTable.location,
        description: projectsTable.description,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, pub.projectId))
      .limit(1);

    // Load this AN's package assignments for the publication's project
    const assignments = await db
      .select({
        id: projectContractorsTable.id,
        trade: projectContractorsTable.trade,
        workPackageReference: projectContractorsTable.workPackageReference,
        assignmentStatus: projectContractorsTable.assignmentStatus,
        validFrom: projectContractorsTable.validFrom,
        validTo: projectContractorsTable.validTo,
      })
      .from(projectContractorsTable)
      .where(
        and(
          eq(projectContractorsTable.projectId, pub.projectId),
          eq(projectContractorsTable.anOrgId, anOrgId),
        ),
      );

    res.json({
      publicationId: pub.id,
      title: pub.title,
      description: pub.description,
      dataProductType: pub.dataProductType,
      version: pub.version,
      publicationStatus: pub.status,
      recipientStatus: recipient.status,
      agName: agOrg?.name ?? pub.agOrgId,
      projectReference: pub.projectId,
      validFrom: pub.validFrom?.toISOString() ?? null,
      validUntil: pub.validUntil?.toISOString() ?? null,
      notifiedAt: recipient.notifiedAt?.toISOString() ?? null,
      policyAcceptedAt: recipient.policyAcceptedAt?.toISOString() ?? null,
      policyRejectedAt: recipient.policyRejectedAt?.toISOString() ?? null,
      firstAccessedAt: recipient.firstAccessedAt?.toISOString() ?? null,
      projectInfo: project
        ? {
            name: project.name,
            status: project.status,
            startDate: project.startDate ?? null,
            endDate: project.endDate ?? null,
            location: project.location ?? null,
            description: project.description ?? null,
          }
        : null,
      assignments: assignments.map((a) => ({
        id: a.id,
        trade: a.trade ?? null,
        workPackageReference: a.workPackageReference ?? null,
        assignmentStatus: a.assignmentStatus,
        validFrom: a.validFrom ?? null,
        validTo: a.validTo ?? null,
      })),
      policy: policy
        ? {
            id: policy.id,
            code: policy.code,
            name: policy.name,
            purpose: policy.purpose,
            permissions: policy.permissions,
            prohibitions: policy.prohibitions,
            validityRule: policy.validityRule,
            retentionRule: policy.retentionRule ?? null,
          }
        : null,
    });
  },
);

// ── POST /data-offers/:publicationId/accept ───────────────────────────────────
router.post(
  "/data-offers/:publicationId/accept",
  requireJwt,
  async (req, res): Promise<void> => {
    const anOrgId = req.user!.orgId;
    if (!anOrgId) {
      res.status(403).json({ error: "AN organisation required" });
      return;
    }
    const publicationId = req.params.publicationId as string;

    const [recipient] = await db
      .select()
      .from(dataPublicationRecipientsTable)
      .where(
        and(
          eq(dataPublicationRecipientsTable.publicationId, publicationId),
          eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
        ),
      )
      .limit(1);

    if (!recipient) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }
    if (recipient.status === "REVOKED" || recipient.status === "EXPIRED") {
      res.status(409).json({ error: "This offer is no longer available" });
      return;
    }
    if (recipient.status === "REJECTED") {
      res.status(409).json({ error: "Cannot accept a previously rejected offer" });
      return;
    }

    // Check parent publication is still PUBLISHED
    const [pub] = await db
      .select({ status: dataPublicationsTable.status })
      .from(dataPublicationsTable)
      .where(eq(dataPublicationsTable.id, publicationId))
      .limit(1);

    if (!pub || pub.status !== "PUBLISHED") {
      res.status(409).json({ error: "Publication is no longer active" });
      return;
    }

    const now = new Date();
    await db
      .update(dataPublicationRecipientsTable)
      .set({ status: "ACCEPTED", policyAcceptedAt: now })
      .where(eq(dataPublicationRecipientsTable.id, recipient.id));

    res.json({ ok: true, status: "ACCEPTED" });
  },
);

// ── POST /data-offers/:publicationId/reject ───────────────────────────────────
router.post(
  "/data-offers/:publicationId/reject",
  requireJwt,
  async (req, res): Promise<void> => {
    const anOrgId = req.user!.orgId;
    if (!anOrgId) {
      res.status(403).json({ error: "AN organisation required" });
      return;
    }
    const publicationId = req.params.publicationId as string;

    const [recipient] = await db
      .select()
      .from(dataPublicationRecipientsTable)
      .where(
        and(
          eq(dataPublicationRecipientsTable.publicationId, publicationId),
          eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
        ),
      )
      .limit(1);

    if (!recipient) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }
    if (recipient.status !== "OFFERED") {
      res.status(409).json({ error: `Cannot reject an offer with status "${recipient.status}". Only OFFERED offers can be rejected.` });
      return;
    }

    const now = new Date();
    await db
      .update(dataPublicationRecipientsTable)
      .set({ status: "REJECTED", policyRejectedAt: now })
      .where(eq(dataPublicationRecipientsTable.id, recipient.id));

    res.json({ ok: true, status: "REJECTED" });
  },
);

// ── GET /data-offers/:publicationId/content ───────────────────────────────────
// Returns the immutable content snapshot.
// Access gated on: PUBLISHED publication, ACCEPTED recipient, validUntil not passed.
router.get(
  "/data-offers/:publicationId/content",
  requireJwt,
  async (req, res): Promise<void> => {
    const anOrgId = req.user!.orgId;
    if (!anOrgId) {
      res.status(403).json({ error: "AN organisation required" });
      return;
    }
    const publicationId = req.params.publicationId as string;

    const [recipient] = await db
      .select()
      .from(dataPublicationRecipientsTable)
      .where(
        and(
          eq(dataPublicationRecipientsTable.publicationId, publicationId),
          eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
        ),
      )
      .limit(1);

    if (!recipient) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }

    if (recipient.status !== "ACCEPTED") {
      res.status(403).json({
        error: "Policy must be accepted before accessing content",
        recipientStatus: recipient.status,
      });
      return;
    }
    // Invitation-coupled offers require the AN's local Dataspace invitation
    // projection to be accepted as well. We intentionally do not query the
    // AG-owned membership table from the AN route.
    if (recipient.projectMembershipId) {
      const [localInvitation] = await db.select({ id: anProjectInvitationsTable.id })
        .from(anProjectInvitationsTable)
        .where(and(
          eq(anProjectInvitationsTable.dataPublicationId, publicationId),
          eq(anProjectInvitationsTable.receiverAnOrgId, anOrgId),
          eq(anProjectInvitationsTable.status, "ACCEPTED"),
        ))
        .limit(1);
      if (!localInvitation) {
        res.status(403).json({ error: "Active project invitation is required before accessing content" });
        return;
      }
    }

    const [pub] = await db
      .select()
      .from(dataPublicationsTable)
      .where(eq(dataPublicationsTable.id, publicationId))
      .limit(1);

    if (!pub) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }

    if (pub.status !== "PUBLISHED") {
      res.status(403).json({ error: "Publication is not currently active", publicationStatus: pub.status });
      return;
    }

    // Expiry check
    if (pub.validUntil && new Date() > pub.validUntil) {
      res.status(403).json({ error: "Publication has expired", validUntil: pub.validUntil.toISOString() });
      return;
    }

    // Record access timestamps
    const now = new Date();
    await db
      .update(dataPublicationRecipientsTable)
      .set({
        firstAccessedAt: recipient.firstAccessedAt ?? now,
        lastAccessedAt: now,
      })
      .where(eq(dataPublicationRecipientsTable.id, recipient.id));

    res.json({
      publicationId: pub.id,
      title: pub.title,
      dataProductType: pub.dataProductType,
      version: pub.version,
      schemaVersion: pub.schemaVersion,
      contentHash: pub.contentHash,
      validFrom: pub.validFrom?.toISOString() ?? null,
      validUntil: pub.validUntil?.toISOString() ?? null,
      publishedAt: pub.publishedAt?.toISOString() ?? null,
      content: pub.contentSnapshot ?? {},
    });
  },
);

export default router;

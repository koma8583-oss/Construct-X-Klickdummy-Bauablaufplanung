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
import { anDb } from "@workspace/db";
import {
  anProjectInvitationsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";
import {
  AnDataOfferError,
  decideAnDataOffer,
} from "../../services/an-data-offer-service";
import { createDataspaceExchange } from "../../services/dataspace/dataspace-exchange-factory";
import { deliverLocalDataOfferResponse } from "../../services/dataspace/local-dataspace-delivery";
import { buildOdrl } from "../../lib/odrl-builder";

const router = Router();

function requireAn(req: Parameters<typeof router.get>[1] extends never ? never : any, res: any): string | null {
  if (!req.user?.orgId || req.user.orgType !== "AN" || req.user.hubAdmin) {
    res.status(403).json({ error: "AN organisation required" });
    return null;
  }
  return req.user.orgId;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown, fallback: string | null = null): string | null {
  return typeof value === "string" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function asIsoDate(value: unknown, fallback: Date | null): string | null {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return fallback?.toISOString() ?? null;
}

function recipientStatus(
  status: "PENDING" | "ACCEPTED" | "REJECTED",
  validUntil?: string | null,
  publicationStatus?: unknown,
): "OFFERED" | "ACCEPTED" | "REJECTED" | "REVOKED" | "EXPIRED" {
  if (publicationStatus === "WITHDRAWN") return "REVOKED";
  if (validUntil && new Date(validUntil) < new Date()) return "EXPIRED";
  return status === "PENDING" ? "OFFERED" : status;
}

function toOffer(invitation: typeof anProjectInvitationsTable.$inferSelect) {
  const dataOffer = asRecord(invitation.dataOfferSnapshot);
  const policy = asRecord(dataOffer.policy ?? invitation.policySnapshot);
  const publicationId = asString(
    dataOffer.publicationId,
    invitation.dataPublicationId ?? invitation.id,
  )!;
  const validUntil = asIsoDate(dataOffer.validUntil, invitation.invitationExpiresAt);
  return {
    publicationId,
    title: asString(dataOffer.title, invitation.dataPublicationTitle ?? invitation.projectName),
    agName: invitation.senderAgOrgName,
    projectName: invitation.projectName,
    projectReference: invitation.projectReference,
    dataProductType: asString(dataOffer.dataProductType, "PROJECT_OVERVIEW"),
    version: asPositiveInteger(dataOffer.publicationVersion ?? dataOffer.version, 1),
    publicationStatus: dataOffer.status === "SUSPENDED" || dataOffer.status === "WITHDRAWN"
      ? dataOffer.status
      : validUntil && new Date(validUntil) < new Date()
        ? "EXPIRED"
        : "PUBLISHED",
     recipientStatus: recipientStatus(invitation.status, validUntil, dataOffer.status),
    policyCode: asString(policy.code, "PROJECT_INVITATION"),
    policyName: asString(policy.name, "Nutzungsrichtlinie"),
    validFrom: asIsoDate(dataOffer.validFrom, invitation.createdAt),
    validUntil,
    notifiedAt: invitation.createdAt.toISOString(),
    policyAcceptedAt: invitation.policyAcceptedAt?.toISOString() ?? null,
    policyRejectedAt: invitation.rejectedAt?.toISOString() ?? null,
  };
}

async function loadLocalOffer(publicationId: string, anOrgId: string) {
  const [invitation] = await anDb.select()
    .from(anProjectInvitationsTable)
    .where(and(
      eq(anProjectInvitationsTable.dataPublicationId, publicationId),
      eq(anProjectInvitationsTable.receiverAnOrgId, anOrgId),
    ))
    .limit(1);
  return invitation ?? null;
}

// ── GET /data-publications/:publicationId/odrl ────────────────────────────────
// The AN app's /api/* requests are routed through /api/an/*. Build the ODRL
// document from the AN-local invitation projection instead of reading AG
// publication or project tables.
router.get(
  "/data-publications/:publicationId/odrl",
  requireJwt,
  async (req, res): Promise<void> => {
    const anOrgId = requireAn(req, res);
    if (!anOrgId) return;
    const publicationId = req.params.publicationId as string;
    const invitation = await loadLocalOffer(publicationId, anOrgId);
    if (!invitation) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }

    const policy = asRecord(invitation.policySnapshot);
    res.json(buildOdrl({
      publicationId: invitation.dataPublicationId ?? invitation.id,
      policyCode: asString(policy.code, "PROJECT_INVITATION") ?? "PROJECT_INVITATION",
      agOrgId: invitation.senderAgOrgId,
      nuOrgId: anOrgId,
      validFrom: invitation.createdAt,
      validUntil: invitation.invitationExpiresAt,
    }));
  },
);

async function deliverDecision(payload: Parameters<typeof deliverLocalDataOfferResponse>[0]) {
  const exchange = createDataspaceExchange();
  const delivery = await deliverLocalDataOfferResponse(payload, exchange);
  if (delivery.status === "PENDING") {
    const retry = await exchange.retryDataOfferResponse(payload.metadata.messageId);
    if (retry.status === "DELIVERED") {
      await deliverLocalDataOfferResponse(payload, exchange);
    }
  }
}

// ── GET /data-offers ──────────────────────────────────────────────────────────
// Returns all offers (OFFERED/ACCEPTED/REJECTED) addressed to the calling AN org.
router.get("/data-offers", requireJwt, async (req, res): Promise<void> => {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const invitations = await anDb.select().from(anProjectInvitationsTable)
    .where(eq(anProjectInvitationsTable.receiverAnOrgId, anOrgId));
  res.json(invitations.filter((invitation) => invitation.dataPublicationId).map(toOffer));
});

// ── GET /data-offers/:publicationId ──────────────────────────────────────────
// Offer detail including policy summary. AN must be a recipient.
router.get(
  "/data-offers/:publicationId",
  requireJwt,
  async (req, res): Promise<void> => {
    const anOrgId = requireAn(req, res);
    if (!anOrgId) return;
    const publicationId = req.params.publicationId as string;
    const invitation = await loadLocalOffer(publicationId, anOrgId);
    if (!invitation) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }
    const dataOffer = asRecord(invitation.dataOfferSnapshot);
    const policy = asRecord(dataOffer.policy ?? invitation.policySnapshot);

    res.json({
      ...toOffer(invitation),
      description: invitation.projectDescription,
      projectInfo: {
        name: invitation.projectName,
        status: "ACTIVE",
        startDate: null,
        endDate: null,
        location: invitation.projectLocation,
        description: invitation.projectDescription,
      },
      assignments: [],
      policy: {
        id: asString(policy.id, invitation.dataPublicationId ?? invitation.id),
        code: asString(policy.code, "PROJECT_INVITATION"),
        name: asString(policy.name, "Nutzungsrichtlinie"),
        purpose: asString(policy.purpose, asString(policy.usagePurpose, "")),
        permissions: asStringList(policy.permissions),
        prohibitions: asStringList(policy.prohibitions),
        validityRule: asString(policy.validityRule, "Gemäß vereinbartem Datenangebot"),
        retentionRule: asString(policy.retentionRule),
      },
    });
  },
);

// ── POST /data-offers/:publicationId/accept ───────────────────────────────────
router.post(
  "/data-offers/:publicationId/accept",
  requireJwt,
  async (req, res): Promise<void> => {
    const anOrgId = requireAn(req, res);
    if (!anOrgId) return;
    const publicationId = req.params.publicationId as string;
    const invitation = await loadLocalOffer(publicationId, anOrgId);
    if (!invitation) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }
    if (invitation.invitationExpiresAt && invitation.invitationExpiresAt < new Date()) {
      res.status(409).json({ error: "This offer is no longer available" });
      return;
    }
    if (invitation.status === "REJECTED") {
      res.status(409).json({ error: "Cannot accept a previously rejected offer" });
      return;
    }
    if (invitation.status === "ACCEPTED") {
      res.json({ ok: true, status: "ACCEPTED" });
      return;
    }
    try {
       const result = await decideAnDataOffer({
         publicationId,
         anOrgId,
         action: "accept",
       });
      await deliverDecision(result.payload);
     } catch (error) {
       if (error instanceof AnDataOfferError) {
        res.status(409).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
    res.json({ ok: true, status: "ACCEPTED" });
  },
);

// ── POST /data-offers/:publicationId/reject ───────────────────────────────────
router.post(
  "/data-offers/:publicationId/reject",
  requireJwt,
  async (req, res): Promise<void> => {
    const anOrgId = requireAn(req, res);
    if (!anOrgId) return;
    const publicationId = req.params.publicationId as string;
    const invitation = await loadLocalOffer(publicationId, anOrgId);
    if (!invitation) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }
    try {
       const result = await decideAnDataOffer({ publicationId, anOrgId, action: "reject" });
      await deliverDecision(result.payload);
    } catch (error) {
       if (error instanceof AnDataOfferError) {
        res.status(409).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
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
    const anOrgId = requireAn(req, res);
    if (!anOrgId) return;
    const publicationId = req.params.publicationId as string;
    const invitation = await loadLocalOffer(publicationId, anOrgId);
    if (!invitation) {
      res.status(404).json({ error: "Data offer not found" });
      return;
    }
    const offer = toOffer(invitation);
    if (invitation.status !== "ACCEPTED") {
      res.status(403).json({
        error: "Policy must be accepted before accessing content",
        recipientStatus: recipientStatus(invitation.status, offer.validUntil, offer.publicationStatus),
      });
      return;
    }
    if (offer.publicationStatus !== "PUBLISHED") {
      res.status(403).json({
        error: `Publication is ${offer.publicationStatus.toLowerCase()}`,
        publicationStatus: offer.publicationStatus,
      });
      return;
    }
    if (offer.validUntil && new Date() > new Date(offer.validUntil)) {
      res.status(403).json({ error: "Publication has expired", validUntil: offer.validUntil });
      return;
    }

    res.json({
      publicationId,
      title: offer.title,
      dataProductType: offer.dataProductType,
      version: offer.version,
      schemaVersion: "1.0",
      contentHash: asString(asRecord(invitation.dataOfferSnapshot).contentHash, null),
      validFrom: offer.validFrom,
      validUntil: offer.validUntil,
      publishedAt: invitation.createdAt.toISOString(),
      content: asRecord(invitation.dataOfferSnapshot).contentSnapshot ?? {
        projectReference: invitation.projectReference,
        projectName: invitation.projectName,
        description: invitation.projectDescription,
        location: invitation.projectLocation,
        selectedFields: asRecord(invitation.dataOfferSnapshot).selectedFields ?? invitation.selectedFields ?? [],
        policy: asRecord(asRecord(invitation.dataOfferSnapshot).policy ?? invitation.policySnapshot),
      },
    });
  },
);

export default router;

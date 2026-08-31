import { Router } from "express";
import {
  anDb,
  anProjectInvitationsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";
import { buildOdrl } from "../../lib/odrl-builder";

const router = Router();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Informative AN policy library. Only active policies are published here.
router.get("/policies", requireJwt, async (req, res): Promise<void> => {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "AN organisation required" });
    return;
  }

  const invitations = await anDb.select().from(anProjectInvitationsTable).where(and(
    eq(anProjectInvitationsTable.receiverAnOrgId, req.user.orgId),
    eq(anProjectInvitationsTable.status, "ACCEPTED"),
  ));

  const byPolicy = new Map<string, {
    policy: Record<string, unknown>;
    projects: Array<{ id: string; name: string; agOrgId: string; agName: string }>;
  }>();
  for (const invitation of invitations) {
    if (!invitation.dataPublicationId) continue;
    const dataOffer = asRecord(invitation.dataOfferSnapshot);
    const policy = asRecord(dataOffer.policy ?? invitation.policySnapshot);
    const policyId = asString(policy.id, invitation.dataPublicationId ?? invitation.id);
    const current = byPolicy.get(policyId) ?? { policy, projects: [] };
    if (!current.projects.some((project) => project.id === invitation.projectReference)) {
      current.projects.push({
        id: invitation.projectReference,
        name: invitation.projectName,
        agOrgId: invitation.senderAgOrgId,
        agName: invitation.senderAgOrgName ?? "Auftraggebername nicht veröffentlicht",
      });
    }
    byPolicy.set(policyId, current);
  }

  res.json([...byPolicy.values()].map(({ policy, projects }) => ({
    id: asString(policy.id, `policy-${asString(policy.code, "project-invitation").toLowerCase()}`),
    code: asString(policy.code, "PROJECT_INVITATION"),
    name: asString(policy.name, "Nutzungsrichtlinie"),
    description: asString(policy.description) || null,
    purpose: asString(policy.purpose, asString(policy.usagePurpose)),
    permissions: asStringList(policy.permissions),
    prohibitions: asStringList(policy.prohibitions),
    validityRule: asString(policy.validityRule, "Gemäß vereinbartem Datenangebot"),
    retentionRule: asString(policy.retentionRule) || null,
    active: true,
    projects,
    odrl: buildOdrl({
      publicationId: `policy-${asString(policy.code, "project-invitation").toLowerCase()}`,
      policyCode: asString(policy.code, "PROJECT_INVITATION"),
      agOrgId: "policy-library",
      nuOrgId: req.user!.orgId!,
      validFrom: null,
      validUntil: null,
    }),
  })));
});

export default router;
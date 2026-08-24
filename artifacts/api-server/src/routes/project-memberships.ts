import { Router, type Request, type Response } from "express";
import { requireJwt } from "../middlewares/requireJwt";
import { requireRole } from "../middlewares/requireRole";
import {
  ProjectMembershipError,
  acceptInvitation,
  inviteParticipant,
  listPendingProjectInvitations,
  listProjectMemberships,
  listFailedProjectInvitationDeliveries,
  retryProjectInvitationDelivery,
  listProjectParticipants,
  rejectInvitation,
  revokeMembership,
} from "../services/project-membership-service";
import { inviteParticipantsWithData } from "../services/project-onboarding-service";
import { z } from "zod";

const router = Router();
router.use(requireJwt);

function sendDomainError(res: Response, error: unknown) {
  if (!(error instanceof ProjectMembershipError)) throw error;
  const status = error.code.endsWith("NOT_FOUND") ? 404
    : error.code.includes("NOT_ACTIVE") || error.code.includes("FORBIDDEN") ? 403
    : error.code.includes("VERIFIED") || error.code.includes("REACHABLE") ? 422
    : error.code.includes("ALREADY") ? 409
    : error.code.includes("NOT_RETRYABLE") || error.code.includes("EXHAUSTED") ? 409
    : 400;
  res.status(status).json({ error: error.message, code: error.code });
}

router.get("/dataspace/participants", requireRole("AG_ADMIN", "GENERAL_PLANNER"), async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (req.query.organizationType !== "AN" || !projectId) {
    res.status(400).json({ error: "organizationType=AN and projectId are required" });
    return;
  }
  if (req.user?.orgType !== "AG" || !req.user.orgId) {
    res.status(403).json({ error: "AG organisation required" });
    return;
  }
  res.json(await listProjectParticipants(projectId, req.user.orgId));
});

router.get("/projects/:projectId/memberships", requireRole("AG_ADMIN", "GENERAL_PLANNER"), async (req, res) => {
  if (req.user?.orgType !== "AG" || !req.user.orgId) {
    res.status(403).json({ error: "AG organisation required" });
    return;
  }
  res.json(await listProjectMemberships(req.params.projectId as string, req.user.orgId));
});

router.get("/projects/:projectId/invitation-deliveries/failed", requireRole("AG_ADMIN", "GENERAL_PLANNER"), async (req, res) => {
  if (req.user?.orgType !== "AG" || !req.user.orgId) {
    res.status(403).json({ error: "AG organisation required" });
    return;
  }
  res.json(await listFailedProjectInvitationDeliveries(req.params.projectId as string, req.user.orgId));
});

router.post("/project-invitation-deliveries/:messageId/retry", requireRole("AG_ADMIN", "GENERAL_PLANNER"), async (req, res) => {
  if (req.user?.orgType !== "AG" || !req.user.orgId) {
    res.status(403).json({ error: "AG organisation required" });
    return;
  }
  try {
    res.json(await retryProjectInvitationDelivery(req.params.messageId as string, req.user.orgId));
  } catch (error) {
    sendDomainError(res, error);
  }
});

const inviteSchema = z.object({
  participantId: z.string().min(1).optional(),
  anOrgId: z.string().min(1).optional(),
  invitationMessage: z.string().max(4000).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
}).refine((data) => Boolean(data.participantId || data.anOrgId), {
  message: "participantId is required",
  path: ["participantId"],
});

router.post("/projects/:projectId/invitations", requireRole("AG_ADMIN", "GENERAL_PLANNER"), async (req, res) => {
  if (req.user?.orgType !== "AG" || !req.user.orgId) {
    res.status(403).json({ error: "AG organisation required" });
    return;
  }
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const membership = await inviteParticipant({
      projectId: req.params.projectId as string,
      agOrgId: req.user.orgId,
       anOrgId: parsed.data.anOrgId,
       participantId: parsed.data.participantId,
      invitationMessage: parsed.data.invitationMessage,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : undefined,
    });
    res.status(201).json(membership);
  } catch (error) {
    sendDomainError(res, error);
  }
});

const combinedInvitationSchema = z.object({
  participantIds: z.array(z.string().min(1)).min(1).max(100),
  invitationMessage: z.string().trim().max(4000).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
  policyTemplateId: z.string().min(1),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional(),
  selectedFields: z.array(z.string().min(1)).min(1).max(100),
  validFrom: z.string().datetime({ offset: true }).optional(),
});

router.post("/projects/:projectId/invitations-with-data", requireRole("AG_ADMIN", "GENERAL_PLANNER"), async (req, res) => {
  if (req.user?.orgType !== "AG" || !req.user.orgId) {
    res.status(403).json({ error: "AG organisation required" });
    return;
  }
  const parsed = combinedInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await inviteParticipantsWithData({
      projectId: req.params.projectId as string,
      agOrgId: req.user.orgId,
      participantIds: parsed.data.participantIds,
      invitationMessage: parsed.data.invitationMessage,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : undefined,
      policyTemplateId: parsed.data.policyTemplateId,
      title: parsed.data.title,
      description: parsed.data.description,
      selectedFields: parsed.data.selectedFields,
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : undefined,
    });
    res.status(201).json(result);
  } catch (error) {
    sendDomainError(res, error);
  }
});

router.post("/project-memberships/:id/revoke", requireRole("AG_ADMIN", "GENERAL_PLANNER"), async (req, res) => {
  if (req.user?.orgType !== "AG" || !req.user.orgId) {
    res.status(403).json({ error: "AG organisation required" });
    return;
  }
  try {
    res.json(await revokeMembership(req.params.id as string, req.user.orgId));
  } catch (error) {
    sendDomainError(res, error);
  }
});

export default router;
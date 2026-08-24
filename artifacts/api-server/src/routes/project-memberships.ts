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
  res.json(await listProjectParticipants(projectId));
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
  anOrgId: z.string().min(1),
  invitationMessage: z.string().max(4000).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
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
      invitationMessage: parsed.data.invitationMessage,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : undefined,
    });
    res.status(201).json(membership);
  } catch (error) {
    sendDomainError(res, error);
  }
});

router.get("/project-invitations", async (req, res) => {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "AN organisation required" });
    return;
  }
  res.json(await listPendingProjectInvitations(req.user.orgId));
});

async function resolveInvitationRoute(
  req: Request,
  res: Response,
  action: "accept" | "reject",
) {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "AN organisation required" });
    return;
  }
  const message = typeof req.body?.message === "string" ? req.body.message : undefined;
  try {
    const membership = action === "accept"
      ? await acceptInvitation(req.params.id as string, req.user.orgId)
      : await rejectInvitation(req.params.id as string, req.user.orgId, message);
    res.json(membership);
  } catch (error) {
    sendDomainError(res, error);
  }
}

router.post("/project-invitations/:id/accept", (req, res) => resolveInvitationRoute(req, res, "accept"));
router.post("/project-invitations/:id/reject", (req, res) => resolveInvitationRoute(req, res, "reject"));

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
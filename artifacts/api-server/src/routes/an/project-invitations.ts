import { Router, type Request, type Response } from "express";
import { requireJwt } from "../../middlewares/requireJwt";
import {
  AnProjectInvitationError,
  decideAnProjectInvitation,
  listAnProjectInvitations,
} from "../../services/an-project-invitation-service";
import { createDataspaceExchange } from "../../services/dataspace/dataspace-exchange-factory";
import { deliverLocalProjectInvitationResponse } from "../../services/dataspace/local-dataspace-delivery";
import { z } from "zod";

const router = Router();
router.use(requireJwt);

function sendError(res: Response, error: unknown) {
  if (!(error instanceof AnProjectInvitationError)) throw error;
  const status = error.code.endsWith("NOT_FOUND") ? 404
    : error.code.includes("ALREADY") ? 409
    : error.code.includes("POLICY") ? 422
    : 400;
  res.status(status).json({ error: error.message, code: error.code });
}

function requireAn(req: Request, res: Response) {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "AN organisation required" });
    return null;
  }
  return req.user.orgId;
}

router.get("/project-invitations", async (req, res) => {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  res.json(await listAnProjectInvitations(anOrgId));
});

const decisionSchema = z.object({
  policyAccepted: z.boolean().optional(),
  message: z.string().trim().max(4000).optional(),
});

router.post("/project-invitations/:id/:action", async (req, res) => {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const action = req.params.action as string;
  if (action !== "accept" && action !== "reject") {
    res.status(404).json({ error: "Unknown invitation action" });
    return;
  }
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await decideAnProjectInvitation({
      id: req.params.id as string,
      anOrgId,
      action,
      policyAccepted: parsed.data.policyAccepted,
      message: parsed.data.message,
    });
    const exchange = createDataspaceExchange();
    const delivery = await deliverLocalProjectInvitationResponse(result.payload, exchange);
    if (delivery.status === "PENDING") {
      await exchange.retryProjectInvitation(result.payload.metadata.messageId);
    }
    res.json(result.invitation);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
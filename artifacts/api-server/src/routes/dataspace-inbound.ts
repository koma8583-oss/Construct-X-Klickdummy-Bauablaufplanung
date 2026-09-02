/**
 * Dataspace inbound routes.
 *
 * Endpoints:
 *   POST /dataspace/inbound/service-requests  — receive an inbound SERVICE_REQUEST
 *   POST /dataspace/inbound/service-responses — receive an inbound SERVICE_RESPONSE
 *
 * Both endpoints dispatch through the idempotent inbound exchange state machine
 * (inbound-exchange-service) via the DataspaceExchange abstraction.  Duplicate
 * deliveries for the same metadata.messageId are silently ignored.
 *
 * Security:
 *   - Dedicated connector token or fresh HMAC signature required.
 *   - The configured connector org must match metadata.receiverOrgId so that a
 *     connector cannot inject messages into another org's exchange.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { requireDataspaceConnector } from "../middlewares/requireDataspaceConnector";
import { createDataspaceExchange } from "../services/dataspace/dataspace-exchange-factory";
import type {
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalDataOfferResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "../services/dataspace/external-contracts";
import {
  externalProjectInvitationSchema,
  externalProjectInvitationResponseSchema,
  externalDataOfferResponseSchema,
  externalServiceRequestSchema,
  externalServiceResponseSchema,
} from "../services/dataspace/external-contracts";
import pino from "pino";
import { processIncomingDataOfferResponse, processIncomingProjectInvitation, processIncomingProjectInvitationResponse, processIncomingServiceRequest, processIncomingServiceResponse } from "../services/dataspace/inbound-domain-service";

const logger = pino({ name: "dataspace-inbound" });
const router = Router();

// Module-level exchange singleton (RestDataspaceExchange or TractusXEdcExchange
// depending on DATASPACE_TRANSPORT env var).
const exchange = createDataspaceExchange();

// ── Helpers ────────────────────────────────────────────────────────────────────

router.post("/dataspace/inbound/project-invitations", requireDataspaceConnector, async (req, res): Promise<void> => {
  const parsed = externalProjectInvitationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: "Invalid project invitation payload", issues: parsed.error.issues }); return; }
  const body = parsed.data;
  const metadata = body.metadata as ExternalProjectInvitation["metadata"];
  if ((req as Request & { dataspaceConnectorOrgId?: string }).dataspaceConnectorOrgId !== metadata.receiverOrgId) { res.status(403).json({ error: "Connector organisation does not match metadata.receiverOrgId" }); return; }
  try {
    const result = await exchange.receiveProjectInvitation(body as ExternalProjectInvitation, processIncomingProjectInvitation);
    res.status(result.duplicate ? 200 : 202).json({ messageId: metadata.messageId, status: result.status });
  } catch (error) {
    logger.error({ err: error, messageId: metadata.messageId }, "receiveProjectInvitation failed");
    if (error instanceof Error && error.message.includes("conflicts")) { res.status(409).json({ error: error.message }); return; }
    res.status(500).json({ error: "Internal error processing inbound project invitation" });
  }
});

router.post("/dataspace/inbound/project-invitation-responses", requireDataspaceConnector, async (req, res): Promise<void> => {
  const parsed = externalProjectInvitationResponseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: "Invalid project invitation response payload", issues: parsed.error.issues }); return; }
  const body = parsed.data;
  const metadata = body.metadata as ExternalProjectInvitationResponse["metadata"];
  if ((req as Request & { dataspaceConnectorOrgId?: string }).dataspaceConnectorOrgId !== metadata.receiverOrgId) { res.status(403).json({ error: "Connector organisation does not match metadata.receiverOrgId" }); return; }
  try {
    const result = await exchange.receiveProjectInvitationResponse(body as ExternalProjectInvitationResponse, processIncomingProjectInvitationResponse);
    res.status(result.duplicate ? 200 : 202).json({ messageId: metadata.messageId, status: result.status });
  } catch (error) {
    logger.error({ err: error, messageId: metadata.messageId }, "receiveProjectInvitationResponse failed");
    if (error instanceof Error && error.message.includes("conflicts")) { res.status(409).json({ error: error.message }); return; }
    res.status(500).json({ error: "Internal error processing inbound project invitation response" });
  }
});

router.post("/dataspace/inbound/data-offer-responses", requireDataspaceConnector, async (req, res): Promise<void> => {
  const parsed = externalDataOfferResponseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Invalid data offer response payload", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data as ExternalDataOfferResponse;
  const metadata = body.metadata;
  if ((req as Request & { dataspaceConnectorOrgId?: string }).dataspaceConnectorOrgId !== metadata.receiverOrgId) {
    res.status(403).json({ error: "Connector organisation does not match metadata.receiverOrgId" });
    return;
  }
  try {
    const result = await exchange.receiveDataOfferResponse(body, processIncomingDataOfferResponse);
    res.status(result.duplicate ? 200 : 202).json({ messageId: metadata.messageId, status: result.status });
  } catch (error) {
    logger.error({ err: error, messageId: metadata.messageId }, "receiveDataOfferResponse failed");
    if (error instanceof Error && error.message.includes("conflicts")) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal error processing inbound data-offer response" });
  }
});

// ── POST /dataspace/inbound/service-requests ───────────────────────────────────

router.post(
  "/dataspace/inbound/service-requests",
  requireDataspaceConnector,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = externalServiceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "Invalid service request payload", issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const metadata = body.metadata as ExternalServiceRequest["metadata"];

    // Security: token org must match the addressed receiver
    const callerOrgId = (req as Request & { dataspaceConnectorOrgId?: string }).dataspaceConnectorOrgId;
    if (!callerOrgId || callerOrgId !== metadata.receiverOrgId) {
      res.status(403).json({
        error: "Connector organisation does not match metadata.receiverOrgId",
      });
      return;
    }

    const payload = body as ExternalServiceRequest;

    try {
      const result = await exchange.receiveServiceRequest(payload, processIncomingServiceRequest);
      logger.info({ messageId: metadata.messageId, duplicate: result.duplicate }, "Inbound service-request processed");
      res.status(result.duplicate ? 200 : 202).json({
        messageId: metadata.messageId,
        status: result.status,
      });
      return;
    } catch (err) {
      // inbound-exchange-service throws when metadata validation fails (bad schemaVersion etc.)
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Invalid external exchange metadata")) {
        res.status(400).json({ error: msg });
        return;
      }
      if (msg.includes("conflicts")) {
        res.status(409).json({ error: msg });
        return;
      }
      logger.error({ err, messageId: metadata.messageId }, "receiveServiceRequest failed");
      res.status(500).json({ error: "Internal error processing inbound message" });
      return;
    }

  },
);

// ── POST /dataspace/inbound/service-responses ──────────────────────────────────

router.post(
  "/dataspace/inbound/service-responses",
  requireDataspaceConnector,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = externalServiceResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "Invalid service response payload", issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const metadata = body.metadata as ExternalServiceResponse["metadata"];

    // Security: token org must match the addressed receiver
    const callerOrgId = (req as Request & { dataspaceConnectorOrgId?: string }).dataspaceConnectorOrgId;
    if (!callerOrgId || callerOrgId !== metadata.receiverOrgId) {
      res.status(403).json({
        error: "Connector organisation does not match metadata.receiverOrgId",
      });
      return;
    }

    const payload = body as ExternalServiceResponse;

    try {
      const result = await exchange.receiveServiceResponse(payload, processIncomingServiceResponse);
      logger.info({ messageId: metadata.messageId, duplicate: result.duplicate }, "Inbound service-response processed");
      res.status(result.duplicate ? 200 : 202).json({
        messageId: metadata.messageId,
        status: result.status,
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Invalid external exchange metadata")) {
        res.status(400).json({ error: msg });
        return;
      }
      if (msg.includes("conflicts")) {
        res.status(409).json({ error: msg });
        return;
      }
      logger.error({ err, messageId: metadata.messageId }, "receiveServiceResponse failed");
      res.status(500).json({ error: "Internal error processing inbound message" });
      return;
    }

  },
);

export default router;

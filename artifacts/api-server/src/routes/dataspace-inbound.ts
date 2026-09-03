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
import { NotificationEnvelopeSchema } from "@workspace/api-zod";
import { requireDataspaceConnector } from "../middlewares/requireDataspaceConnector";
import { createDataspaceExchange } from "../services/dataspace/dataspace-exchange-factory";
import type {
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalDataOfferResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
  ExternalCoordinationDecision,
} from "../services/dataspace/external-contracts";
import {
  externalProjectInvitationSchema,
  externalProjectInvitationResponseSchema,
  externalDataOfferResponseSchema,
  externalDataOfferSchema,
  externalCoordinationDecisionSchema,
  externalServiceRequestSchema,
  externalServiceResponseSchema,
} from "../services/dataspace/external-contracts";
import pino from "pino";
import { processIncomingDataOfferResponse, processIncomingProjectInvitation, processIncomingProjectInvitationResponse, processIncomingServiceRequest, processIncomingServiceResponse } from "../services/dataspace/inbound-domain-service";
import { messageTypeForNotificationContext } from "../services/dataspace/notification-envelope";

const logger = pino({ name: "dataspace-inbound" });
const router = Router();

function localOrgForBpn(bpn: string): string | null {
  const raw = process.env.DATASPACE_PARTICIPANT_BPN_MAP;
  if (!raw) return null;
  try {
    const mapping = JSON.parse(raw) as Record<string, unknown>;
    const match = Object.entries(mapping).find(([, value]) => value === bpn);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Canonical connector ingress. Header context selects the registered operation;
 * only then is the operation-specific content reconstructed for the existing
 * idempotent domain pipeline. Local organisation IDs never cross this route.
 */
router.post("/dataspace/inbound/notifications", requireDataspaceConnector, async (req, res): Promise<void> => {
  const parsed = NotificationEnvelopeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Invalid Notification API envelope", issues: parsed.error.issues });
    return;
  }
  const envelope = parsed.data;
  let operation: string;
  try {
    operation = messageTypeForNotificationContext(envelope.header.context);
  } catch {
    res.status(422).json({ error: "Notification context is not registered" });
    return;
  }
  const senderOrgId = localOrgForBpn(envelope.header.senderBpn);
  const receiverOrgId = localOrgForBpn(envelope.header.receiverBpn);
  const connectorOrgId = (req as Request & { dataspaceConnectorOrgId?: string }).dataspaceConnectorOrgId;
  if (!senderOrgId || !receiverOrgId || !connectorOrgId || connectorOrgId !== receiverOrgId) {
    res.status(403).json({ error: "Notification participants are not mapped to the addressed connector" });
    return;
  }
  const { correlationId, ...content } = envelope.content;
  const metadata = {
    messageId: envelope.header.messageId,
    correlationId: typeof correlationId === "string" ? correlationId : String(content.requestId ?? content.invitationId ?? content.publicationId ?? envelope.header.messageId),
    schemaVersion: "1.0" as const,
    senderOrgId,
    receiverOrgId,
    createdAt: envelope.header.sentDateTime,
    ...(envelope.header.relatedMessageId ? { causationId: envelope.header.relatedMessageId } : {}),
    ...(envelope.header.expectedResponseBy ? { expectedResponseBy: envelope.header.expectedResponseBy } : {}),
  };
  try {
    let result;
    if (operation === "PROJECT_INVITATION") {
      result = await exchange.receiveProjectInvitation(
        externalProjectInvitationSchema.parse({ ...content, metadata }) as ExternalProjectInvitation,
        processIncomingProjectInvitation,
      );
    } else if (operation === "PROJECT_INVITATION_RESPONSE") {
      result = await exchange.receiveProjectInvitationResponse(
        externalProjectInvitationResponseSchema.parse({ ...content, metadata }) as ExternalProjectInvitationResponse,
        processIncomingProjectInvitationResponse,
      );
    } else if (operation === "DATA_OFFER_PUBLISHED") {
      result = await exchange.receiveDataOffer(
        externalDataOfferSchema.parse({ ...content, metadata }),
        undefined,
      );
    } else if (operation === "DATA_OFFER_RESPONSE") {
      result = await exchange.receiveDataOfferResponse(
        externalDataOfferResponseSchema.parse({ ...content, metadata }),
        processIncomingDataOfferResponse,
      );
    } else if (operation === "TAKT_RESPONSE_SUBMITTED" || operation === "SCHEDULE_CHANGE_RESPONSE") {
      result = await exchange.receiveServiceResponse(
        externalServiceResponseSchema.parse({ ...content, metadata }) as ExternalServiceResponse,
        processIncomingServiceResponse,
      );
    } else if (operation === "TAKT_RESPONSE_ACCEPTED" || operation === "TAKT_RESPONSE_REVISION_REQUESTED" || operation === "TAKT_REQUEST_CANCELLED") {
      result = await exchange.receiveCoordinationDecision(
        externalCoordinationDecisionSchema.parse({ ...content, metadata }) as ExternalCoordinationDecision,
        undefined,
      );
    } else if (
      operation === "TAKT_REQUEST_NOTIFICATION" ||
      operation === "TAKT_REQUEST_REVISED" ||
      operation === "SCHEDULE_CHANGE_REQUEST"
    ) {
      result = await exchange.receiveServiceRequest(
        externalServiceRequestSchema.parse({ ...content, metadata }) as ExternalServiceRequest,
        processIncomingServiceRequest,
      );
    } else {
      res.status(422).json({ error: `Notification operation is not inbound-capable: ${operation}` });
      return;
    }
    res.status(result.duplicate ? 200 : 202).json({
      messageId: envelope.header.messageId,
      status: result.status,
      operation,
    });
  } catch (error) {
    logger.error({ err: error, messageId: envelope.header.messageId, operation }, "Notification API inbound processing failed");
    const message = error instanceof Error ? error.message : String(error);
    res.status(message.includes("conflicts") ? 409 : 422).json({ error: message });
  }
});

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

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
 *   - Bearer token required (requireJwt).
 *   - The authenticated org must match metadata.receiverOrgId so that an org
 *     cannot inject messages into another org's exchange.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { requireJwt } from "../middlewares/requireJwt";
import { createDataspaceExchange } from "../services/dataspace/dataspace-exchange-factory";
import type {
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "../services/dataspace/external-contracts";
import pino from "pino";

const logger = pino({ name: "dataspace-inbound" });
const router = Router();

// Module-level exchange singleton (RestDataspaceExchange or TractusXEdcExchange
// depending on DATASPACE_TRANSPORT env var).
const exchange = createDataspaceExchange();

// ── Helpers ────────────────────────────────────────────────────────────────────

function validateMetadataShape(
  metadata: unknown,
): metadata is ExternalServiceRequest["metadata"] {
  if (!metadata || typeof metadata !== "object") return false;
  const m = metadata as Record<string, unknown>;
  return (
    typeof m.messageId === "string" &&
    m.messageId.length > 0 &&
    typeof m.correlationId === "string" &&
    m.correlationId.length > 0 &&
    typeof m.schemaVersion === "string" &&
    typeof m.senderOrgId === "string" &&
    m.senderOrgId.length > 0 &&
    typeof m.receiverOrgId === "string" &&
    m.receiverOrgId.length > 0 &&
    typeof m.createdAt === "string"
  );
}

// ── POST /dataspace/inbound/service-requests ───────────────────────────────────

router.post(
  "/dataspace/inbound/service-requests",
  requireJwt,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Record<string, unknown>;

    // Basic shape validation
    if (!validateMetadataShape(body.metadata)) {
      res.status(400).json({
        error: "Invalid or missing metadata (required: messageId, correlationId, schemaVersion, senderOrgId, receiverOrgId, createdAt)",
      });
      return;
    }

    const metadata = body.metadata as ExternalServiceRequest["metadata"];

    // Security: token org must match the addressed receiver
    const callerOrgId = req.user?.orgId;
    if (!callerOrgId || callerOrgId !== metadata.receiverOrgId) {
      res.status(403).json({
        error: "Authenticated organisation does not match metadata.receiverOrgId",
      });
      return;
    }

    if (
      typeof body.requestId !== "string" ||
      typeof body.requestVersion !== "number" ||
      typeof body.projectReference !== "string" ||
      typeof body.plannedStart !== "string" ||
      typeof body.plannedEnd !== "string" ||
      !Array.isArray(body.resourceRequirements)
    ) {
      res.status(422).json({ error: "Missing required fields: requestId, requestVersion, projectReference, plannedStart, plannedEnd, resourceRequirements" });
      return;
    }

    const payload: ExternalServiceRequest = {
      metadata,
      requestId: body.requestId as string,
      requestVersion: body.requestVersion as number,
      projectReference: body.projectReference as string,
      plannedStart: body.plannedStart as string,
      plannedEnd: body.plannedEnd as string,
      resourceRequirements: body.resourceRequirements as ExternalServiceRequest["resourceRequirements"],
      policy: (body.policy ?? undefined) as ExternalServiceRequest["policy"],
    };

    let duplicate = false;
    try {
      await exchange.receiveServiceRequest(payload, undefined);
    } catch (err) {
      // inbound-exchange-service throws when metadata validation fails (bad schemaVersion etc.)
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Invalid external exchange metadata")) {
        res.status(400).json({ error: msg });
        return;
      }
      logger.error({ err, messageId: metadata.messageId }, "receiveServiceRequest failed");
      res.status(500).json({ error: "Internal error processing inbound message" });
      return;
    }

    logger.info({ messageId: metadata.messageId, duplicate }, "Inbound service-request processed");
    res.status(202).json({
      messageId: metadata.messageId,
      status: duplicate ? "DUPLICATE" : "ACCEPTED",
    });
  },
);

// ── POST /dataspace/inbound/service-responses ──────────────────────────────────

router.post(
  "/dataspace/inbound/service-responses",
  requireJwt,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Record<string, unknown>;

    if (!validateMetadataShape(body.metadata)) {
      res.status(400).json({
        error: "Invalid or missing metadata (required: messageId, correlationId, schemaVersion, senderOrgId, receiverOrgId, createdAt)",
      });
      return;
    }

    const metadata = body.metadata as ExternalServiceResponse["metadata"];

    // Security: token org must match the addressed receiver
    const callerOrgId = req.user?.orgId;
    if (!callerOrgId || callerOrgId !== metadata.receiverOrgId) {
      res.status(403).json({
        error: "Authenticated organisation does not match metadata.receiverOrgId",
      });
      return;
    }

    const VALID_DECISIONS = new Set(["ACCEPTED", "REJECTED", "ALTERNATIVES_PROPOSED"]);
    if (
      typeof body.requestId !== "string" ||
      typeof body.requestVersion !== "number" ||
      typeof body.decision !== "string" ||
      !VALID_DECISIONS.has(body.decision as string)
    ) {
      res.status(422).json({ error: "Missing or invalid required fields: requestId, requestVersion, decision (ACCEPTED|REJECTED|ALTERNATIVES_PROPOSED)" });
      return;
    }

    const payload: ExternalServiceResponse = {
      metadata,
      requestId: body.requestId as string,
      requestVersion: body.requestVersion as number,
      decision: body.decision as ExternalServiceResponse["decision"],
      alternatives: (body.alternatives ?? undefined) as ExternalServiceResponse["alternatives"],
    };

    try {
      await exchange.receiveServiceResponse(payload, undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Invalid external exchange metadata")) {
        res.status(400).json({ error: msg });
        return;
      }
      logger.error({ err, messageId: metadata.messageId }, "receiveServiceResponse failed");
      res.status(500).json({ error: "Internal error processing inbound message" });
      return;
    }

    logger.info({ messageId: metadata.messageId }, "Inbound service-response processed");
    res.status(202).json({
      messageId: metadata.messageId,
      status: "ACCEPTED",
    });
  },
);

export default router;

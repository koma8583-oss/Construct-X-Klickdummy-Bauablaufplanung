import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 300;

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Dataspace ingress is connector-to-connector traffic, not browser traffic.
 * It therefore deliberately does not accept a user JWT. Deployments may use
 * either a dedicated connector bearer token or HMAC signing (prefer HMAC).
 */
export function requireDataspaceConnector(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configuredToken =
    process.env.DATASPACE_INBOUND_CONNECTOR_TOKEN ??
    process.env.DATASPACE_CONNECTOR_TOKEN;
  const signingSecret =
    process.env.DATASPACE_INBOUND_SIGNING_SECRET ??
    process.env.DATASPACE_CONNECTOR_SIGNING_SECRET;
  const connectorOrgId =
    process.env.DATASPACE_INBOUND_ORG_ID ??
    process.env.DATASPACE_CONNECTOR_ORG_ID;

  const authorization = req.headers.authorization;
  const connectorHeader = req.header("x-dataspace-connector-token");
  const provided = connectorHeader ??
    (/^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1] ?? "");
  if (configuredToken && provided) {
    if (constantTimeEqual(configuredToken, provided)) {
      if (connectorOrgId) {
        (req as Request & { dataspaceConnectorOrgId?: string }).dataspaceConnectorOrgId = connectorOrgId;
      }
      next();
      return;
    }
  }

  if (signingSecret) {
    const timestamp = req.header("x-dataspace-timestamp");
    const signatureHeader = req.header("x-dataspace-signature");
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const timestampSeconds = timestamp ? Number(timestamp) : NaN;
    const fresh =
      Number.isInteger(timestampSeconds) &&
      Math.abs(Date.now() / 1000 - timestampSeconds) <= MAX_CLOCK_SKEW_SECONDS;
    const signature = signatureHeader?.replace(/^sha256=/i, "");
    const expected = rawBody && timestamp
      ? createHmac("sha256", signingSecret)
        .update(`${timestamp}.${rawBody.toString("utf8")}`)
        .digest("hex")
      : "";
    if (fresh && signature && constantTimeEqual(expected, signature)) {
      if (connectorOrgId) {
        (req as Request & { dataspaceConnectorOrgId?: string }).dataspaceConnectorOrgId = connectorOrgId;
      }
      next();
      return;
    }
  }

  res.status(401).json({ error: "Dataspace connector authentication required" });
}
import { hubDb as db, dataspaceExchangesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  ExternalCoordinationDecision,
  ExternalDataOffer,
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "./external-contracts";
import {
  externalCoordinationDecisionSchema,
  externalDataOfferSchema,
  externalProjectInvitationSchema,
  externalProjectInvitationResponseSchema,
  externalServiceRequestSchema,
  externalServiceResponseSchema,
} from "./external-contracts";

export type InboundProcessResult = {
  duplicate: boolean;
  status: "PROCESSED" | "DUPLICATE";
};

function validateMetadata(payload: { metadata: ExternalServiceRequest["metadata"] }): void {
  const metadata = payload.metadata;
  if (!metadata?.messageId || !metadata.correlationId || metadata.schemaVersion !== "1.0") {
    throw new Error("Invalid external exchange metadata");
  }
}

function payloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload, (_, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = value[key];
      return sorted;
    }, {});
  })).digest("hex");
}

function validatePayload(
  payload: ExternalServiceRequest | ExternalServiceResponse | ExternalProjectInvitation | ExternalProjectInvitationResponse | ExternalDataOffer | ExternalCoordinationDecision,
): void {
  const result =
    "publicationId" in payload
      ? externalDataOfferSchema.safeParse(payload)
      : "invitationId" in payload
      ? ("decision" in payload
        ? externalProjectInvitationResponseSchema.safeParse(payload)
        : externalProjectInvitationSchema.safeParse(payload))
      : ("decisionType" in payload
        ? externalCoordinationDecisionSchema.safeParse(payload)
        : ("decision" in payload
        ? externalServiceResponseSchema.safeParse(payload)
        : externalServiceRequestSchema.safeParse(payload)));
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid external exchange payload: ${details}`);
  }
}

async function processIncoming<T extends ExternalServiceRequest | ExternalServiceResponse | ExternalCoordinationDecision>(
  payload: T,
  messageType:
    | "SERVICE_REQUEST"
    | "SERVICE_RESPONSE"
    | "TAKT_RESPONSE_ACCEPTED"
    | "TAKT_RESPONSE_REVISION_REQUESTED"
    | "TAKT_REQUEST_CANCELLED",
  process?: (payload: T) => Promise<void>,
): Promise<InboundProcessResult> {
  validateMetadata(payload);
  validatePayload(payload);

  // The insert is the claim. Only its winner may execute business logic, so two
  // simultaneous deliveries cannot both produce side effects. A FAILED row is
  // claimable for an intentional retry; RECEIVED means another delivery owns it.
  const [inserted] = await db.insert(dataspaceExchangesTable).values({
    direction: "INBOUND",
    messageType,
    messageId: payload.metadata.messageId,
    correlationId: payload.metadata.correlationId,
    senderOrgId: payload.metadata.senderOrgId,
    receiverOrgId: payload.metadata.receiverOrgId,
    businessObjectId: payload.requestId,
    businessObjectVersion: payload.requestVersion,
    payloadHash: payloadHash(payload),
    status: "RECEIVED",
  }).onConflictDoNothing().returning();

  let exchange = inserted;
  if (!exchange) {
    const [existing] = await db.select().from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.direction, "INBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      )).limit(1);
    if (!existing) {
      return { duplicate: true, status: "DUPLICATE" };
    }
    if (
      existing.messageType !== messageType ||
      existing.correlationId !== payload.metadata.correlationId ||
      existing.senderOrgId !== payload.metadata.senderOrgId ||
      existing.receiverOrgId !== payload.metadata.receiverOrgId ||
      existing.businessObjectId !== payload.requestId ||
      existing.businessObjectVersion !== payload.requestVersion ||
      (existing.payloadHash && existing.payloadHash !== payloadHash(payload))
    ) throw new Error("Inbound messageId conflicts with an existing exchange");
    if (existing.status === "PROCESSED" || existing.status === "RECEIVED") {
      return { duplicate: true, status: "DUPLICATE" };
    }

    // Claim a failed delivery atomically. If another retry won the claim, this
    // request is a duplicate and must not invoke the processor.
    const [claimed] = await db.update(dataspaceExchangesTable)
      .set({ status: "RECEIVED", errorCode: null, updatedAt: new Date() })
      .where(and(
        eq(dataspaceExchangesTable.id, existing.id),
        eq(dataspaceExchangesTable.status, "FAILED"),
      )).returning();
    if (!claimed) return { duplicate: true, status: "DUPLICATE" };
    exchange = claimed;
  }

  try {
    await process?.(payload);
    await db.update(dataspaceExchangesTable).set({ status: "PROCESSED", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
  } catch (error) {
    await db.update(dataspaceExchangesTable).set({ status: "FAILED", errorCode: error instanceof Error ? error.name : "PROCESSING_ERROR", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
    throw error;
  }
  return { duplicate: false, status: "PROCESSED" };
}

async function processIncomingInvitation<T extends ExternalProjectInvitation | ExternalProjectInvitationResponse | ExternalDataOffer>(
  payload: T,
  messageType: "PROJECT_INVITATION" | "PROJECT_INVITATION_RESPONSE" | "DATA_OFFER_PUBLISHED",
  process?: (payload: T) => Promise<void>,
): Promise<InboundProcessResult> {
  validateMetadata(payload);
  validatePayload(payload);
  const [inserted] = await db.insert(dataspaceExchangesTable).values({
    direction: "INBOUND",
    messageType,
    messageId: payload.metadata.messageId,
    correlationId: payload.metadata.correlationId,
    senderOrgId: payload.metadata.senderOrgId,
    receiverOrgId: payload.metadata.receiverOrgId,
    businessObjectId: "publicationId" in payload ? payload.publicationId : payload.invitationId,
    businessObjectVersion: "publicationVersion" in payload ? payload.publicationVersion : 1,
    status: "RECEIVED",
  }).onConflictDoNothing().returning();

  let exchange = inserted;
  if (!exchange) {
    const [existing] = await db.select().from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.direction, "INBOUND"),
        eq(dataspaceExchangesTable.messageId, payload.metadata.messageId),
      )).limit(1);
    if (!existing) {
      return { duplicate: true, status: "DUPLICATE" };
    }
    if (
      existing.messageType !== messageType ||
      existing.correlationId !== payload.metadata.correlationId ||
      existing.senderOrgId !== payload.metadata.senderOrgId ||
      existing.receiverOrgId !== payload.metadata.receiverOrgId ||
      existing.businessObjectId !== ("publicationId" in payload ? payload.publicationId : payload.invitationId) ||
      existing.businessObjectVersion !== ("publicationVersion" in payload ? payload.publicationVersion : 1)
    ) throw new Error("Inbound messageId conflicts with an existing exchange");
    if (existing.status === "PROCESSED" || existing.status === "RECEIVED") {
      return { duplicate: true, status: "DUPLICATE" };
    }
    const [claimed] = await db.update(dataspaceExchangesTable)
      .set({ status: "RECEIVED", errorCode: null, updatedAt: new Date() })
      .where(and(eq(dataspaceExchangesTable.id, existing.id), eq(dataspaceExchangesTable.status, "FAILED")))
      .returning();
    if (!claimed) return { duplicate: true, status: "DUPLICATE" };
    exchange = claimed;
  }

  try {
    await process?.(payload);
    await db.update(dataspaceExchangesTable).set({ status: "PROCESSED", updatedAt: new Date() })
      .where(eq(dataspaceExchangesTable.id, exchange.id));
  } catch (error) {
    await db.update(dataspaceExchangesTable).set({
      status: "FAILED",
      errorCode: error instanceof Error ? error.name : "PROCESSING_ERROR",
      updatedAt: new Date(),
    }).where(eq(dataspaceExchangesTable.id, exchange.id));
    throw error;
  }
  return { duplicate: false, status: "PROCESSED" };
}

export async function handleIncomingServiceRequest(
  payload: ExternalServiceRequest,
  process?: (payload: ExternalServiceRequest) => Promise<void>,
): Promise<InboundProcessResult> {
  return processIncoming(payload, "SERVICE_REQUEST", process);
}

export async function handleIncomingServiceResponse(
  payload: ExternalServiceResponse,
  process?: (payload: ExternalServiceResponse) => Promise<void>,
): Promise<InboundProcessResult> {
  return processIncoming(payload, "SERVICE_RESPONSE", process);
}

export async function handleIncomingCoordinationDecision(
  payload: ExternalCoordinationDecision,
  process?: (payload: ExternalCoordinationDecision) => Promise<void>,
): Promise<InboundProcessResult> {
  const messageType =
    payload.decisionType === "CLOSE_WITHOUT_AGREEMENT"
      ? "TAKT_REQUEST_CANCELLED" as const
      : payload.decisionType === "REQUEST_REVISION"
        ? "TAKT_RESPONSE_REVISION_REQUESTED" as const
        : "TAKT_RESPONSE_ACCEPTED" as const;
  return processIncoming(payload, messageType, process);
}

export function handleIncomingProjectInvitation(
  payload: ExternalProjectInvitation,
  process?: (payload: ExternalProjectInvitation) => Promise<void>,
) {
  return processIncomingInvitation(payload, "PROJECT_INVITATION", process);
}

export function handleIncomingProjectInvitationResponse(
  payload: ExternalProjectInvitationResponse,
  process?: (payload: ExternalProjectInvitationResponse) => Promise<void>,
) {
  return processIncomingInvitation(payload, "PROJECT_INVITATION_RESPONSE", process);
}

export function handleIncomingDataOffer(
  payload: ExternalDataOffer,
  process?: (payload: ExternalDataOffer) => Promise<void>,
) {
  return processIncomingInvitation(payload, "DATA_OFFER_PUBLISHED", process);
}

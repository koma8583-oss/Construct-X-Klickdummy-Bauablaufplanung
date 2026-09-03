import { hubDb as db, dataspaceAccessGrantsTable } from "@workspace/db";
import {
  createNotificationEnvelope,
  NotificationEnvelopeSchema,
  type NotificationEnvelope,
  type ConstructXNotificationType,
} from "@workspace/api-zod";
import { and, eq, or, gt, isNull } from "drizzle-orm";

type ConnectorConfig = {
  catalogUrl: string;
  contractNegotiationUrl: string;
  transferProcessUrl: string;
  notificationUrl: string;
  edrUrl?: string;
  notificationAssetId: string;
  accessPolicyId: string;
  usagePolicyId: string;
  counterPartyAddress: string;
  authorization?: string;
};

class ConnectorHttpError extends Error {
  constructor(readonly status: number) {
    super(`Tractus-X connector returned HTTP ${status}`);
    this.name = "ConnectorHttpError";
  }
}

export class TractusXNotConfiguredError extends Error {
  readonly code = "NOT_CONFIGURED";

  constructor(message: string) {
    super(`Tractus-X Notification API is not configured (NOT_CONFIGURED): ${message}`);
    this.name = "TractusXNotConfiguredError";
  }
}

function connectorConfig(): ConnectorConfig {
  const required: Array<[keyof ConnectorConfig, string | undefined]> = [
    ["catalogUrl", process.env.DATASPACE_CONNECTOR_CATALOG_URL],
    ["contractNegotiationUrl", process.env.DATASPACE_CONNECTOR_CONTRACT_NEGOTIATION_URL],
    ["transferProcessUrl", process.env.DATASPACE_CONNECTOR_TRANSFER_PROCESS_URL ?? process.env.DATASPACE_NOTIFICATION_DATA_PLANE_URL],
    ["notificationUrl", process.env.DATASPACE_NOTIFICATION_API_URL ?? process.env.DATASPACE_NOTIFICATION_DATA_PLANE_URL],
    ["notificationAssetId", process.env.DATASPACE_NOTIFICATION_ASSET_ID],
    ["accessPolicyId", process.env.DATASPACE_NOTIFICATION_ACCESS_POLICY_ID],
    ["usagePolicyId", process.env.DATASPACE_NOTIFICATION_USAGE_POLICY_ID],
    ["counterPartyAddress", process.env.DATASPACE_CONNECTOR_COUNTER_PARTY_ADDRESS],
  ];
  const missing = required.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new TractusXNotConfiguredError(`missing configuration: ${missing.join(", ")}`);
  }
  return {
    catalogUrl: required[0][1]!,
    contractNegotiationUrl: required[1][1]!,
    transferProcessUrl: required[2][1]!,
    notificationUrl: required[3][1]!,
    notificationAssetId: required[4][1]!,
    accessPolicyId: required[5][1]!,
    usagePolicyId: required[6][1]!,
    counterPartyAddress: required[7][1]!,
    ...(process.env.DATASPACE_CONNECTOR_EDR_URL
      ? { edrUrl: process.env.DATASPACE_CONNECTOR_EDR_URL }
      : {}),
    ...(process.env.DATASPACE_CONNECTOR_TOKEN
      ? { authorization: `Bearer ${process.env.DATASPACE_CONNECTOR_TOKEN}` }
      : {}),
  };
}

async function connectorJson(
  url: string,
  init: RequestInit,
  authorization?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new ConnectorHttpError(response.status);
  }
  return body;
}

function parseConnectorDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function participantBpn(localOrgId: string): string {
  const raw = process.env.DATASPACE_PARTICIPANT_BPN_MAP;
  if (!raw) throw new TractusXNotConfiguredError("participant BPN mapping is missing");
  let map: Record<string, unknown>;
  try {
    map = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new TractusXNotConfiguredError("participant BPN mapping is not valid JSON");
  }
  const bpn = map[localOrgId];
  if (typeof bpn !== "string" || !/^BPNL[a-zA-Z0-9]{12}$/.test(bpn)) {
    throw new TractusXNotConfiguredError(`no verified BPNL is configured for local participant ${localOrgId}`);
  }
  return bpn;
}

export function notificationEnvelopeForConnector(input: {
  messageId: string;
  messageType: ConstructXNotificationType;
  sentDateTime: string;
  expectedResponseBy?: string;
  relatedMessageId?: string;
  senderOrgId: string;
  receiverOrgId: string;
  content: Record<string, unknown>;
}): NotificationEnvelope {
  return createNotificationEnvelope({
    messageId: input.messageId,
    messageType: input.messageType,
    sentDateTime: input.sentDateTime,
    expectedResponseBy: input.expectedResponseBy,
    relatedMessageId: input.relatedMessageId,
    senderBpn: participantBpn(input.senderOrgId),
    receiverBpn: participantBpn(input.receiverOrgId),
    content: input.content,
  });
}

export async function sendNotificationOverTractusX(
  envelope: NotificationEnvelope,
): Promise<{ externalReference: string }> {
  const config = connectorConfig();
  const validEnvelope = NotificationEnvelopeSchema.parse(envelope);

  // Phase 1: discover the shared Notification API asset.
  const catalog = await connectorJson(config.catalogUrl, {
    method: "POST",
    body: JSON.stringify({
      counterPartyAddress: config.counterPartyAddress,
      protocol: "dataspace-protocol-http",
      querySpec: { filterExpression: [{ operandLeft: "https://w3id.org/edc/v0.0.1/ns/id", operator: "=", operandRight: config.notificationAssetId }] },
    }),
  }, config.authorization);
  const offers = Array.isArray(catalog.dataset) ? catalog.dataset : Array.isArray(catalog) ? catalog : [catalog];
  const assetFound = offers.some((offer) =>
    offer && typeof offer === "object" &&
    (offer as Record<string, unknown>).id === config.notificationAssetId,
  );
  if (!assetFound) {
    throw new Error(`Shared Notification API asset not found: ${config.notificationAssetId}`);
  }

  // Phase 2–4: reuse a valid agreement and EDR. A catalog offer is still
  // checked on every send, but negotiation and transfer are not repeated for
  // every notification.
  const now = new Date();
  const [stored] = await db.select().from(dataspaceAccessGrantsTable).where(and(
    eq(dataspaceAccessGrantsTable.senderBpn, validEnvelope.header.senderBpn),
    eq(dataspaceAccessGrantsTable.receiverBpn, validEnvelope.header.receiverBpn),
    eq(dataspaceAccessGrantsTable.assetId, config.notificationAssetId),
    eq(dataspaceAccessGrantsTable.status, "ACTIVE"),
    or(
      isNull(dataspaceAccessGrantsTable.agreementExpiresAt),
      gt(dataspaceAccessGrantsTable.agreementExpiresAt, now),
    ),
    or(
      isNull(dataspaceAccessGrantsTable.edrExpiresAt),
      gt(dataspaceAccessGrantsTable.edrExpiresAt, now),
    ),
  )).limit(1);

  let contractAgreementId = stored?.contractAgreementId;
  let edrId = stored?.edrId ?? undefined;
  let dataPlaneUrl = stored?.dataPlaneUrl ?? config.notificationUrl;
  let agreementExpiresAt = stored?.agreementExpiresAt ?? undefined;
  let edrExpiresAt = stored?.edrExpiresAt ?? undefined;

  if (!contractAgreementId || !edrId || !stored?.dataPlaneUrl) {
    const negotiation = await connectorJson(config.contractNegotiationUrl, {
      method: "POST",
      body: JSON.stringify({
        counterPartyAddress: config.counterPartyAddress,
        protocol: "dataspace-protocol-http",
        policy: {
          assetId: config.notificationAssetId,
          accessPolicyId: config.accessPolicyId,
          usagePolicyId: config.usagePolicyId,
        },
      }),
    }, config.authorization);
    contractAgreementId = String(negotiation.contractAgreementId ?? negotiation.id ?? "");
    if (!contractAgreementId) throw new Error("Connector did not return a contract agreement ID");
    agreementExpiresAt = parseConnectorDate(
      negotiation.agreementExpiresAt ?? negotiation.validUntil ?? negotiation.expiresAt,
    );

    const transfer = await connectorJson(config.transferProcessUrl, {
      method: "POST",
      headers: { "x-edc-contract-agreement-id": contractAgreementId },
      body: JSON.stringify({
        assetId: config.notificationAssetId,
        contractAgreementId,
        counterPartyAddress: config.counterPartyAddress,
      }),
    }, config.authorization);
    edrId = typeof transfer.edrId === "string"
      ? transfer.edrId
      : typeof transfer.edr === "object" && transfer.edr !== null
        ? String((transfer.edr as Record<string, unknown>).id ?? "")
        : "";
    edrExpiresAt = parseConnectorDate(
      transfer.edrExpiresAt ??
      (typeof transfer.edr === "object" && transfer.edr !== null
        ? (transfer.edr as Record<string, unknown>).expiresAt
        : undefined),
    );
    if (!edrId && config.edrUrl) {
      const edr = await connectorJson(config.edrUrl, { method: "GET" }, config.authorization);
      edrId = String(edr.id ?? edr.edrId ?? "");
      if (typeof edr.endpoint === "string") dataPlaneUrl = edr.endpoint;
      edrExpiresAt = parseConnectorDate(edr.expiresAt ?? edr.validUntil);
    }
    dataPlaneUrl = typeof transfer.dataPlaneUrl === "string"
      ? transfer.dataPlaneUrl
      : typeof transfer.edr === "object" && transfer.edr !== null &&
          typeof (transfer.edr as Record<string, unknown>).endpoint === "string"
        ? String((transfer.edr as Record<string, unknown>).endpoint)
      : config.notificationUrl;
    if (!edrId) throw new Error("Connector did not return an EDR or transfer reference");

    await db.insert(dataspaceAccessGrantsTable).values({
      senderBpn: validEnvelope.header.senderBpn,
      receiverBpn: validEnvelope.header.receiverBpn,
      assetId: config.notificationAssetId,
      contractAgreementId,
      edrId,
      dataPlaneUrl,
      status: "ACTIVE",
      ...(agreementExpiresAt ? { agreementExpiresAt } : {}),
      ...(edrExpiresAt ? { edrExpiresAt } : {}),
      lastValidatedAt: now,
    }).onConflictDoUpdate({
      target: [
        dataspaceAccessGrantsTable.senderBpn,
        dataspaceAccessGrantsTable.receiverBpn,
        dataspaceAccessGrantsTable.assetId,
      ],
      set: {
        contractAgreementId,
        edrId,
        dataPlaneUrl,
        status: "ACTIVE",
        ...(agreementExpiresAt ? { agreementExpiresAt } : {}),
        ...(edrExpiresAt ? { edrExpiresAt } : {}),
        lastValidatedAt: now,
        updatedAt: now,
      },
    });
  } else {
    await db.update(dataspaceAccessGrantsTable).set({
      lastValidatedAt: now,
      updatedAt: now,
    }).where(eq(dataspaceAccessGrantsTable.id, stored.id));
  }

  // Phase 5: the Notification API POST is separate from transfer-process
  // creation. The persisted EDR authorizes this data-plane call.
  let transfer: Record<string, unknown>;
  try {
    transfer = await connectorJson(dataPlaneUrl, {
      method: "POST",
      headers: {
        "x-edc-contract-agreement-id": contractAgreementId,
        "x-edc-edr-id": edrId,
      },
      body: JSON.stringify(validEnvelope),
    }, config.authorization);
  } catch (error) {
    if (stored && error instanceof ConnectorHttpError && [401, 403, 404].includes(error.status)) {
      await db.update(dataspaceAccessGrantsTable).set({
        status: "INVALID",
        updatedAt: new Date(),
      }).where(eq(dataspaceAccessGrantsTable.id, stored.id));
    }
    throw error;
  }
  return {
    externalReference: String(transfer.id ?? transfer.transferProcessId ?? validEnvelope.header.messageId),
  };
}
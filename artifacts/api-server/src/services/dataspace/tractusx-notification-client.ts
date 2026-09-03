import {
  createNotificationEnvelope,
  NotificationEnvelopeSchema,
  type NotificationEnvelope,
  type TaktKoordNotificationType,
} from "@workspace/api-zod";

type ConnectorConfig = {
  catalogUrl: string;
  contractNegotiationUrl: string;
  dataPlaneUrl: string;
  notificationAssetId: string;
  accessPolicyId: string;
  usagePolicyId: string;
  counterPartyAddress: string;
  authorization?: string;
};

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
    ["dataPlaneUrl", process.env.DATASPACE_NOTIFICATION_DATA_PLANE_URL],
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
    dataPlaneUrl: required[2][1]!,
    notificationAssetId: required[3][1]!,
    accessPolicyId: required[4][1]!,
    usagePolicyId: required[5][1]!,
    counterPartyAddress: required[6][1]!,
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
    throw new Error(`Tractus-X connector returned HTTP ${response.status}`);
  }
  return body;
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
  messageType: TaktKoordNotificationType;
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

  // Phase 2: negotiate one contract agreement reused by every operation.
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
  const contractAgreementId = String(
    negotiation.contractAgreementId ?? negotiation.id ?? "",
  );
  if (!contractAgreementId) throw new Error("Connector did not return a contract agreement ID");

  // Phase 3: transfer the NotificationEnvelope through the negotiated data plane.
  const transfer = await connectorJson(config.dataPlaneUrl, {
    method: "POST",
    headers: {
      "x-edc-contract-agreement-id": contractAgreementId,
    },
    body: JSON.stringify(validEnvelope),
  }, config.authorization);
  return {
    externalReference: String(transfer.id ?? transfer.transferProcessId ?? validEnvelope.header.messageId),
  };
}
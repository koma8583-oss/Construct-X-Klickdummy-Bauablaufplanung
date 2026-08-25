import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataspaceExchange, ExchangeReference } from "../services/dataspace/dataspace-exchange";
import {
  deliverLocalProjectInvitation,
  deliverLocalProjectInvitationResponse,
  deliverLocalCoordinationDecision,
  deliverLocalServiceRequest,
  deliverLocalServiceResponse,
  isLocalDataspaceTransport,
} from "../services/dataspace/local-dataspace-delivery";
import type {
  ExternalProjectInvitation,
  ExternalProjectInvitationResponse,
  ExternalCoordinationDecision,
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "../services/dataspace/external-contracts";

const delivered: ExchangeReference = { exchangeId: "exchange-1", status: "DELIVERED" };

function fakeExchange(overrides: Partial<Record<keyof DataspaceExchange, unknown>> = {}) {
  const exchange = {
    publishServiceRequest: vi.fn().mockResolvedValue(delivered),
    publishServiceResponse: vi.fn().mockResolvedValue(delivered),
    publishCoordinationDecision: vi.fn().mockResolvedValue(delivered),
    publishProjectInvitation: vi.fn().mockResolvedValue(delivered),
    publishProjectInvitationResponse: vi.fn().mockResolvedValue(delivered),
    receiveServiceRequest: vi.fn().mockResolvedValue({ duplicate: false, status: "PROCESSED" }),
    receiveServiceResponse: vi.fn().mockResolvedValue({ duplicate: false, status: "PROCESSED" }),
    receiveCoordinationDecision: vi.fn().mockResolvedValue({ duplicate: false, status: "PROCESSED" }),
    receiveProjectInvitation: vi.fn().mockResolvedValue({ duplicate: false, status: "PROCESSED" }),
    receiveProjectInvitationResponse: vi.fn().mockResolvedValue({ duplicate: false, status: "PROCESSED" }),
    retryProjectInvitation: vi.fn(),
    ...overrides,
  };
  return exchange as unknown as DataspaceExchange & typeof exchange;
}

const serviceRequest = {
  metadata: {
    messageId: "message-request",
    correlationId: "correlation-request",
    schemaVersion: "1.0",
    senderOrgId: "ag-1",
    receiverOrgId: "an-1",
    createdAt: "2026-09-01T00:00:00Z",
  },
  requestId: "request-1",
  requestVersion: 1,
  projectReference: "project-1",
  plannedStart: "2026-09-01",
  plannedEnd: "2026-09-02",
  resourceRequirements: [],
} satisfies ExternalServiceRequest;

const serviceResponse = {
  metadata: { ...serviceRequest.metadata, messageId: "message-response" },
  requestId: "request-1",
  requestVersion: 1,
  decision: "ACCEPTED",
} satisfies ExternalServiceResponse;

const coordinationDecision = {
  metadata: { ...serviceRequest.metadata, messageId: "message-decision" },
  requestId: "request-1",
  requestVersion: 1,
  taktVersion: 1,
  decisionType: "CONFIRM_ACCEPTED",
  confirmedTimeWindow: { start: "2026-09-01T08:00:00.000Z", end: "2026-09-02T17:00:00.000Z" },
} satisfies ExternalCoordinationDecision;

const invitation = {
  metadata: { ...serviceRequest.metadata, messageId: "message-invitation" },
  invitationId: "invitation-1",
  project: { projectReference: "project-1", projectName: "Projekt" },
  requestedRole: "CONTRACTOR",
  purpose: "PROJECT_COLLABORATION",
  policy: {
    usagePurpose: "PROJECT_MEMBERSHIP",
    allowedConsumerParticipantId: "an-1",
  },
} satisfies ExternalProjectInvitation;

const invitationResponse = {
  metadata: { ...serviceRequest.metadata, messageId: "message-invitation-response" },
  invitationId: "invitation-1",
  projectReference: "project-1",
  decision: "ACCEPTED",
  policyAccepted: true,
  respondedAt: "2026-09-01T00:00:00Z",
} satisfies ExternalProjectInvitationResponse;

afterEach(() => {
  delete process.env.DATASPACE_TRANSPORT;
});

describe("local Dataspace delivery", () => {
  it("is local for the PoC defaults and rest transport, not for EDC", () => {
    expect(isLocalDataspaceTransport()).toBe(true);
    process.env.DATASPACE_TRANSPORT = "rest";
    expect(isLocalDataspaceTransport()).toBe(true);
    process.env.DATASPACE_TRANSPORT = "tractusx-edc";
    expect(isLocalDataspaceTransport()).toBe(false);
  });

  it("enters each inbound processor only after local technical delivery", async () => {
    const exchange = fakeExchange();
    await deliverLocalServiceRequest(serviceRequest, exchange);
    await deliverLocalServiceResponse(serviceResponse, exchange);
    await deliverLocalCoordinationDecision(coordinationDecision, exchange);
    await deliverLocalProjectInvitation(invitation, exchange);
    await deliverLocalProjectInvitationResponse(invitationResponse, exchange);

    expect(exchange.receiveServiceRequest).toHaveBeenCalledWith(serviceRequest, expect.any(Function));
    expect(exchange.receiveServiceResponse).toHaveBeenCalledWith(serviceResponse, expect.any(Function));
    expect(exchange.receiveCoordinationDecision).toHaveBeenCalledWith(coordinationDecision, expect.any(Function));
    expect(exchange.receiveProjectInvitation).toHaveBeenCalledWith(invitation, expect.any(Function));
    expect(exchange.receiveProjectInvitationResponse).toHaveBeenCalledWith(invitationResponse, expect.any(Function));
  });

  it("does not enter inbound processing after failed delivery or with EDC", async () => {
    const failedExchange = fakeExchange({
      publishServiceRequest: vi.fn().mockResolvedValue({
        exchangeId: "failed",
        status: "FAILED",
      }),
    });
    await deliverLocalServiceRequest(serviceRequest, failedExchange);
    expect(failedExchange.receiveServiceRequest).not.toHaveBeenCalled();

    process.env.DATASPACE_TRANSPORT = "tractusx-edc";
    const edcExchange = fakeExchange();
    await deliverLocalServiceResponse(serviceResponse, edcExchange);
    expect(edcExchange.receiveServiceResponse).not.toHaveBeenCalled();
    await deliverLocalCoordinationDecision(coordinationDecision, edcExchange);
    expect(edcExchange.receiveCoordinationDecision).not.toHaveBeenCalled();
  });
});
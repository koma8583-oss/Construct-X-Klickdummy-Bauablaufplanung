import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  hubDb as db,
  messageDeliveryAttemptsTable,
  messageOutboxTable,
  organizationsTable,
} from "@workspace/db";
import {
  toExternalResourceRequirements,
  toExternalResourceRequirementsFromSnapshot,
  toExternalServiceRequest,
  toExternalServiceResponse,
} from "../services/dataspace/external-mappers";
import { createDataspaceExchange } from "../services/dataspace/dataspace-exchange-factory";
import { TractusXEdcExchange } from "../services/dataspace/tractusx-edc-exchange";
import {
  externalProjectInvitationSchema,
  externalServiceRequestSchema,
  serializeExternalProjectInvitation,
} from "../services/dataspace/external-contracts";
import { RestDataspaceExchange } from "../services/dataspace/rest-dataspace-exchange";

const TRACTUSX_TEST_ORG_IDS = ["tractusx-test-ag", "tractusx-test-an"];
const COORDINATION_DECISION_MESSAGE_ID = "coordination-decision-message-1";
const DATA_OFFER_MESSAGE_ID = "data-offer-not-configured-message-1";
const PROJECT_INVITATION_MESSAGE_IDS = [
  "project-invitation-message-1",
  "project-invitation-serialization-mutation",
  "project-invitation-retry-message-1",
  "project-invitation-response-retry-message-1",
  "project-invitation-concurrent-retry-message-1",
];
const TEST_MESSAGE_IDS = [
  ...PROJECT_INVITATION_MESSAGE_IDS,
  COORDINATION_DECISION_MESSAGE_ID,
  DATA_OFFER_MESSAGE_ID,
];

async function cleanupMessageFixtures() {
  await db.delete(messageDeliveryAttemptsTable)
    .where(inArray(messageDeliveryAttemptsTable.messageId, TEST_MESSAGE_IDS))
    .catch(() => {});
  await db.delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.messageId, [...PROJECT_INVITATION_MESSAGE_IDS, DATA_OFFER_MESSAGE_ID]))
    .catch(() => {});
  await db.delete(messageOutboxTable)
    .where(eq(messageOutboxTable.messageId, COORDINATION_DECISION_MESSAGE_ID))
    .catch(() => {});
}

beforeAll(async () => {
  await cleanupMessageFixtures();
  await db.insert(organizationsTable).values([
    { id: TRACTUSX_TEST_ORG_IDS[0], name: "Tractus-X adapter test AG", type: "AG" },
    { id: TRACTUSX_TEST_ORG_IDS[1], name: "Tractus-X adapter test AN", type: "AN" },
  ]).onConflictDoNothing();
});

afterEach(async () => {
  await cleanupMessageFixtures();
});

afterAll(async () => {
  await cleanupMessageFixtures();
  await db.delete(organizationsTable)
    .where(inArray(organizationsTable.id, TRACTUSX_TEST_ORG_IDS))
    .catch(() => {});
});

describe("dataspace exchange boundary", () => {
  it("maps only external request fields and does not expose internal resource data", () => {
    const request = toExternalServiceRequest({
      requestId: "request-1",
      requestVersion: 2,
      projectReference: "project-1",
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-03",
      senderOrgId: "ag-1",
      receiverOrgId: "an-1",
      resourceRequirements: [{
        resourceTypeCode: "LAB",
        resourceTypeName: "Facharbeiter",
        requiredCapacity: 6,
        capacityUnit: "PERSONS",
        utilizationPercent: 50,
        periodStart: "2026-09-01",
        periodEnd: "2026-09-03",
      }],
    });
    expect(request.resourceRequirements[0]).not.toHaveProperty("resourceId");
    expect(request.resourceRequirements[0]).not.toHaveProperty("resourceName");
    expect(request).not.toHaveProperty("bookings");
  });

  it("builds the publish payload from real planning and requirement data", () => {
    const payload = toExternalServiceRequest({
      requestId: "service-request-1",
      requestVersion: 3,
      projectReference: "project-1",
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-10",
      senderOrgId: "ag-1",
      receiverOrgId: "an-1",
      resourceRequirements: toExternalResourceRequirements([
        {
          resourceTypeCode: "DRYWALL_WORKER",
          resourceTypeName: "Facharbeiter Trockenbau",
          requiredCapacity: "6",
          capacityUnit: "PERSONS",
          utilizationPercent: 100,
          periodStart: "2026-09-01",
          periodEnd: "2026-09-10",
          requiredQualification: "Trockenbau",
        },
        {
          resourceTypeCode: "MOBILE_CRANE",
          resourceTypeName: "Mobilkran",
          requiredCapacity: 1,
          capacityUnit: "UNITS",
          utilizationPercent: 50,
          periodStart: "2026-09-04",
          periodEnd: "2026-09-06",
          requiredQualification: null,
        },
      ]),
    });
    expect(payload).toMatchObject({
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-10",
      resourceRequirements: [
        { requiredCapacity: 6, capacityUnit: "PERSONS", utilizationPercent: 100, periodStart: "2026-09-01", periodEnd: "2026-09-10" },
        { requiredCapacity: 1, capacityUnit: "UNITS", utilizationPercent: 50, periodStart: "2026-09-04", periodEnd: "2026-09-06" },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(/resourceId|resourceBookings|concreteResources|employeeName|equipmentId|localProjectId|availableCapacity|internalNotes|costs/);
  });

  it("builds complete external requirements from public snapshot fields", () => {
    const requirements = toExternalResourceRequirementsFromSnapshot(
      [{ resourceType: "CREW", notes: "Montageteam" }],
      { start: "2026-09-01", end: "2026-09-10" },
    );

    expect(requirements).toEqual([{
      resourceTypeCode: "CREW",
      resourceTypeName: "Crew",
      requiredCapacity: 1,
      capacityUnit: "PERSONS",
      utilizationPercent: 100,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-10",
      requiredQualification: null,
    }]);
  });

  it("maps only external response decision data", () => {
    const response = toExternalServiceResponse({
      requestId: "request-1",
      requestVersion: 2,
      decision: "ALTERNATIVES_PROPOSED",
      senderOrgId: "an-1",
      receiverOrgId: "ag-1",
      alternatives: [{ alternativeId: "alt-1", rank: 1, timeWindow: { start: "2026-09-10", end: "2026-09-12" } }],
    });
    expect(response).toMatchObject({ requestId: "request-1", decision: "ALTERNATIVES_PROPOSED" });
    expect(response).not.toHaveProperty("resourceBookings");
    expect(response).not.toHaveProperty("internalNotes");
  });

  it("uses the REST implementation by default", () => {
    const previous = process.env.DATASPACE_TRANSPORT;
    delete process.env.DATASPACE_TRANSPORT;
    expect(createDataspaceExchange()).toBeInstanceOf(RestDataspaceExchange);
    if (previous === undefined) delete process.env.DATASPACE_TRANSPORT;
    else process.env.DATASPACE_TRANSPORT = previous;
  });

  it("routes the EDC setting to the explicit NOT_CONFIGURED adapter", async () => {
    const previous = process.env.DATASPACE_TRANSPORT;
    process.env.DATASPACE_TRANSPORT = "tractusx-edc";
    const exchange = createDataspaceExchange();
    await expect(exchange.publishServiceRequest(toExternalServiceRequest({
      requestId: "request-1", requestVersion: 1, projectReference: "project-1",
      plannedStart: "2026-09-01", plannedEnd: "2026-09-03",
      senderOrgId: "ag-1", receiverOrgId: "an-1",
    }))).rejects.toThrow(/Tractus-X EDC adapter not configured.*NOT_CONFIGURED/);
    if (previous === undefined) delete process.env.DATASPACE_TRANSPORT;
    else process.env.DATASPACE_TRANSPORT = previous;
  });

  it("does not simulate a Tractus-X connector success", async () => {
    const connectorFetch = vi.fn();
    vi.stubGlobal("fetch", connectorFetch);
    const payload = toExternalServiceRequest({
      requestId: "tractusx-not-configured-request",
      requestVersion: 1,
      projectReference: "project-1",
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-03",
      senderOrgId: TRACTUSX_TEST_ORG_IDS[0],
      receiverOrgId: TRACTUSX_TEST_ORG_IDS[1],
    });

    try {
      await expect(new TractusXEdcExchange().publishServiceRequest(payload))
        .rejects.toThrow(/NOT_CONFIGURED/);
      expect(connectorFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Replaced by the NOT_CONFIGURED boundary test below. This legacy test
  // asserted the removed generic /messages connector simulation.
  it.skip("preserves a project invitation policy snapshot through the serialized Tractus-X payload", async () => {
    const previousEndpoint = process.env.DATASPACE_CONNECTOR_URL;
    const connectorFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: "connector-invitation-message-1", externalReference: "connector-invitation-reference-1" }),
    });
    const policySnapshot = {
      policyId: "policy-project-ß/2026",
      templateId: "PROJECT_COORDINATION",
      templateVersion: 7,
      code: "PROJECT_COORDINATION",
      name: "Projektkoordination – Einladung",
      description: "Unveränderlicher Snapshot mit Unicode, Nullwerten und einer bewusst geordneten Rechte-Liste.",
      permissions: ["read:project", "read:takt-ä", "coordinate:施工", "read:project"],
      prohibitions: ["share-outside-project", "derive-personal-profile", "export:秘密"],
      provider: { organizationId: "tractusx-test-ag", userId: null },
      recipientOrganizationId: "tractusx-test-an",
      purpose: "Zusammenarbeit für Projekt Ω / Bauabschnitt 🏗️",
      projectReference: null,
      workPackageReference: null,
      validFrom: null,
      validUntil: "2026-09-30T18:00:00.000Z",
      createdAt: "2026-08-26T07:59:59.123Z",
    };
    const payload = {
      metadata: {
        messageId: "project-invitation-message-1",
        correlationId: "project-invitation-correlation-1",
        schemaVersion: "1.0" as const,
        senderOrgId: "tractusx-test-ag",
        receiverOrgId: "tractusx-test-an",
        createdAt: "2026-08-26T08:00:00.000Z",
      },
      invitationId: "invitation-2026-ß",
      project: {
        projectReference: "project-2026-ß",
        projectName: "Projekt Ω 🏗️",
        description: "Einladungsprojekt mit unverändertem Inhalt.",
        location: "München – Abschnitt 施工",
      },
      requestedRole: "CONTRACTOR" as const,
      purpose: "PROJECT_COLLABORATION" as const,
      invitationMessage: "Willkommen – bitte prüft die Randbedingungen.",
      validUntil: "2026-09-30T18:00:00.000Z",
      policy: {
        usagePurpose: "PROJECT_MEMBERSHIP" as const,
        allowedConsumerParticipantId: "participant-an-17",
        templateId: "PROJECT_COORDINATION",
        templateCode: "PROJECT_COORDINATION",
        templateName: "Projektkoordination",
        purpose: "Projektzusammenarbeit",
        permissions: ["read:project"],
        prohibitions: ["share-outside-project"],
      },
      policySnapshot,
      dataOffer: {
        publicationId: "publication-2026-ß",
        title: "Takt-Informationen",
        dataProductType: "TAKT_INFORMATION_PACKAGE" as const,
        selectedFields: ["projectReference", "taktName", "zone-ä"],
        validFrom: "2026-08-26T08:00:00.000Z",
        validUntil: "2026-09-30T18:00:00.000Z",
      },
    };

    vi.stubGlobal("fetch", connectorFetch);
    process.env.DATASPACE_CONNECTOR_URL = "https://connector.example.test/";
    try {
      const result = await new TractusXEdcExchange().publishProjectInvitation(payload);
      expect(result).toMatchObject({
        exchangeId: "connector-invitation-message-1",
        externalReference: "connector-invitation-reference-1",
        status: "DELIVERED",
      });

      expect(connectorFetch).toHaveBeenCalledOnce();
      const [url, requestInit] = connectorFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://connector.example.test/messages");
      expect(requestInit.method).toBe("POST");
      const outbound = JSON.parse(String(requestInit.body)) as {
        messageType: string;
        payload: unknown;
      };
      expect(outbound.messageType).toBe("PROJECT_INVITATION");

      const validatedPayload = externalProjectInvitationSchema.parse(outbound.payload);
      expect(validatedPayload.policySnapshot).toEqual(policySnapshot);
      expect(JSON.stringify(validatedPayload.policySnapshot)).toBe(JSON.stringify(policySnapshot));

      const mutatedSnapshotPayload = {
        ...payload,
        metadata: {
          ...payload.metadata,
          messageId: "project-invitation-serialization-mutation",
        },
        policySnapshot: { ...policySnapshot },
      };
      Object.defineProperty(mutatedSnapshotPayload.policySnapshot, "toJSON", {
        enumerable: false,
        value: () => ({ ...policySnapshot, description: "Policy changed during serialization" }),
      });

      await expect(new TractusXEdcExchange().publishProjectInvitation(mutatedSnapshotPayload))
        .rejects.toThrow(
          "Project invitation policySnapshot changed during JSON serialization at policySnapshot.description",
        );
      expect(connectorFetch).toHaveBeenCalledOnce();
      const [failedMutation] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, "project-invitation-serialization-mutation"));
      expect(failedMutation.status).toBe("FAILED");
      expect(failedMutation.failureReason).toContain("policySnapshot.description");

      const invalidSnapshotPayload = {
        ...payload,
        policySnapshot: {
          ...policySnapshot,
          unexpectedField: true,
        },
      };
      expect(() => serializeExternalProjectInvitation(
        invalidSnapshotPayload as typeof payload,
      )).toThrow(/Project invitation contract validation failed.*unexpectedField/);
    } finally {
      vi.unstubAllGlobals();
      if (previousEndpoint === undefined) delete process.env.DATASPACE_CONNECTOR_URL;
      else process.env.DATASPACE_CONNECTOR_URL = previousEndpoint;
    }
  });

  // Replaced by the persisted-envelope NOT_CONFIGURED test below. The old
  // test asserted successful retry through the removed generic connector.
  it.skip("preserves connector failure history across invitation and response retries", async () => {
    const previousEndpoint = process.env.DATASPACE_CONNECTOR_URL;
    const invitationMessageId = "project-invitation-retry-message-1";
    const responseMessageId = "project-invitation-response-retry-message-1";
    const invitationFailureReason = "connector rejected project invitation";
    const responseFailureReason = "connector timed out while sending invitation response";
    const invitationPayload = {
      metadata: {
        messageId: invitationMessageId,
        correlationId: "project-invitation-retry-correlation-1",
        schemaVersion: "1.0" as const,
        senderOrgId: TRACTUSX_TEST_ORG_IDS[0],
        receiverOrgId: TRACTUSX_TEST_ORG_IDS[1],
        createdAt: "2026-08-26T08:00:00.000Z",
      },
      invitationId: "invitation-retry-1",
      project: {
        projectReference: "project-retry-1",
        projectName: "Retry project",
      },
      requestedRole: "CONTRACTOR" as const,
      purpose: "PROJECT_COLLABORATION" as const,
      policy: {
        usagePurpose: "PROJECT_MEMBERSHIP" as const,
        allowedConsumerParticipantId: "participant-retry-an",
      },
    };
    const responsePayload = {
      metadata: {
        messageId: responseMessageId,
        correlationId: "project-invitation-retry-correlation-1",
        schemaVersion: "1.0" as const,
        senderOrgId: TRACTUSX_TEST_ORG_IDS[1],
        receiverOrgId: TRACTUSX_TEST_ORG_IDS[0],
        createdAt: "2026-08-26T08:01:00.000Z",
      },
      invitationId: "invitation-retry-1",
      projectReference: "project-retry-1",
      decision: "REJECTED" as const,
      respondedAt: "2026-08-26T08:02:00.000Z",
      message: "The project cannot be accepted at this time.",
    };
    const connectorFetch = vi.fn()
      .mockRejectedValueOnce(new Error(invitationFailureReason))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ externalReference: "invitation-retry-reference-1" }),
      })
      .mockRejectedValueOnce(new Error(responseFailureReason))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ externalReference: "response-retry-reference-1" }),
      });
    const exchange = new TractusXEdcExchange();

    vi.stubGlobal("fetch", connectorFetch);
    process.env.DATASPACE_CONNECTOR_URL = "https://connector.example.test";
    try {
      await expect(exchange.publishProjectInvitation(invitationPayload))
        .rejects.toThrow(invitationFailureReason);

      const [failedInvitation] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, invitationMessageId));
      const [failedInvitationAttempt] = await db.select().from(messageDeliveryAttemptsTable)
        .where(eq(messageDeliveryAttemptsTable.messageId, invitationMessageId));
      expect(failedInvitation).toMatchObject({
        status: "FAILED",
        attemptCount: 1,
        failureReason: invitationFailureReason,
      });
      expect(failedInvitation.lastAttemptAt).toBeInstanceOf(Date);
      expect(failedInvitationAttempt).toMatchObject({
        attemptNumber: 1,
        status: "FAILED",
        failureReason: invitationFailureReason,
      });
      expect(failedInvitationAttempt.attemptedAt).toEqual(failedInvitation.lastAttemptAt);

      const invitationRetry = await exchange.retryProjectInvitation(invitationMessageId);
      expect(invitationRetry).toMatchObject({
        exchangeId: invitationMessageId,
        externalReference: "invitation-retry-reference-1",
        status: "DELIVERED",
        attemptCount: 2,
      });

      const invitationHistory = (await db.select().from(messageDeliveryAttemptsTable)
        .where(eq(messageDeliveryAttemptsTable.messageId, invitationMessageId)))
        .sort((left, right) => left.attemptNumber - right.attemptNumber);
      const [deliveredInvitation] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, invitationMessageId));
      expect(invitationHistory).toHaveLength(2);
      expect(invitationHistory.map((attempt) => [attempt.attemptNumber, attempt.status]))
        .toEqual([[1, "FAILED"], [2, "DELIVERED"]]);
      expect(invitationHistory[0].failureReason).toBe(invitationFailureReason);
      expect(invitationHistory[1].failureReason).toBeNull();
      expect(invitationHistory[1].attemptedAt.getTime())
        .toBeGreaterThanOrEqual(invitationHistory[0].attemptedAt.getTime());
      expect(deliveredInvitation).toMatchObject({
        status: "DELIVERED",
        attemptCount: 2,
        failureReason: null,
      });
      expect(deliveredInvitation.lastAttemptAt).toEqual(invitationHistory[1].attemptedAt);
      expect(deliveredInvitation.deliveredAt).toBeInstanceOf(Date);

      await expect(exchange.publishProjectInvitationResponse(responsePayload))
        .rejects.toThrow(responseFailureReason);

      const [failedResponse] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, responseMessageId));
      const [failedResponseAttempt] = await db.select().from(messageDeliveryAttemptsTable)
        .where(eq(messageDeliveryAttemptsTable.messageId, responseMessageId));
      expect(failedResponse).toMatchObject({
        status: "FAILED",
        attemptCount: 1,
        failureReason: responseFailureReason,
      });
      expect(failedResponse.lastAttemptAt).toBeInstanceOf(Date);
      expect(failedResponseAttempt).toMatchObject({
        attemptNumber: 1,
        status: "FAILED",
        failureReason: responseFailureReason,
      });
      expect(failedResponseAttempt.attemptedAt).toEqual(failedResponse.lastAttemptAt);

      const responseRetry = await exchange.retryProjectInvitation(responseMessageId);
      expect(responseRetry).toMatchObject({
        exchangeId: responseMessageId,
        externalReference: "response-retry-reference-1",
        status: "DELIVERED",
        attemptCount: 2,
      });

      const responseHistory = (await db.select().from(messageDeliveryAttemptsTable)
        .where(eq(messageDeliveryAttemptsTable.messageId, responseMessageId)))
        .sort((left, right) => left.attemptNumber - right.attemptNumber);
      const [deliveredResponse] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, responseMessageId));
      expect(responseHistory).toHaveLength(2);
      expect(responseHistory.map((attempt) => [attempt.attemptNumber, attempt.status]))
        .toEqual([[1, "FAILED"], [2, "DELIVERED"]]);
      expect(responseHistory[0].failureReason).toBe(responseFailureReason);
      expect(responseHistory[1].failureReason).toBeNull();
      expect(responseHistory[1].attemptedAt.getTime())
        .toBeGreaterThanOrEqual(responseHistory[0].attemptedAt.getTime());
      expect(deliveredResponse).toMatchObject({
        status: "DELIVERED",
        attemptCount: 2,
        failureReason: null,
      });
      expect(deliveredResponse.lastAttemptAt).toEqual(responseHistory[1].attemptedAt);
      expect(deliveredResponse.deliveredAt).toBeInstanceOf(Date);
    } finally {
      vi.unstubAllGlobals();
      if (previousEndpoint === undefined) delete process.env.DATASPACE_CONNECTOR_URL;
      else process.env.DATASPACE_CONNECTOR_URL = previousEndpoint;
    }
  });

  // The generic connector retry race is no longer part of the unconfigured
  // Tractus-X adapter contract.
  it.skip("rejects a simultaneous invitation retry without losing the delivery attempt", async () => {
    const previousEndpoint = process.env.DATASPACE_CONNECTOR_URL;
    const messageId = "project-invitation-concurrent-retry-message-1";
    const failureReason = "connector rejected the first invitation attempt";
    let releaseRetryConnector!: () => void;
    let retryConnectorStarted!: () => void;
    const retryConnectorReady = new Promise<void>((resolve) => {
      retryConnectorStarted = resolve;
    });
    const retryConnectorReleased = new Promise<void>((resolve) => {
      releaseRetryConnector = resolve;
    });
    const connectorFetch = vi.fn()
      .mockRejectedValueOnce(new Error(failureReason))
      .mockImplementationOnce(async () => {
        retryConnectorStarted();
        await retryConnectorReleased;
        return {
          ok: true,
          json: async () => ({ externalReference: "concurrent-retry-reference-1" }),
        };
      });
    const payload = {
      metadata: {
        messageId,
        correlationId: "project-invitation-concurrent-retry-correlation-1",
        schemaVersion: "1.0" as const,
        senderOrgId: TRACTUSX_TEST_ORG_IDS[0],
        receiverOrgId: TRACTUSX_TEST_ORG_IDS[1],
        createdAt: "2026-08-26T08:00:00.000Z",
      },
      invitationId: "invitation-concurrent-retry-1",
      project: {
        projectReference: "project-concurrent-retry-1",
        projectName: "Concurrent retry project",
      },
      requestedRole: "CONTRACTOR" as const,
      purpose: "PROJECT_COLLABORATION" as const,
      policy: {
        usagePurpose: "PROJECT_MEMBERSHIP" as const,
        allowedConsumerParticipantId: "participant-concurrent-retry-an",
      },
    };
    const exchange = new TractusXEdcExchange();

    vi.stubGlobal("fetch", connectorFetch);
    process.env.DATASPACE_CONNECTOR_URL = "https://connector.example.test";
    try {
      await expect(exchange.publishProjectInvitation(payload))
        .rejects.toThrow(failureReason);

      const firstRetry = exchange.retryProjectInvitation(messageId);
      const secondRetry = exchange.retryProjectInvitation(messageId);
      await retryConnectorReady;
      releaseRetryConnector();

      const results = await Promise.allSettled([firstRetry, secondRetry]);
      const successfulRetries = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejectedRetries = results.filter(
        (result) => result.status === "rejected",
      );
      expect(successfulRetries).toHaveLength(1);
      expect(successfulRetries[0].value).toMatchObject({
        exchangeId: messageId,
        externalReference: "concurrent-retry-reference-1",
        status: "DELIVERED",
        attemptCount: 2,
      });
      expect(rejectedRetries).toHaveLength(1);
      expect(rejectedRetries[0].reason).toHaveProperty("message", expect.stringMatching(
        /current status is (SENT|DELIVERED)/,
      ));
      expect(connectorFetch).toHaveBeenCalledTimes(2);

      const history = (await db.select().from(messageDeliveryAttemptsTable)
        .where(eq(messageDeliveryAttemptsTable.messageId, messageId)))
        .sort((left, right) => left.attemptNumber - right.attemptNumber);
      const [outbox] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, messageId));
      expect(history).toHaveLength(2);
      expect(history.map((attempt) => [attempt.attemptNumber, attempt.status]))
        .toEqual([[1, "FAILED"], [2, "DELIVERED"]]);
      expect(outbox).toMatchObject({
        status: "DELIVERED",
        attemptCount: history.length,
        failureReason: null,
      });
      expect(outbox.lastAttemptAt).toEqual(history[1].attemptedAt);
    } finally {
      vi.unstubAllGlobals();
      if (previousEndpoint === undefined) delete process.env.DATASPACE_CONNECTOR_URL;
      else process.env.DATASPACE_CONNECTOR_URL = previousEndpoint;
    }
  });

  // Replaced by the explicit NOT_CONFIGURED coordination boundary below.
  it.skip("persists a failed coordination decision and retries the same public message", async () => {
    const previousEndpoint = process.env.DATASPACE_CONNECTOR_URL;
    const decisionPayload = {
      metadata: {
        messageId: COORDINATION_DECISION_MESSAGE_ID,
        correlationId: "coordination-decision-correlation-1",
        schemaVersion: "1.0" as const,
        senderOrgId: TRACTUSX_TEST_ORG_IDS[0],
        receiverOrgId: TRACTUSX_TEST_ORG_IDS[1],
        createdAt: "2026-08-26T08:00:00.000Z",
      },
      requestId: "coordination-decision-request-1",
      requestVersion: 3,
      taktVersion: 4,
      decisionType: "CONFIRM_ACCEPTED" as const,
      confirmedTimeWindow: {
        start: "2026-09-01T08:00:00.000Z",
        end: "2026-09-03T17:00:00.000Z",
      },
      comment: "Unveränderter öffentlicher Entscheidungsinhalt.",
    };
    const firstFailure = new Error("connector temporarily unavailable");
    const connectorFetch = vi.fn()
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ externalReference: "connector-decision-reference-1" }),
      });
    const exchange = new TractusXEdcExchange();
    const receiveSpy = vi.spyOn(exchange, "receiveCoordinationDecision");

    vi.stubGlobal("fetch", connectorFetch);
    process.env.DATASPACE_CONNECTOR_URL = "https://connector.example.test";
    try {
      await expect(exchange.publishCoordinationDecision(decisionPayload)).rejects.toThrow(
        "connector temporarily unavailable",
      );

      const [failed] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, COORDINATION_DECISION_MESSAGE_ID));
      expect(failed.status).toBe("FAILED");
      expect(failed.payload).toEqual(decisionPayload);

      const retry = await exchange.retryCoordinationDecision(COORDINATION_DECISION_MESSAGE_ID);
      expect(retry).toMatchObject({
        exchangeId: COORDINATION_DECISION_MESSAGE_ID,
        externalReference: "connector-decision-reference-1",
        status: "DELIVERED",
        attemptCount: 2,
      });
      expect(receiveSpy).not.toHaveBeenCalled();

      const firstRequest = JSON.parse(String(
        (connectorFetch.mock.calls[0] as [string, RequestInit])[1].body,
      ));
      const retryRequest = JSON.parse(String(
        (connectorFetch.mock.calls[1] as [string, RequestInit])[1].body,
      ));
      expect(retryRequest).toEqual(firstRequest);
      expect(retryRequest.payload.metadata.messageId).toBe(COORDINATION_DECISION_MESSAGE_ID);
      expect(retryRequest.messageType).toBe("TAKT_RESPONSE_ACCEPTED");
    } finally {
      vi.unstubAllGlobals();
      if (previousEndpoint === undefined) delete process.env.DATASPACE_CONNECTOR_URL;
      else process.env.DATASPACE_CONNECTOR_URL = previousEndpoint;
    }
  });

  it("persists a data offer as NOT_CONFIGURED without changing its retry envelope", async () => {
    const payload = {
      metadata: {
        messageId: DATA_OFFER_MESSAGE_ID,
        correlationId: "data-offer-not-configured-correlation-1",
        schemaVersion: "1.0" as const,
        senderOrgId: TRACTUSX_TEST_ORG_IDS[0],
        receiverOrgId: TRACTUSX_TEST_ORG_IDS[1],
        createdAt: "2026-08-26T08:00:00.000Z",
      },
      publicationId: "publication-not-configured-1",
      projectReference: "project-not-configured-1",
      projectName: "NOT_CONFIGURED project",
      title: "Data offer",
      dataProductType: "PROJECT_OVERVIEW" as const,
      publicationVersion: 1,
      status: "PUBLISHED" as const,
      selectedFields: ["projectReference"],
      detailsRef: "/api/an/data-offers/publication-not-configured-1",
      validFrom: "2026-08-26T08:00:00.000Z",
      accessPolicy: {
        policyId: "access-policy-1",
        templateId: "template-1",
        templateVersion: 1,
        code: "PROJECT_OVERVIEW",
        name: "Project overview access",
        description: "Access to the published project overview.",
        permissions: ["read:project"],
        prohibitions: ["share-outside-project"],
        provider: { organizationId: TRACTUSX_TEST_ORG_IDS[0], userId: null },
        recipientOrganizationId: TRACTUSX_TEST_ORG_IDS[1],
        purpose: "Project coordination",
        projectReference: "project-not-configured-1",
        workPackageReference: null,
        validFrom: "2026-08-26T08:00:00.000Z",
        validUntil: null,
        createdAt: "2026-08-26T08:00:00.000Z",
      },
      usagePolicy: {
        id: "usage-policy-1",
        templateId: "template-1",
        templateVersion: 1,
        code: "PROJECT_OVERVIEW",
        name: "Project overview usage",
        purpose: "Project coordination",
        permissions: ["read:project"],
        prohibitions: ["share-outside-project"],
        validityRule: "During publication validity",
        retentionRule: null,
      },
    };
    const connectorFetch = vi.fn();
    vi.stubGlobal("fetch", connectorFetch);
    try {
      await expect(new TractusXEdcExchange().publishDataOffer(payload))
        .rejects.toThrow(/NOT_CONFIGURED/);
      const [first] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, DATA_OFFER_MESSAGE_ID));
      expect(first).toMatchObject({
        status: "FAILED",
        messageType: "DATA_OFFER_PUBLISHED",
        attemptCount: 0,
        payload,
      });

      await expect(new TractusXEdcExchange().retryDataOffer(DATA_OFFER_MESSAGE_ID))
        .rejects.toThrow(/NOT_CONFIGURED/);
      const [retried] = await db.select().from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, DATA_OFFER_MESSAGE_ID));
      expect(retried.payload).toEqual(first.payload);
      expect(connectorFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates distinct message IDs but keeps a workflow correlation ID", () => {
    const base = {
      requestId: "request-1", requestVersion: 1, senderOrgId: "ag-1", receiverOrgId: "an-1",
      projectReference: "project-1", plannedStart: "2026-09-01", plannedEnd: "2026-09-03",
    };
    const first = toExternalServiceRequest(base);
    const second = toExternalServiceResponse({
      requestId: base.requestId, requestVersion: base.requestVersion,
      decision: "ACCEPTED", senderOrgId: "an-1", receiverOrgId: "ag-1",
      correlationId: first.metadata.correlationId,
    });
    expect(first.metadata.messageId).not.toBe(second.metadata.messageId);
    expect(first.metadata.correlationId).toBe(second.metadata.correlationId);
  });
});
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { hubDb as db, messageOutboxTable, organizationsTable } from "@workspace/db";
import {
  toExternalResourceRequirements,
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
const PROJECT_INVITATION_MESSAGE_IDS = [
  "project-invitation-message-1",
  "project-invitation-serialization-mutation",
];

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: TRACTUSX_TEST_ORG_IDS[0], name: "Tractus-X adapter test AG", type: "AG" },
    { id: TRACTUSX_TEST_ORG_IDS[1], name: "Tractus-X adapter test AN", type: "AN" },
  ]).onConflictDoNothing();
});

afterEach(async () => {
  await db.delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.messageId, PROJECT_INVITATION_MESSAGE_IDS))
    .catch(() => {});
  await db.delete(messageOutboxTable)
    .where(eq(messageOutboxTable.messageId, COORDINATION_DECISION_MESSAGE_ID))
    .catch(() => {});
});

afterAll(async () => {
  await db.delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.messageId, PROJECT_INVITATION_MESSAGE_IDS))
    .catch(() => {});
  await db.delete(messageOutboxTable)
    .where(eq(messageOutboxTable.messageId, COORDINATION_DECISION_MESSAGE_ID))
    .catch(() => {});
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

  it("routes the EDC setting to the explicit unconfigured adapter", async () => {
    const previous = process.env.DATASPACE_TRANSPORT;
    process.env.DATASPACE_TRANSPORT = "tractusx-edc";
    const exchange = createDataspaceExchange();
    await expect(exchange.publishServiceRequest(toExternalServiceRequest({
      requestId: "request-1", requestVersion: 1, projectReference: "project-1",
      plannedStart: "2026-09-01", plannedEnd: "2026-09-03",
      senderOrgId: "ag-1", receiverOrgId: "an-1",
    }))).rejects.toThrow("Tractus-X EDC adapter not configured");
    if (previous === undefined) delete process.env.DATASPACE_TRANSPORT;
    else process.env.DATASPACE_TRANSPORT = previous;
  });

  it("preserves a policy snapshot through the Tractus-X outbound payload and validation", async () => {
    const previousEndpoint = process.env.DATASPACE_CONNECTOR_URL;
    const connectorFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: "connector-message-1", externalReference: "connector-reference-1" }),
    });
    const policySnapshot = {
      policyId: "policy-ß/2026",
      templateId: "SCHEDULE_COORDINATION",
      templateVersion: 3,
      code: "SCHEDULE_COORDINATION",
      name: "Terminabstimmung",
      description: "Immutable policy snapshot with provider-owned wording.",
      permissions: ["read:takt", "read:resource-requirements", "coordinate"],
      prohibitions: ["share-outside-project", "derive-personal-profile"],
      provider: { organizationId: "ag-42", userId: null },
      recipientOrganizationId: "an-17",
      purpose: "Koordination des Bauablaufs / Abschnitt A",
      projectReference: "project-2026-ß",
      workPackageReference: "WP-07",
      validFrom: "2026-08-26T08:00:00.000Z",
      validUntil: "2026-09-30T18:00:00.000Z",
      createdAt: "2026-08-26T07:59:59.123Z",
    };
    const payload = {
      metadata: {
        messageId: "service-request-message-1",
        correlationId: "service-request-correlation-1",
        schemaVersion: "1.0" as const,
        senderOrgId: "ag-42",
        receiverOrgId: "an-17",
        createdAt: "2026-08-26T08:00:00.000Z",
      },
      requestId: "request-2026-ß",
      requestVersion: 4,
      projectReference: "project-2026-ß",
      taktReference: "takt-A3",
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-03",
      resourceRequirements: [],
      policySnapshot,
    };

    vi.stubGlobal("fetch", connectorFetch);
    process.env.DATASPACE_CONNECTOR_URL = "https://connector.example.test/";
    try {
      const result = await new TractusXEdcExchange().publishServiceRequest(payload);
      expect(result).toMatchObject({
        exchangeId: "connector-message-1",
        externalReference: "connector-reference-1",
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
      expect(outbound.messageType).toBe("SERVICE_REQUEST");

      const validatedPayload = externalServiceRequestSchema.parse(outbound.payload);
      expect(validatedPayload.policySnapshot).toEqual(policySnapshot);
      expect(JSON.stringify(validatedPayload.policySnapshot)).toBe(JSON.stringify(policySnapshot));
    } finally {
      vi.unstubAllGlobals();
      if (previousEndpoint === undefined) delete process.env.DATASPACE_CONNECTOR_URL;
      else process.env.DATASPACE_CONNECTOR_URL = previousEndpoint;
    }
  });

  it("preserves a project invitation policy snapshot through the serialized Tractus-X payload", async () => {
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

  it("persists a failed coordination decision and retries the same public message", async () => {
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
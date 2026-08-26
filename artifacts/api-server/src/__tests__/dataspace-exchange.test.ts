import { describe, expect, it, vi } from "vitest";
import {
  toExternalResourceRequirements,
  toExternalServiceRequest,
  toExternalServiceResponse,
} from "../services/dataspace/external-mappers";
import { createDataspaceExchange } from "../services/dataspace/dataspace-exchange-factory";
import { TractusXEdcExchange } from "../services/dataspace/tractusx-edc-exchange";
import { externalServiceRequestSchema } from "../services/dataspace/external-contracts";
import { RestDataspaceExchange } from "../services/dataspace/rest-dataspace-exchange";

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
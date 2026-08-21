import { describe, expect, it } from "vitest";
import { toExternalTaktRequest, toExternalTaktResponse } from "../services/dataspace/external-mappers";
import { createDataspaceExchange } from "../services/dataspace/dataspace-exchange-factory";
import { RestDataspaceExchange } from "../services/dataspace/rest-dataspace-exchange";

describe("dataspace exchange boundary", () => {
  it("maps only external request fields and does not expose internal resource data", () => {
    const request = toExternalTaktRequest({
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

  it("maps only external response decision data", () => {
    const response = toExternalTaktResponse({
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
    await expect(exchange.publishTaktRequest(toExternalTaktRequest({
      requestId: "request-1", requestVersion: 1, projectReference: "project-1",
      plannedStart: "2026-09-01", plannedEnd: "2026-09-03",
      senderOrgId: "ag-1", receiverOrgId: "an-1",
    }))).rejects.toThrow("Tractus-X EDC adapter not configured");
    if (previous === undefined) delete process.env.DATASPACE_TRANSPORT;
    else process.env.DATASPACE_TRANSPORT = previous;
  });

  it("creates distinct message IDs but keeps a workflow correlation ID", () => {
    const base = {
      requestId: "request-1", requestVersion: 1, senderOrgId: "ag-1", receiverOrgId: "an-1",
      projectReference: "project-1", plannedStart: "2026-09-01", plannedEnd: "2026-09-03",
    };
    const first = toExternalTaktRequest(base);
    const second = toExternalTaktResponse({
      requestId: base.requestId, requestVersion: base.requestVersion,
      decision: "ACCEPTED", senderOrgId: "an-1", receiverOrgId: "ag-1",
      correlationId: first.metadata.correlationId,
    });
    expect(first.metadata.messageId).not.toBe(second.metadata.messageId);
    expect(first.metadata.correlationId).toBe(second.metadata.correlationId);
  });
});
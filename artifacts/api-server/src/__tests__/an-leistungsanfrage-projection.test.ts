import { afterEach, beforeEach, describe, expect, it } from "vitest";
import httpRequest from "supertest";
import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import {
  anDb,
  anLeistungsanfragenTable,
  anLeistungsanfrageResourceRequirementsTable,
  dataspaceExchangesTable,
  hubDb,
  organizationsTable,
  resourceTypesTable,
  resourcesTable,
} from "@workspace/db";
import type { ExternalServiceRequest } from "../services/dataspace/external-contracts";
import { processIncomingServiceRequest } from "../services/dataspace/inbound-domain-service";
import { handleIncomingServiceRequest } from "../services/dataspace/inbound-exchange-service";
import app from "../app";
import {
  getAnLeistungsanfrageDetail,
  runAnAvailabilityCheck,
} from "../services/an-leistungsanfrage-service";

const messageIds: string[] = [];
const AG = "ag-local-projection-test";
const AN = "an-local-projection-test";
const RESOURCE_TYPE = "an-local-projection-resource-type";
const RESOURCE = "an-local-projection-resource";

function policySnapshot(providerOrganizationId = AG, recipientOrganizationId = AN) {
  return {
    policyId: "policy-projection-test",
    templateId: "SERVICE_COORDINATION",
    templateVersion: 1,
    code: "SERVICE_COORDINATION",
    name: "Service coordination",
    description: "Projection test policy",
    permissions: ["read:takt"],
    prohibitions: ["share-outside-project"],
    provider: { organizationId: providerOrganizationId, userId: null },
    recipientOrganizationId,
    purpose: "Coordinate the service request",
    projectReference: "project-1",
    workPackageReference: null,
    validFrom: null,
    validUntil: null,
    createdAt: "2026-08-26T08:00:00.000Z",
  };
}

function payload(overrides: Partial<ExternalServiceRequest> = {}): ExternalServiceRequest {
  const messageId = overrides.metadata?.messageId ?? crypto.randomUUID();
  messageIds.push(messageId);
  return {
    metadata: {
      messageId,
      correlationId: `correlation-${messageId}`,
      schemaVersion: "1.0",
      senderOrgId: AG,
      receiverOrgId: AN,
      createdAt: new Date().toISOString(),
      ...overrides.metadata,
    },
    requestId: "external-leistungsanfrage-1",
    requestVersion: 1,
    projectReference: "project-1",
    leistungReference: "leistung-1",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-02",
    resourceRequirements: [{
      resourceTypeCode: "CREW",
      resourceTypeName: "Montageteam",
      requiredCapacity: 2,
      capacityUnit: "persons",
      utilizationPercent: 100,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-02",
      requiredQualification: "Qualifikation A",
    }],
    policy: {
      allowedConsumerOrgId: AN,
      usagePurpose: "PROJECT_COORDINATION",
    },
    policySnapshot: policySnapshot(),
    ...overrides,
  };
}

async function receive(request: ExternalServiceRequest) {
  return handleIncomingServiceRequest(request, processIncomingServiceRequest);
}

afterEach(async () => {
  await hubDb.delete(dataspaceExchangesTable).where(and(
    eq(dataspaceExchangesTable.senderOrgId, AG),
    eq(dataspaceExchangesTable.receiverOrgId, AN),
  ));
  for (const messageId of messageIds) {
    const rows = await anDb.select({ id: anLeistungsanfragenTable.id })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, messageId));
    for (const row of rows) {
      await anDb.delete(anLeistungsanfrageResourceRequirementsTable)
        .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, row.id));
    }
    await anDb.delete(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, messageId));
  }
  messageIds.length = 0;
  await anDb.delete(organizationsTable).where(eq(organizationsTable.id, AG));
  await anDb.delete(organizationsTable).where(eq(organizationsTable.id, AN));
});

describe("AN-lokale Leistungsanfrage-Projektion", () => {
  beforeEach(async () => {
    await anDb.insert(organizationsTable).values([
      { id: AG, name: "Projection source AG", type: "AG" },
      { id: AN, name: "Projection receiver AN", type: "AN" },
    ]);
    await anDb.insert(resourceTypesTable).values({
      id: RESOURCE_TYPE,
      anOrgId: AN,
      name: "Montageteam",
      category: "CREW",
      code: "CREW",
      capacityUnit: "PERSONS",
    });
    await anDb.insert(resourcesTable).values({
      id: RESOURCE,
      anOrgId: AN,
      resourceTypeId: RESOURCE_TYPE,
      type: "CREW",
      name: "Projektteam",
      capacity: 20,
      capacityUnit: "PERSONS",
    });
  });

  it("legt Payload-Snapshot und Ressourcen bei Erstempfang an", async () => {
    const request = payload();
    expect(await receive(request)).toEqual({ duplicate: false, status: "PROCESSED" });

    const [projection] = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, request.metadata.messageId));
    const requirements = await anDb.select().from(anLeistungsanfrageResourceRequirementsTable)
      .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, projection.id));

    expect(projection.status).toBe("RECEIVED");
    expect(projection.externalLeistungsanfrageId).toBe(request.requestId);
    expect(projection.externalRequestVersion).toBe(1);
    expect(projection.payloadSnapshot).toEqual(request);
    expect(requirements).toHaveLength(1);
    expect(requirements[0].externalResourceTypeCode).toBe("CREW");

    const detail = await getAnLeistungsanfrageDetail(request.requestId, AN);
    expect(detail).toMatchObject({
      guOrgName: null,
      project: { id: "project-1", name: null, location: null },
      takt: {
        id: "leistung-1",
        taktBezeichnung: null,
        kurzbezeichnung: null,
        gewerk: null,
        zone: null,
      },
    });
  });

  it("spiegelt lokale Anforderungsänderungen in Detail und Verfügbarkeitsprüfung", async () => {
    const request = payload();
    await receive(request);

    const [projection] = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, request.metadata.messageId));
    const [requirement] = await anDb.select()
      .from(anLeistungsanfrageResourceRequirementsTable)
      .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, projection.id));

    const updatedResponse = await httpRequest(app)
      .patch(`/api/an/leistungsanfragen/${request.requestId}/resource-requirements/${requirement.id}`)
      .set("Authorization", `Bearer ${jwt.sign({
        userId: "projection-test-user",
        orgId: AN,
        orgType: "AN",
        hubAdmin: false,
        roles: ["AN_ADMIN"],
      }, process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod")}`)
      .send({
        requiredCapacity: 7,
        utilizationPercent: 65,
        requiredQualification: "Qualifikation B",
        periodStart: "2026-09-03",
        periodEnd: "2026-09-08",
        notes: "Nur mit geprüfter Kolonne",
      });
    expect(updatedResponse.status).toBe(200);
    expect(updatedResponse.body).toMatchObject({
      requiredCapacity: "7.00",
      utilizationPercent: 65,
      requiredQualification: "Qualifikation B",
      periodStart: "2026-09-03",
      periodEnd: "2026-09-08",
      notes: "Nur mit geprüfter Kolonne",
    });

    const detail = await getAnLeistungsanfrageDetail(request.requestId, AN);
    expect(detail?.resourceRequirements).toEqual([expect.objectContaining({
      id: requirement.id,
      requiredCapacity: "7.00",
      utilizationPercent: 65,
      periodStart: "2026-09-03",
      periodEnd: "2026-09-08",
      requiredQualification: "Qualifikation B",
      notes: "Nur mit geprüfter Kolonne",
    })]);

    const availability = await runAnAvailabilityCheck(request.requestId, AN, null);
    expect(availability?.internalResultPayload?.availableResources).toEqual([
      expect.objectContaining({
        resourceTypeId: RESOURCE_TYPE,
        utilizationPercent: 65,
        periodStart: "2026-09-03",
        periodEnd: "2026-09-08",
      }),
    ]);
  });

  it("weist ungültige lokale Anforderungszeiträume explizit zurück", async () => {
    const request = payload();
    await receive(request);
    const [projection] = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, request.metadata.messageId));
    const [requirement] = await anDb.select()
      .from(anLeistungsanfrageResourceRequirementsTable)
      .where(eq(anLeistungsanfrageResourceRequirementsTable.anLeistungsanfrageId, projection.id));

    const response = await httpRequest(app)
      .patch(`/api/an/takt-requests/${request.requestId}/resource-requirements/${requirement.id}`)
      .set("Authorization", `Bearer ${jwt.sign({
        userId: "projection-test-user",
        orgId: AN,
        orgType: "AN",
        hubAdmin: false,
        roles: ["AN_ADMIN"],
      }, process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod")}`)
      .send({ periodStart: "2026-09-10", periodEnd: "2026-09-01" });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("INVALID_REQUIREMENT_PERIOD");
  });

  it("akzeptiert einen Policy-Snapshot mit passenden Teilnehmern", async () => {
    const request = payload();

    await expect(receive(request)).resolves.toEqual({ duplicate: false, status: "PROCESSED" });
  });

  it("weist einen Policy-Snapshot mit abweichendem Provider zurück", async () => {
    const request = payload({
      policySnapshot: policySnapshot("other-provider", AN),
    });

    await expect(receive(request)).rejects.toThrow("Invalid external exchange payload");

    const projections = await anDb.select({ id: anLeistungsanfragenTable.id })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, request.metadata.messageId));
    expect(projections).toHaveLength(0);
  });

  it("weist einen Policy-Snapshot mit abweichendem Recipient zurück", async () => {
    const request = payload({
      policySnapshot: policySnapshot(AG, "other-recipient"),
    });

    await expect(receive(request)).rejects.toThrow("Invalid external exchange payload");

    const projections = await anDb.select({ id: anLeistungsanfragenTable.id })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, request.metadata.messageId));
    expect(projections).toHaveLength(0);
  });

  it("behandelt gleiche Message-ID und gleichen Inhalt als No-op", async () => {
    const request = payload();
    await receive(request);
    expect(await receive(request)).toEqual({ duplicate: true, status: "DUPLICATE" });

    const rows = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, request.metadata.messageId));
    expect(rows).toHaveLength(1);
  });

  it("weist geänderten Inhalt unter derselben Message-ID als Konflikt ab", async () => {
    const request = payload();
    await receive(request);
    await expect(receive({
      ...request,
      plannedEnd: "2026-09-03",
    })).rejects.toThrow(/conflicts/);
  });

  it("markiert die ältere Version bei höherer Version als SUPERSEDED", async () => {
    const first = payload();
    await receive(first);
    const second = payload({
      requestVersion: 2,
      metadata: {
        ...first.metadata,
        messageId: crypto.randomUUID(),
      },
    });
    messageIds.push(second.metadata.messageId);
    await receive(second);

    const rows = await anDb.select().from(anLeistungsanfragenTable).where(and(
      eq(anLeistungsanfragenTable.receiverAnOrgId, second.metadata.receiverOrgId),
      eq(anLeistungsanfragenTable.externalLeistungsanfrageId, second.requestId),
    ));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.externalRequestVersion === 1)?.status).toBe("SUPERSEDED");
    expect(rows.find((row) => row.externalRequestVersion === 2)?.status).toBe("RECEIVED");
  });

  it("weist eine niedrigere Version ab", async () => {
    const current = payload({ requestVersion: 2 });
    await receive(current);
    await expect(receive(payload({
      metadata: { ...current.metadata, messageId: crypto.randomUUID() },
      requestVersion: 1,
    }))).rejects.toThrow(/older/);
  });
});
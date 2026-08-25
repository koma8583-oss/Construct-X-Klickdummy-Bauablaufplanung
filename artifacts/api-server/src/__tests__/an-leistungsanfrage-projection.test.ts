import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  anDb,
  anLeistungsanfragenTable,
  anLeistungsanfrageResourceRequirementsTable,
  dataspaceExchangesTable,
  hubDb,
  organizationsTable,
} from "@workspace/db";
import type { ExternalServiceRequest } from "../services/dataspace/external-contracts";
import { processIncomingServiceRequest } from "../services/dataspace/inbound-domain-service";
import { handleIncomingServiceRequest } from "../services/dataspace/inbound-exchange-service";

const messageIds: string[] = [];
const AG = "ag-local-projection-test";
const AN = "an-local-projection-test";

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
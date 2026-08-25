import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  anDb,
  anLeistungsanfragenTable,
  anLeistungsanfrageResourceRequirementsTable,
} from "@workspace/db";
import type { ExternalServiceRequest } from "../services/dataspace/external-contracts";
import { processIncomingServiceRequest } from "../services/dataspace/inbound-domain-service";

const messageIds: string[] = [];

function payload(overrides: Partial<ExternalServiceRequest> = {}): ExternalServiceRequest {
  const messageId = overrides.metadata?.messageId ?? crypto.randomUUID();
  messageIds.push(messageId);
  return {
    metadata: {
      messageId,
      correlationId: `correlation-${messageId}`,
      schemaVersion: "1.0",
      senderOrgId: "ag-local-projection-test",
      receiverOrgId: "an-local-projection-test",
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
      allowedConsumerOrgId: "an-local-projection-test",
      usagePurpose: "PROJECT_COORDINATION",
    },
    ...overrides,
  };
}

afterEach(async () => {
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
});

describe("AN-lokale Leistungsanfrage-Projektion", () => {
  it("legt Payload-Snapshot und Ressourcen bei Erstempfang an", async () => {
    const request = payload();
    await processIncomingServiceRequest(request);

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
    await processIncomingServiceRequest(request);
    await processIncomingServiceRequest(request);

    const rows = await anDb.select().from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.sourceMessageId, request.metadata.messageId));
    expect(rows).toHaveLength(1);
  });

  it("weist geänderten Inhalt unter derselben Message-ID als Konflikt ab", async () => {
    const request = payload();
    await processIncomingServiceRequest(request);
    await expect(processIncomingServiceRequest({
      ...request,
      plannedEnd: "2026-09-03",
    })).rejects.toThrow(/conflicts/);
  });

  it("markiert die ältere Version bei höherer Version als SUPERSEDED", async () => {
    const first = payload();
    await processIncomingServiceRequest(first);
    const second = payload({
      requestVersion: 2,
      metadata: {
        ...first.metadata,
        messageId: crypto.randomUUID(),
      },
    });
    messageIds.push(second.metadata.messageId);
    await processIncomingServiceRequest(second);

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
    await processIncomingServiceRequest(current);
    await expect(processIncomingServiceRequest(payload({
      metadata: { ...current.metadata, messageId: crypto.randomUUID() },
      requestVersion: 1,
    }))).rejects.toThrow(/older/);
  });
});
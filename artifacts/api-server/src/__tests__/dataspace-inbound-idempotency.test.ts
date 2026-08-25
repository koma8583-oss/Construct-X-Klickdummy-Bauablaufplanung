import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  hubDb as db,
  dataspaceExchangesTable,
  organizationsTable,
} from "@workspace/db";
import type {
  ExternalServiceRequest,
  ExternalServiceResponse,
} from "../services/dataspace/external-contracts";
import {
  handleIncomingServiceRequest,
  handleIncomingServiceResponse,
} from "../services/dataspace/inbound-exchange-service";

const createdIds: string[] = [];
const createdMessageIds: string[] = [];

function metadata(messageId: string, senderOrgId: string, receiverOrgId: string) {
  return {
    messageId,
    correlationId: `correlation-${messageId}`,
    schemaVersion: "1.0",
    senderOrgId,
    receiverOrgId,
    createdAt: new Date().toISOString(),
  };
}

async function createOrganizations(messageId: string) {
  const senderOrgId = `dataspace-inbound-sender-${messageId}`;
  const receiverOrgId = `dataspace-inbound-receiver-${messageId}`;
  await db.insert(organizationsTable).values([
    { id: senderOrgId, name: senderOrgId, type: "AG" },
    { id: receiverOrgId, name: receiverOrgId, type: "AN" },
  ]);
  createdIds.push(senderOrgId, receiverOrgId);
  createdMessageIds.push(messageId);
  return { senderOrgId, receiverOrgId };
}

function requestPayload(messageId: string, senderOrgId: string, receiverOrgId: string): ExternalServiceRequest {
  return {
    metadata: metadata(messageId, senderOrgId, receiverOrgId),
    requestId: `request-${messageId}`,
    requestVersion: 1,
    projectReference: "project-reference",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-02",
    resourceRequirements: [],
  };
}

function responsePayload(messageId: string, senderOrgId: string, receiverOrgId: string): ExternalServiceResponse {
  return {
    metadata: metadata(messageId, senderOrgId, receiverOrgId),
    requestId: `request-${messageId}`,
    requestVersion: 1,
    decision: "ACCEPTED",
    acceptedTimeWindow: {
      start: "2026-09-01T08:00:00.000Z",
      end: "2026-09-02T17:00:00.000Z",
    },
  };
}

afterEach(async () => {
  for (const messageId of createdMessageIds) {
    await db.delete(dataspaceExchangesTable).where(eq(dataspaceExchangesTable.messageId, messageId));
  }
  for (const id of createdIds) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  }
  createdIds.length = 0;
  createdMessageIds.length = 0;
});

describe("dataspace inbound idempotency", () => {
  it("processes a request once and records RECEIVED → PROCESSED", async () => {
    const messageId = crypto.randomUUID();
    const { senderOrgId, receiverOrgId } = await createOrganizations(messageId);
    const payload = requestPayload(messageId, senderOrgId, receiverOrgId);
    let sideEffects = 0;

    await handleIncomingServiceRequest(payload, async () => {
      sideEffects += 1;
    });
    await handleIncomingServiceRequest(payload, async () => {
      sideEffects += 1;
    });

    const [exchange] = await db.select().from(dataspaceExchangesTable)
      .where(eq(dataspaceExchangesTable.messageId, messageId));
    expect(sideEffects).toBe(1);
    expect(exchange.status).toBe("PROCESSED");
    expect(exchange.direction).toBe("INBOUND");
    expect(exchange.messageType).toBe("SERVICE_REQUEST");
  });

  it("allows only one concurrent request delivery to run business logic", async () => {
    const messageId = crypto.randomUUID();
    const { senderOrgId, receiverOrgId } = await createOrganizations(messageId);
    const payload = requestPayload(messageId, senderOrgId, receiverOrgId);
    let sideEffects = 0;

    await Promise.all([
      handleIncomingServiceRequest(payload, async () => {
        sideEffects += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }),
      handleIncomingServiceRequest(payload, async () => {
        sideEffects += 1;
      }),
    ]);

    expect(sideEffects).toBe(1);
  });

  it("records FAILED, then claims and processes a failed response retry", async () => {
    const messageId = crypto.randomUUID();
    const { senderOrgId, receiverOrgId } = await createOrganizations(messageId);
    const payload = responsePayload(messageId, senderOrgId, receiverOrgId);

    await expect(handleIncomingServiceResponse(payload, async () => {
      throw new Error("downstream unavailable");
    })).rejects.toThrow("downstream unavailable");

    const [failed] = await db.select().from(dataspaceExchangesTable)
      .where(and(
        eq(dataspaceExchangesTable.messageId, messageId),
        eq(dataspaceExchangesTable.status, "FAILED"),
      ));
    expect(failed).toBeDefined();

    let sideEffects = 0;
    await handleIncomingServiceResponse(payload, async () => {
      sideEffects += 1;
    });
    await handleIncomingServiceResponse(payload, async () => {
      sideEffects += 1;
    });

    const [processed] = await db.select().from(dataspaceExchangesTable)
      .where(eq(dataspaceExchangesTable.messageId, messageId));
    expect(sideEffects).toBe(1);
    expect(processed.status).toBe("PROCESSED");
    expect(processed.messageType).toBe("SERVICE_RESPONSE");
  });
});
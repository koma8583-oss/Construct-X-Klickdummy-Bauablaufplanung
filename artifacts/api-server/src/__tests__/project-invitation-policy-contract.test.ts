import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  anDb,
  anProjectInvitationsTable,
  dataspaceExchangesTable,
  hubDb,
  organizationsTable,
} from "@workspace/db";
import {
  externalProjectInvitationResponseSchema,
  externalProjectInvitationSchema,
} from "../services/dataspace/external-contracts";
import type { ExternalProjectInvitation } from "../services/dataspace/external-contracts";
import { processIncomingProjectInvitation } from "../services/dataspace/inbound-domain-service";
import { handleIncomingProjectInvitation } from "../services/dataspace/inbound-exchange-service";

const metadata = {
  messageId: "project-invitation-message-1",
  correlationId: "project-membership:project-1:an-1:invite-1",
  schemaVersion: "1.0" as const,
  senderOrgId: "ag-1",
  receiverOrgId: "an-1",
  createdAt: "2026-08-24T12:00:00.000Z",
};

const INBOUND_AG_ID = "t300-invitation-ag";
const INBOUND_AN_ID = "t300-invitation-an";
const inboundInvitationIds: string[] = [];
const inboundMessageIds: string[] = [];

function inboundPolicySnapshot(
  providerOrganizationId = INBOUND_AG_ID,
  recipientOrganizationId = INBOUND_AN_ID,
) {
  return {
    policyId: "t300-invitation-policy",
    templateId: "PROJECT_COORDINATION",
    templateVersion: 1,
    code: "PROJECT_COORDINATION",
    name: "Project coordination",
    description: "Invitation policy projection test",
    permissions: ["read:project"],
    prohibitions: ["share-outside-project"],
    provider: { organizationId: providerOrganizationId, userId: null },
    recipientOrganizationId,
    purpose: "Coordinate the project",
    projectReference: "t300-project",
    workPackageReference: null,
    validFrom: null,
    validUntil: null,
    createdAt: "2026-08-26T08:00:00.000Z",
  };
}

function inboundInvitation(
  policySnapshot = inboundPolicySnapshot(),
): ExternalProjectInvitation {
  const invitationId = `t300-invitation-${inboundInvitationIds.length + 1}`;
  const messageId = `t300-invitation-message-${inboundMessageIds.length + 1}`;
  inboundInvitationIds.push(invitationId);
  inboundMessageIds.push(messageId);
  return {
    metadata: {
      messageId,
      correlationId: `t300-invitation-correlation-${inboundInvitationIds.length}`,
      schemaVersion: "1.0",
      senderOrgId: INBOUND_AG_ID,
      receiverOrgId: INBOUND_AN_ID,
      createdAt: "2026-08-26T08:00:00.000Z",
    },
    invitationId,
    project: {
      projectReference: "t300-project",
      projectName: "Invitation projection test",
    },
    requestedRole: "CONTRACTOR",
    purpose: "PROJECT_COLLABORATION",
    policy: {
      usagePurpose: "PROJECT_MEMBERSHIP",
      allowedConsumerParticipantId: `local:${INBOUND_AN_ID}`,
    },
    policySnapshot,
    dataOffer: {
      publicationId: "t300-publication",
      title: "Project information",
      selectedFields: ["projectName"],
    },
  };
}

async function receiveInvitation(payload: ExternalProjectInvitation) {
  return handleIncomingProjectInvitation(payload, processIncomingProjectInvitation);
}

beforeEach(async () => {
  await hubDb.insert(organizationsTable).values([
    { id: INBOUND_AG_ID, name: "Task 300 AG", type: "AG" },
    { id: INBOUND_AN_ID, name: "Task 300 AN", type: "AN" },
  ]);
});

afterEach(async () => {
  for (const invitationId of inboundInvitationIds) {
    await anDb.delete(anProjectInvitationsTable)
      .where(eq(anProjectInvitationsTable.invitationId, invitationId));
  }
  for (const messageId of inboundMessageIds) {
    await hubDb.delete(dataspaceExchangesTable)
      .where(eq(dataspaceExchangesTable.messageId, messageId));
  }
  inboundInvitationIds.length = 0;
  inboundMessageIds.length = 0;
  await hubDb.delete(organizationsTable).where(and(
    eq(organizationsTable.id, INBOUND_AG_ID),
    eq(organizationsTable.type, "AG"),
  ));
  await hubDb.delete(organizationsTable).where(and(
    eq(organizationsTable.id, INBOUND_AN_ID),
    eq(organizationsTable.type, "AN"),
  ));
});

describe("project invitation with linked data offer contract", () => {
  it("carries the field whitelist and immutable policy snapshot to the AN", () => {
    const result = externalProjectInvitationSchema.safeParse({
      metadata,
      invitationId: "invite-1",
      project: { projectReference: "project-1", projectName: "Neubau Nord" },
      requestedRole: "CONTRACTOR",
      purpose: "PROJECT_COLLABORATION",
      policy: {
        usagePurpose: "PROJECT_MEMBERSHIP",
        allowedConsumerParticipantId: "local:an-1",
      },
      dataOffer: {
        publicationId: "publication-1",
        title: "Informationspaket Leistungsvergabe",
        dataProductType: "TAKT_INFORMATION_PACKAGE",
        selectedFields: ["projectName", "workPackage"],
        policy: {
          id: "policy-1",
          code: "SCHEDULE_COORDINATION",
          name: "Terminabstimmung",
          purpose: "Koordination des Bauablaufs",
          permissions: ["Projektbezogene Nutzung"],
          prohibitions: ["Weitergabe"],
          validityRule: "Gültig für das Projekt",
          retentionRule: null,
        },
      },
    });
    expect(result.success, result.error?.message).toBe(true);
  });

  it("rejects an acceptance response without an explicit policy confirmation", () => {
    const result = externalProjectInvitationResponseSchema.safeParse({
      metadata: { ...metadata, senderOrgId: "an-1", receiverOrgId: "ag-1" },
      invitationId: "invite-1",
      projectReference: "project-1",
      decision: "ACCEPTED",
      respondedAt: "2026-08-24T12:05:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit policy confirmation and preserves correlation", () => {
    const result = externalProjectInvitationResponseSchema.safeParse({
      metadata: { ...metadata, senderOrgId: "an-1", receiverOrgId: "ag-1" },
      invitationId: "invite-1",
      projectReference: "project-1",
      decision: "ACCEPTED",
      policyAccepted: true,
      respondedAt: "2026-08-24T12:05:00.000Z",
    });
    expect(result.success, result.error?.message).toBe(true);
    if (result.success) {
      expect(result.data.metadata.correlationId).toBe(metadata.correlationId);
    }
  });
});

describe("inbound project invitation policy participants", () => {
  it("accepts and stores a valid policy snapshot in the AN projection", async () => {
    const invitation = inboundInvitation();

    await expect(receiveInvitation(invitation)).resolves.toEqual({
      duplicate: false,
      status: "PROCESSED",
    });

    const [projection] = await anDb.select().from(anProjectInvitationsTable)
      .where(eq(anProjectInvitationsTable.invitationId, invitation.invitationId));
    const [exchange] = await hubDb.select().from(dataspaceExchangesTable)
      .where(eq(dataspaceExchangesTable.messageId, invitation.metadata.messageId));

    expect(projection.policySnapshot).toEqual(invitation.policySnapshot);
    expect(projection.senderAgOrgId).toBe(INBOUND_AG_ID);
    expect(projection.receiverAnOrgId).toBe(INBOUND_AN_ID);
    expect(exchange.status).toBe("PROCESSED");
  });

  it("rejects a provider mismatch before creating an AN invitation projection", async () => {
    const invitation = inboundInvitation(inboundPolicySnapshot("t300-other-provider"));

    await expect(receiveInvitation(invitation)).rejects.toThrow("Invalid external exchange payload");

    const projections = await anDb.select({ id: anProjectInvitationsTable.id })
      .from(anProjectInvitationsTable)
      .where(eq(anProjectInvitationsTable.invitationId, invitation.invitationId));
    expect(projections).toHaveLength(0);
  });

  it("rejects a recipient mismatch before creating an AN invitation projection", async () => {
    const invitation = inboundInvitation(inboundPolicySnapshot(INBOUND_AG_ID, "t300-other-recipient"));

    await expect(receiveInvitation(invitation)).rejects.toThrow("Invalid external exchange payload");

    const projections = await anDb.select({ id: anProjectInvitationsTable.id })
      .from(anProjectInvitationsTable)
      .where(eq(anProjectInvitationsTable.invitationId, invitation.invitationId));
    expect(projections).toHaveLength(0);
  });
});
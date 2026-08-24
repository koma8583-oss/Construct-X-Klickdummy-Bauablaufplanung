import { describe, expect, it } from "vitest";
import {
  externalProjectInvitationResponseSchema,
  externalProjectInvitationSchema,
} from "../services/dataspace/external-contracts";

const metadata = {
  messageId: "project-invitation-message-1",
  correlationId: "project-membership:project-1:an-1:invite-1",
  schemaVersion: "1.0" as const,
  senderOrgId: "ag-1",
  receiverOrgId: "an-1",
  createdAt: "2026-08-24T12:00:00.000Z",
};

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
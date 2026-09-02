import { describe, expect, it } from "vitest";
import {
  externalDataOfferResponseSchema,
  externalProjectInvitationResponseSchema,
} from "../services/dataspace/external-contracts";
import { processIncomingProjectInvitationResponse } from "../services/dataspace/inbound-domain-service";

const response = {
  metadata: {
    messageId: "data-offer-response-message-1",
    correlationId: "data-offer:publication-1:an-1",
    schemaVersion: "1.0" as const,
    senderOrgId: "an-1",
    receiverOrgId: "ag-1",
    createdAt: "2026-09-02T08:00:00.000Z",
  },
  publicationId: "publication-1",
  projectReference: "project-1",
  decision: "ACCEPTED" as const,
  policyAccepted: true,
  respondedAt: "2026-09-02T08:00:00.000Z",
};

describe("independent data-offer response contract", () => {
  it("accepts a response without invitation or membership fields", () => {
    expect(externalDataOfferResponseSchema.parse(response)).toEqual(response);
  });

  it("requires policy acceptance for an accepted offer", () => {
    const invalid = { ...response, policyAccepted: false };
    expect(externalDataOfferResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it("does not let an invitation response decide a publication", async () => {
    const invitationResponse = externalProjectInvitationResponseSchema.parse({
      metadata: response.metadata,
      invitationId: "invitation-1",
      projectReference: response.projectReference,
      dataPublicationId: "publication-1",
      decision: "ACCEPTED",
      policyAccepted: true,
      respondedAt: response.respondedAt,
    });
    await expect(processIncomingProjectInvitationResponse(invitationResponse))
      .rejects.toThrow("use DATA_OFFER_RESPONSE");
  });
});
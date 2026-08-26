import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  anDb,
  anProjectInvitationsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import { processIncomingProjectInvitation } from "../services/dataspace/inbound-domain-service";
import type { ExternalProjectInvitation } from "../services/dataspace/external-contracts";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const AN_ORG = "an-local-offer-test";
const INVITATION_ID = "an-local-offer-invitation";
const PUBLICATION_ID = "an-local-publication";
const INBOUND_INVITATION_ID = "an-local-inbound-invitation";

const anToken = jwt.sign({
  userId: "an-local-offer-user",
  orgId: AN_ORG,
  orgType: "AN",
  hubAdmin: false,
  roles: ["AN_ADMIN"],
}, JWT_SECRET, { expiresIn: "1h" });

afterEach(async () => {
  await anDb.delete(anProjectInvitationsTable)
    .where(eq(anProjectInvitationsTable.id, INVITATION_ID));
  await anDb.delete(anProjectInvitationsTable)
    .where(eq(anProjectInvitationsTable.invitationId, INBOUND_INVITATION_ID));
});

describe("AN data offers use local invitation projections", () => {
  it("reads offers and policies from the AN-local Dataspace snapshot", async () => {
    await anDb.insert(anProjectInvitationsTable).values({
      id: INVITATION_ID,
      invitationId: "an-local-offer-external-invitation",
      correlationId: "an-local-offer-correlation",
      senderAgOrgId: "ag-local-offer-test",
      receiverAnOrgId: AN_ORG,
      projectReference: "ag-project-reference",
      projectName: "Lokales Projektabbild",
      projectDescription: "Aus dem Dataspace empfangene Beschreibung",
      projectLocation: "Baufeld A",
      dataPublicationId: PUBLICATION_ID,
      dataPublicationTitle: "Lokales Datenangebot",
      selectedFields: ["projectName", "location"],
      policySnapshot: {
        id: "local-policy-id",
        code: "LOCAL_POLICY",
        name: "Lokale Policy",
        purpose: "PROJECT_COORDINATION",
        permissions: ["read"],
        prohibitions: ["redistribute"],
        validityRule: "Projektlaufzeit",
      },
      status: "PENDING",
    });

    const list = await request(app)
      .get("/api/an/data-offers")
      .set("Authorization", `Bearer ${anToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        publicationId: PUBLICATION_ID,
        title: "Lokales Datenangebot",
        agName: "ag-local-offer-test",
        recipientStatus: "OFFERED",
        policyCode: "LOCAL_POLICY",
      }),
    ]));

    const detail = await request(app)
      .get(`/api/an/data-offers/${PUBLICATION_ID}`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      publicationId: PUBLICATION_ID,
      projectInfo: {
        name: "Lokales Projektabbild",
        location: "Baufeld A",
      },
      assignments: [],
      policy: {
        code: "LOCAL_POLICY",
        permissions: ["read"],
      },
    });

    const odrl = await request(app)
      .get(`/api/an/data-publications/${PUBLICATION_ID}/odrl`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(odrl.status).toBe(200);
    expect(odrl.body).toMatchObject({
      "@type": "Set",
      uid: `urn:odrl:data-publication:${PUBLICATION_ID}`,
      permission: [expect.objectContaining({
        assigner: "organization:ag-local-offer-test",
        assignee: "organization:an-local-offer-test",
      })],
    });

    await anDb.update(anProjectInvitationsTable).set({
      status: "ACCEPTED",
      policyAcceptedAt: new Date(),
      respondedAt: new Date(),
    }).where(eq(anProjectInvitationsTable.id, INVITATION_ID));

    const policies = await request(app)
      .get("/api/an/policies")
      .set("Authorization", `Bearer ${anToken}`);
    expect(policies.status).toBe(200);
    expect(policies.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "LOCAL_POLICY",
        projects: [expect.objectContaining({
          id: "ag-project-reference",
          name: "Lokales Projektabbild",
          agOrgId: "ag-local-offer-test",
        })],
      }),
    ]));
  });

  it("projects the data-offer policy separately from the invitation policy", async () => {
    const inbound: ExternalProjectInvitation = {
      metadata: {
        messageId: "an-local-inbound-message",
        correlationId: "an-local-inbound-correlation",
        schemaVersion: "1.0",
        senderOrgId: "ag-local-inbound-test",
        receiverOrgId: AN_ORG,
        createdAt: "2026-08-26T10:00:00.000Z",
      },
      invitationId: INBOUND_INVITATION_ID,
      project: {
        projectReference: "ag-inbound-project",
        projectName: "Inbound-Snapshot-Projekt",
        description: "Nur aus dem Dataspace",
        location: "Baufeld B",
      },
      requestedRole: "CONTRACTOR",
      purpose: "PROJECT_COLLABORATION",
      policy: {
        usagePurpose: "PROJECT_MEMBERSHIP",
        allowedConsumerParticipantId: AN_ORG,
      },
      policySnapshot: {
        policyId: "membership-policy",
        templateId: "membership-template",
        templateVersion: 1,
        code: "MEMBERSHIP_POLICY",
        name: "Mitgliedschafts-Policy",
        description: "Policy für die Einladung",
        permissions: ["read:membership"],
        prohibitions: ["share-membership"],
        provider: { organizationId: "ag-local-inbound-test", userId: null },
        recipientOrganizationId: AN_ORG,
        purpose: "PROJECT_COLLABORATION",
        projectReference: "ag-inbound-project",
        workPackageReference: null,
        validFrom: null,
        validUntil: null,
        createdAt: "2026-08-26T10:00:00.000Z",
      },
      dataOffer: {
        publicationId: "ag-inbound-publication",
        title: "Inbound-Datenangebot",
        dataProductType: "TAKT_INFORMATION_PACKAGE",
        selectedFields: ["projectName", "location"],
        validFrom: "2026-08-26T10:00:00.000Z",
        validUntil: "2026-09-26T10:00:00.000Z",
        policy: {
          id: "offer-policy",
          templateId: "offer-template",
          templateVersion: 2,
          code: "OFFER_POLICY",
          name: "Datenangebots-Policy",
          purpose: "TAKT_COORDINATION",
          permissions: ["read:project"],
          prohibitions: ["redistribute"],
          validityRule: "Bis Projektende",
          retentionRule: "30 Tage",
        },
      },
    };

    await processIncomingProjectInvitation(inbound);
    await anDb.update(anProjectInvitationsTable).set({ status: "ACCEPTED" })
      .where(eq(anProjectInvitationsTable.invitationId, INBOUND_INVITATION_ID));

    const offer = await request(app)
      .get("/api/an/data-offers/ag-inbound-publication")
      .set("Authorization", `Bearer ${anToken}`);
    expect(offer.status).toBe(200);
    expect(offer.body).toMatchObject({
      title: "Inbound-Datenangebot",
      dataProductType: "TAKT_INFORMATION_PACKAGE",
      version: 1,
      policy: {
        id: "offer-policy",
        code: "OFFER_POLICY",
        permissions: ["read:project"],
      },
    });

    const policies = await request(app)
      .get("/api/an/policies")
      .set("Authorization", `Bearer ${anToken}`);
    expect(policies.status).toBe(200);
    expect(policies.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "offer-policy",
        code: "OFFER_POLICY",
      }),
    ]));
  });
});
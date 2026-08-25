import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  anDb,
  anProjectInvitationsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const AN_ORG = "an-local-offer-test";
const INVITATION_ID = "an-local-offer-invitation";
const PUBLICATION_ID = "an-local-publication";

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
});
/**
 * ODRL endpoint — SCHEDULE_COORDINATION policy shape
 *
 * Verifies that the generated ODRL:
 *   ✓ permission.action === "use"
 *   ✓ purpose constraint === "scheduleCoordination"
 *   ✓ prohibition includes "distribute"
 *   ✓ prohibition includes "derive", "modify", and "commercialize"
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectContractorsTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import app from "../app";

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";

function makeToken(userId: string, orgId: string, orgType: string, roles: string[] = []) {
  return jwt.sign({ userId, orgId, orgType, roles }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let agOrgId:    string;
let anOrgId:    string;
let agUserId:   string;
let anUserId:   string;
let projectId:  string;
let pubId:      string;
let agToken:    string;
let anToken:    string;
let scheduleCoordinationPolicyId: string;

beforeAll(async () => {
  // AG org + user
  const [agOrg]  = await db.insert(organizationsTable).values({ name: "ODRL-SC AG Org",  type: "AG" }).returning();
  const [anOrg]  = await db.insert(organizationsTable).values({ name: "ODRL-SC AN Org",  type: "AN" }).returning();
  const [agUser] = await db.insert(usersTable).values({ name: "ODRL-SC AG", email: `odrl-sc-ag-${Date.now()}@test.test`, passwordHash: "x" }).returning();
  const [anUser] = await db.insert(usersTable).values({ name: "ODRL-SC AN", email: `odrl-sc-an-${Date.now()}@test.test`, passwordHash: "x" }).returning();
  agOrgId  = agOrg.id;
  anOrgId  = anOrg.id;
  agUserId = agUser.id;
  anUserId = anUser.id;

  agToken = makeToken(agUserId, agOrgId, "AG", ["AG_ADMIN"]);
  anToken = makeToken(anUserId, anOrgId, "AN", []);

  // Project
  const [project] = await db.insert(projectsTable).values({
    name: "ODRL-SC Project", agOrgId, status: "ACTIVE",
    startDate: "2025-01-01", endDate: "2025-12-31",
  }).returning();
  projectId = project.id;

  await db.insert(projectContractorsTable).values({ projectId, anOrgId, assignmentStatus: "ACTIVE" });

  // Resolve SCHEDULE_COORDINATION template (created by seed / previous psql)
  const [pt] = await db.select({ id: policyTemplatesTable.id })
    .from(policyTemplatesTable)
    .where(eq(policyTemplatesTable.code, "SCHEDULE_COORDINATION"))
    .limit(1);
  if (!pt) throw new Error("SCHEDULE_COORDINATION policy template not found — run seed first");
  scheduleCoordinationPolicyId = pt.id;

  // Create a PUBLISHED publication with that policy
  const now = new Date();
  const [pub] = await db.insert(dataPublicationsTable).values({
    id: crypto.randomUUID(),
    agOrgId,
    projectId,
    dataProductType: "TAKT_INFORMATION_PACKAGE",
    title:   "ODRL-SC Test Publication",
    version: 1,
    schemaVersion: "1.0",
    status:  "PUBLISHED",
    policyTemplateId: scheduleCoordinationPolicyId,
    selectedFields:   ["taktReference"],
    contentSnapshot:  {},
    contentHash:      "aabbcc",
    publishedAt: now,
    createdAt:   now,
    updatedAt:   now,
  }).returning();
  pubId = pub.id;

  // Add AN as a recipient
  await db.insert(dataPublicationRecipientsTable).values({
    id: crypto.randomUUID(),
    publicationId: pubId,
    anOrgId,
    status: "OFFERED",
    notifiedAt: now,
    createdAt:  now,
    updatedAt:  now,
  });
});

afterAll(async () => {
  await db.delete(dataPublicationRecipientsTable).where(eq(dataPublicationRecipientsTable.publicationId, pubId));
  await db.delete(dataPublicationsTable).where(eq(dataPublicationsTable.id, pubId));
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, projectId));
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  await db.delete(usersTable).where(eq(usersTable.id, agUserId));
  await db.delete(usersTable).where(eq(usersTable.id, anUserId));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, agOrgId));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, anOrgId));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/data-publications/:id/odrl — SCHEDULE_COORDINATION", () => {
  it("returns 200 with a valid ODRL Set document", async () => {
    const res = await request(app)
      .get(`/api/data-publications/${pubId}/odrl`)
      .set("Authorization", `Bearer ${agToken}`);

    expect(res.status).toBe(200);
    expect(res.body["@context"]).toBe("http://www.w3.org/ns/odrl.jsonld");
    expect(res.body["@type"]).toBe("Set");
    expect(res.body.uid).toContain(pubId);
  });

  it("permission action is 'use' with purpose = scheduleCoordination", async () => {
    const res = await request(app)
      .get(`/api/data-publications/${pubId}/odrl`)
      .set("Authorization", `Bearer ${agToken}`);

    const permissions: Array<{ action: string; constraint?: Array<{ leftOperand: string; rightOperand: string }> }> =
      res.body.permission;

    const usePerm = permissions.find((p) => p.action === "use");
    expect(usePerm).toBeDefined();

    const purposeConstraint = usePerm?.constraint?.find((c) => c.leftOperand === "purpose");
    expect(purposeConstraint?.rightOperand).toBe("scheduleCoordination");
  });

  it("prohibition includes 'distribute'", async () => {
    const res = await request(app)
      .get(`/api/data-publications/${pubId}/odrl`)
      .set("Authorization", `Bearer ${agToken}`);

    const prohibitions: Array<{ action: string }> = res.body.prohibition;
    const actions = prohibitions.map((p) => p.action);
    expect(actions).toContain("distribute");
  });

  it("prohibits deriving, modifying, and commercial reuse", async () => {
    const res = await request(app)
      .get(`/api/data-publications/${pubId}/odrl`)
      .set("Authorization", `Bearer ${agToken}`);

    const prohibitions: Array<{ action: string }> = res.body.prohibition;
    const actions = prohibitions.map((p) => p.action);
    expect(actions).toEqual(expect.arrayContaining(["derive", "modify", "commercialize"]));
  });

  it("does not add a retention/deletion duty", async () => {
    const res = await request(app)
      .get(`/api/data-publications/${pubId}/odrl`)
      .set("Authorization", `Bearer ${agToken}`);

    const usePerm = (res.body.permission as Array<{ duty?: unknown }>).find((p) => p.duty);
    expect(usePerm).toBeUndefined();
  });

  it("AN recipient can also fetch the ODRL (200, same shape)", async () => {
    const res = await request(app)
      .get(`/api/data-publications/${pubId}/odrl`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    const purposeConstraint = (res.body.permission as any[])[0]?.constraint?.find(
      (c: any) => c.leftOperand === "purpose",
    );
    expect(purposeConstraint?.rightOperand).toBe("scheduleCoordination");
    // AN org should appear as assignee
    expect(res.body.permission[0].assignee).toContain(anOrgId);
  });

  it("returns 403 when AN is not a recipient of the publication", async () => {
    const [otherOrg]  = await db.insert(organizationsTable).values({ name: "ODRL-SC Other AN", type: "AN" }).returning();
    const [otherUser] = await db.insert(usersTable).values({ name: "ODRL-SC Other", email: `odrl-sc-other-${Date.now()}@test.test`, passwordHash: "x" }).returning();
    const otherToken  = makeToken(otherUser.id, otherOrg.id, "AN", []);

    const res = await request(app)
      .get(`/api/data-publications/${pubId}/odrl`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(403);

    // cleanup
    await db.delete(usersTable).where(eq(usersTable.id, otherUser.id));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, otherOrg.id));
  });
});

describe("POST /an/data-offers/:id/reject — status guard", () => {
  it("rejects OFFERED → REJECTED (200 ok)", async () => {
    // Ensure status is OFFERED before this test
    await db
      .update(dataPublicationRecipientsTable)
      .set({ status: "OFFERED", policyAcceptedAt: null, policyRejectedAt: null })
      .where(
        and(
          eq(dataPublicationRecipientsTable.publicationId, pubId),
          eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
        ),
      );

    const res = await request(app)
      .post(`/api/an/data-offers/${pubId}/reject`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
  });

  it("returns 409 when trying to reject an already-ACCEPTED offer", async () => {
    // Force ACCEPTED status directly
    await db
      .update(dataPublicationRecipientsTable)
      .set({ status: "ACCEPTED", policyAcceptedAt: new Date() })
      .where(
        and(
          eq(dataPublicationRecipientsTable.publicationId, pubId),
          eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
        ),
      );

    const res = await request(app)
      .post(`/api/an/data-offers/${pubId}/reject`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ACCEPTED/);
  });
});

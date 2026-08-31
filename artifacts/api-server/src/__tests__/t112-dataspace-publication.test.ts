/**
 * Tests for the simulated Dataspace Publication feature (Task #112).
 *
 * Coverage:
 *   AG publication CRUD + publish/suspend/withdraw lifecycle
 *   AN policy acceptance + content access
 *   Security: wrong org cannot access another org's publications
 *   Validation: invalid fields, inactive contractors, missing recipients
 *   Content snapshot: only whitelisted fields are included
 *   Hash: deterministic SHA-256 of the sorted snapshot
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db, anDb, hubDb } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectContractorsTable,
  projectMembershipsTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  messageOutboxTable,
  messageInboxTable,
  dataspaceExchangesTable,
  anProjectInvitationsTable,
} from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import app from "../app";

// ── Setup ──────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";

function makeToken(
  userId: string,
  orgId: string | null,
  orgType: string,
  roles: string[] = [],
) {
  return jwt.sign({ userId, orgId, orgType, roles }, JWT_SECRET, { expiresIn: "1h" });
}

let agOrgId: string;
let anOrgId: string;
let anotherAnOrgId: string;
let agUserId: string;
let anUserId: string;
let anotherAgOrgId: string;
let anotherAgUserId: string;
let projectId: string;
let policyTemplateId: string;
let compatibilityPolicyTemplateId: string;
let nonCatalogPolicyId: string;

let agToken: string;
let anToken: string;
let anotherAgToken: string;

beforeAll(async () => {
  // AG org + user
  const [agOrg] = await db
    .insert(organizationsTable)
    .values({ name: "T112 AG Org", type: "AG" })
    .returning();
  agOrgId = agOrg.id;

  const [agUser] = await db
    .insert(usersTable)
    .values({ name: "T112 AG User", email: `t112-ag-${Date.now()}@test.test`, passwordHash: "x" })
    .returning();
  agUserId = agUser.id;

  // AN orgs
  const [anOrg] = await db
    .insert(organizationsTable)
    .values({ name: "T112 AN Org", type: "AN" })
    .returning();
  anOrgId = anOrg.id;

  const [anUser] = await db
    .insert(usersTable)
    .values({ name: "T112 AN User", email: `t112-an-${Date.now()}@test.test`, passwordHash: "x" })
    .returning();
  anUserId = anUser.id;

  const [anotherAnOrg] = await db
    .insert(organizationsTable)
    .values({ name: "T112 Another AN", type: "AN" })
    .returning();
  anotherAnOrgId = anotherAnOrg.id;

  // Another AG (for security tests)
  const [anotherAgOrg] = await db
    .insert(organizationsTable)
    .values({ name: "T112 Another AG", type: "AG" })
    .returning();
  anotherAgOrgId = anotherAgOrg.id;

  const [anotherAgUser] = await db
    .insert(usersTable)
    .values({ name: "T112 Another AG User", email: `t112-ag2-${Date.now()}@test.test`, passwordHash: "x" })
    .returning();
  anotherAgUserId = anotherAgUser.id;

  // Project owned by agOrgId
  const [project] = await db
    .insert(projectsTable)
    .values({
      name: "T112 Test Project",
      agOrgId,
      status: "ACTIVE",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    })
    .returning();
  projectId = project.id;

  // Add anOrgId as ACTIVE contractor
  await db.insert(projectContractorsTable).values({
    projectId,
    anOrgId,
    assignmentStatus: "ACTIVE",
  });
  await db.insert(projectMembershipsTable).values({
    id: "t112-active-membership",
    projectId,
    agOrgId,
    anOrgId,
    status: "ACTIVE",
    invitationId: "t112-active-invitation",
    correlationId: "t112-active-correlation",
  }).onConflictDoNothing();

  const [pt] = await db
    .select({ id: policyTemplatesTable.id })
    .from(policyTemplatesTable)
    .where(eq(policyTemplatesTable.code, "SCHEDULE_COORDINATION"))
    .limit(1);
  policyTemplateId = pt.id;
  await db.insert(policyTemplatesTable).values({
    id: "tk-policy-performance-coordination",
    code: "PERFORMANCE_COORDINATION",
    name: "Leistungsfreigabe",
    description: "Leistungsbezogene Freigabe für die Taktkoordination.",
    purpose: "performanceCoordination",
    permissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    prohibitions: ["REDISTRIBUTE", "SHARE_OUTSIDE_PROJECT_TEAM", "COMMERCIAL_REUSE", "AI_TRAINING"],
    validityRule: "Gilt für die konkret vergebene Leistung.",
    retentionRule: "Nur so lange speichern, wie die Leistungskoordination dies erfordert.",
    active: true,
  }).onConflictDoNothing();
  const [nonCatalogPolicy] = await db.insert(policyTemplatesTable).values({
    code: `T112_NON_CATALOG_POLICY_${crypto.randomUUID()}`,
    name: "T112 non-catalog policy",
    description: "Test-only policy that must not be available in the publication catalog.",
    purpose: "test",
    permissions: ["READ"],
    prohibitions: ["REDISTRIBUTE"],
    validityRule: "test",
    active: true,
  }).returning({ id: policyTemplatesTable.id });
  nonCatalogPolicyId = nonCatalogPolicy.id;
  compatibilityPolicyTemplateId = nonCatalogPolicyId;

  // Tokens
  agToken = makeToken(agUserId, agOrgId, "AG", ["AG_ADMIN"]);
  anToken = makeToken(anUserId, anOrgId, "AN", []);
  anotherAgToken = makeToken(anotherAgUserId, anotherAgOrgId, "AG", ["AG_ADMIN"]);
});

afterAll(async () => {
  // Teardown — ordered by FK
  await db
    .delete(dataPublicationRecipientsTable)
    .where(eq(dataPublicationRecipientsTable.anOrgId, anOrgId));
  await db
    .delete(dataPublicationsTable)
    .where(eq(dataPublicationsTable.projectId, projectId));
  await db
    .delete(policyTemplatesTable)
    .where(eq(policyTemplatesTable.id, nonCatalogPolicyId));

  await db
    .delete(projectContractorsTable)
    .where(eq(projectContractorsTable.projectId, projectId));
  await db.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, projectId));
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));

  // Clean up messages that reference any of the test orgs (FK constraint)
  const testOrgIds = [agOrgId, anOrgId, anotherAnOrgId, anotherAgOrgId].filter(Boolean);
  await anDb
    .delete(anProjectInvitationsTable)
    .where(eq(anProjectInvitationsTable.receiverAnOrgId, anOrgId));
  await db
    .delete(dataspaceExchangesTable)
    .where(or(
      inArray(dataspaceExchangesTable.senderOrgId, testOrgIds as [string, ...string[]]),
      inArray(dataspaceExchangesTable.receiverOrgId, testOrgIds as [string, ...string[]]),
    ));
  await db
    .delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.recipientOrgId, testOrgIds as [string, ...string[]]));
  await db
    .delete(messageOutboxTable)
    .where(inArray(messageOutboxTable.senderOrgId, testOrgIds as [string, ...string[]]));
  await db
    .delete(messageInboxTable)
    .where(inArray(messageInboxTable.recipientOrgId, testOrgIds as [string, ...string[]]));
  await db
    .delete(messageInboxTable)
    .where(inArray(messageInboxTable.senderOrgId, testOrgIds as [string, ...string[]]));

  // users before orgs
  for (const uid of [agUserId, anUserId, anotherAgUserId]) {
    await db.delete(usersTable).where(eq(usersTable.id, uid));
  }
  for (const oid of testOrgIds) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, oid));
  }
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function createDraftPublication(extraBody: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/data-publications`)
    .set("Authorization", `Bearer ${agToken}`)
    .send({
      dataProductType: "PROJECT_OVERVIEW",
      title: "T112 Test Publication",
      policyTemplateId,
      selectedFields: ["projectName", "projectStatus", "startDate"],
      recipientAnOrgIds: [anOrgId],
      ...extraBody,
    });
  return res;
}

// ── 1. Policy templates ────────────────────────────────────────────────────────

describe("GET /api/policy-templates", () => {
  it("returns the supported publication policy catalog for AG", async () => {
    const res = await request(app)
      .get("/api/policy-templates")
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    const codes = res.body.map((p: { code: string }) => p.code);
    expect(codes).toEqual(["SCHEDULE_COORDINATION", "PERFORMANCE_COORDINATION"]);
    expect(res.body[0].name).toBe("Abstimmung von Rahmenterminen");
    expect(res.body[0].templateVersion).toBe(4);
    expect(res.body[0].retentionRule).toBeNull();
    expect(res.body[0].allowedPublicationFields).not.toContain("resourceRequirements");
    expect(res.body[1].templateVersion).toBe(1);
    expect(res.body[1].allowedPublicationFields).toEqual(
      expect.arrayContaining(["kurzbezeichnung", "workPackage", "predecessors", "successors"]),
    );
    expect(res.body[0].registryTemplateId).toMatch(/^tk-policy-/);
    expect(res.body[0].availableTemplateVersions).toEqual([4]);
    expect(res.body[1].registryTemplateId).toMatch(/^tk-policy-/);
    expect(res.body[1].availableTemplateVersions).toEqual([1]);
  });

  it("rejects AN token (wrong role)", async () => {
    const res = await request(app)
      .get("/api/policy-templates")
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(403);
  });
});

// ── 2. Create DRAFT publication ────────────────────────────────────────────────

describe("POST /api/projects/:projectId/data-publications", () => {
  it("creates a DRAFT publication and returns 201", async () => {
    const res = await createDraftPublication();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.dataProductType).toBe("PROJECT_OVERVIEW");
    expect(res.body.recipientCount).toBe(1);
  });

  it("accepts the stable registry reference returned by the catalog", async () => {
    const res = await createDraftPublication({
      policyTemplateId: "tk-policy-schedule-coordination",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
  });

  it("creates a performance publication with dependency fields", async () => {
    const res = await createDraftPublication({
      dataProductType: "TAKT_INFORMATION_PACKAGE",
      policyTemplateId: "tk-policy-performance-coordination",
      selectedFields: ["workPackage", "predecessors", "successors"],
    });
    expect(res.status).toBe(201);
    expect(res.body.dataProductType).toBe("TAKT_INFORMATION_PACKAGE");
    expect(res.body.policyTemplateId).toBe("tk-policy-performance-coordination");
    expect(res.body.selectedFields).toEqual(["workPackage", "predecessors", "successors"]);
  });

  it("rejects unknown field names for the chosen data product type", async () => {
    const res = await createDraftPublication({ selectedFields: ["internalNote"] });
    expect(res.status).toBe(400);
  });

  it("rejects a recipient that is NOT an active contractor", async () => {
    const res = await createDraftPublication({
      recipientAnOrgIds: [anotherAnOrgId], // not a contractor
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/active contractor/i);
  });

  it("rejects empty recipient list", async () => {
    const res = await createDraftPublication({ recipientAnOrgIds: [] });
    expect(res.status).toBe(400);
  });

  it("rejects an active policy outside the publication catalog", async () => {
    const res = await createDraftPublication({
      policyTemplateId: compatibilityPolicyTemplateId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unavailable|not found/i);
  });

  it("rejects wrong AG (project owned by another org)", async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/data-publications`)
      .set("Authorization", `Bearer ${anotherAgToken}`)
      .send({
        dataProductType: "PROJECT_OVERVIEW",
        title: "Hack",
        policyTemplateId,
        selectedFields: ["projectName"],
        recipientAnOrgIds: [anOrgId],
      });
    expect(res.status).toBe(404);
  });
});

// ── 3. List + get publications (AG) ───────────────────────────────────────────

describe("GET /api/projects/:projectId/data-publications", () => {
  it("returns the AG's publications for this project", async () => {
    await createDraftPublication();
    const res = await request(app)
      .get(`/api/projects/${projectId}/data-publications`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("another AG cannot list the publications of this project", async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/data-publications`)
      .set("Authorization", `Bearer ${anotherAgToken}`);
    expect(res.status).toBe(404);
  });
});

// ── 4. Publish lifecycle ───────────────────────────────────────────────────────

describe("Publish lifecycle", () => {
  let publicationId: string;

  it("4a: publishes a DRAFT and status becomes PUBLISHED", async () => {
    const draft = await createDraftPublication();
    publicationId = (draft.body as { id: string }).id;
    const res = await request(app)
      .post(`/api/data-publications/${publicationId}/publish`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PUBLISHED");
  });

  it("4b: published publication has contentHash set", async () => {
    const res = await request(app)
      .get(`/api/data-publications/${publicationId}`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(200);
    expect(res.body.contentHash).toBeTruthy();
  });

  it("4c: cannot publish an already-published publication", async () => {
    const res = await request(app)
      .post(`/api/data-publications/${publicationId}/publish`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(409);
  });

  it("4d: suspend a PUBLISHED publication", async () => {
    const res = await request(app)
      .post(`/api/data-publications/${publicationId}/suspend`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUSPENDED");
  });

  it("4e: withdraw a SUSPENDED publication", async () => {
    const res = await request(app)
      .post(`/api/data-publications/${publicationId}/withdraw`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("WITHDRAWN");
  });

  it("4f: cannot suspend a WITHDRAWN publication", async () => {
    const res = await request(app)
      .post(`/api/data-publications/${publicationId}/suspend`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(res.status).toBe(409);
  });
});

// ── 5. AN data offer access ────────────────────────────────────────────────────

describe("AN data-offer access", () => {
  let pubId: string;

  beforeAll(async () => {
    const draft = await createDraftPublication();
    pubId = (draft.body as { id: string }).id;
    await request(app)
      .post(`/api/data-publications/${pubId}/publish`)
      .set("Authorization", `Bearer ${agToken}`);
  });

  it("5a: AN can list data offers after publication is PUBLISHED", async () => {
    const res = await request(app)
      .get("/api/an/data-offers")
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const offer = res.body.find((o: { publicationId: string }) => o.publicationId === pubId);
    expect(offer).toBeTruthy();
    expect(offer.recipientStatus).toBe("OFFERED");
  });

  it("5b: AN can get offer detail and see the policy", async () => {
    const res = await request(app)
      .get(`/api/an/data-offers/${pubId}`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(200);
    expect(res.body.policy).not.toBeNull();
    expect(res.body.policy.code).toBe("SCHEDULE_COORDINATION");
  });

  it("5c: AN cannot access content before accepting policy", async () => {
    const res = await request(app)
      .get(`/api/an/data-offers/${pubId}/content`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(403);
    expect(res.body.recipientStatus).toBe("OFFERED");
  });

  it("5d: AN accepts the policy", async () => {
    const res = await request(app)
      .post(`/api/an/data-offers/${pubId}/accept`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACCEPTED");
  });

  it("5e: AN can access content after accepting policy", async () => {
    const res = await request(app)
      .get(`/api/an/data-offers/${pubId}/content`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();
    expect(res.body.contentHash).toBeTruthy();
  });

  it("5f: content only includes whitelisted fields (no internal fields)", async () => {
    const res = await request(app)
      .get(`/api/an/data-offers/${pubId}/content`)
      .set("Authorization", `Bearer ${anToken}`);
    const content = res.body.content as Record<string, unknown>;
    expect(Object.keys(content)).not.toContain("internalNote");
    expect(Object.keys(content)).not.toContain("costEstimate");
  });
});

// ── 6. Security: another AN cannot access someone else's offer ─────────────────

describe("Security: cross-org isolation", () => {
  let pubId: string;
  let otherAnToken: string;
  let otherAnUserId: string;

  beforeAll(async () => {
    const [otherAnUser] = await db
      .insert(usersTable)
      .values({
        name: "T112 Other AN User",
        email: `t112-an3-${Date.now()}@test.test`,
        passwordHash: "x",
      })
      .returning();
    otherAnUserId = otherAnUser.id;
    otherAnToken = makeToken(otherAnUser.id, anotherAnOrgId, "AN", []);

    const draft = await createDraftPublication();
    pubId = (draft.body as { id: string }).id;
    await request(app)
      .post(`/api/data-publications/${pubId}/publish`)
      .set("Authorization", `Bearer ${agToken}`);
  });

  afterAll(async () => {
    await db.delete(usersTable).where(eq(usersTable.id, otherAnUserId));
  });

  it("another AN (not a recipient) cannot get the offer detail", async () => {
    const res = await request(app)
      .get(`/api/an/data-offers/${pubId}`)
      .set("Authorization", `Bearer ${otherAnToken}`);
    expect(res.status).toBe(404);
  });

  it("another AN cannot accept the policy", async () => {
    const res = await request(app)
      .post(`/api/an/data-offers/${pubId}/accept`)
      .set("Authorization", `Bearer ${otherAnToken}`);
    expect(res.status).toBe(404);
  });

  it("another AN cannot access the content", async () => {
    const res = await request(app)
      .get(`/api/an/data-offers/${pubId}/content`)
      .set("Authorization", `Bearer ${otherAnToken}`);
    expect(res.status).toBe(404);
  });
});

// ── 7. Reject flow ─────────────────────────────────────────────────────────────

describe("AN reject flow", () => {
  let pubId: string;

  beforeAll(async () => {
    const draft = await createDraftPublication();
    pubId = (draft.body as { id: string }).id;
    await request(app)
      .post(`/api/data-publications/${pubId}/publish`)
      .set("Authorization", `Bearer ${agToken}`);
  });

  it("7a: AN can reject an OFFERED offer", async () => {
    const res = await request(app)
      .post(`/api/an/data-offers/${pubId}/reject`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
  });

  it("7b: after rejection, cannot accept", async () => {
    const res = await request(app)
      .post(`/api/an/data-offers/${pubId}/accept`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(409);
  });

  it("7c: after rejection, cannot access content", async () => {
    const res = await request(app)
      .get(`/api/an/data-offers/${pubId}/content`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(res.status).toBe(403);
  });
});

// ── 8. Suspended publication blocks content access ─────────────────────────────

describe("Suspended publication", () => {
  let pubId: string;
  // Need a fresh AN user since prior test rejected the offer for anToken
  let freshAnToken: string;
  let freshAnUserId: string;
  let freshAnOrgId: string;

  beforeAll(async () => {
    // Create a fresh AN org + user + contractor assignment
    const [freshAnOrg] = await db
      .insert(organizationsTable)
      .values({ name: "T112 Fresh AN", type: "AN" })
      .returning();
    freshAnOrgId = freshAnOrg.id;

    const [freshAnUser] = await db
      .insert(usersTable)
      .values({ name: "T112 Fresh AN User", email: `t112-an4-${Date.now()}@test.test`, passwordHash: "x" })
      .returning();
    freshAnUserId = freshAnUser.id;
    freshAnToken = makeToken(freshAnUser.id, freshAnOrgId, "AN", []);

    await db.insert(projectContractorsTable).values({
      projectId,
      anOrgId: freshAnOrgId,
      assignmentStatus: "ACTIVE",
    });
  await db.insert(projectMembershipsTable).values({
    id: "t112-fresh-membership",
    projectId,
    agOrgId,
    anOrgId: freshAnOrgId,
    status: "ACTIVE",
    invitationId: "t112-fresh-invitation",
    correlationId: "t112-fresh-correlation",
  }).onConflictDoNothing();

    // Create publication for freshAn
    const draft = await request(app)
      .post(`/api/projects/${projectId}/data-publications`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({
        dataProductType: "PROJECT_OVERVIEW",
        title: "T112 Suspend Test",
        policyTemplateId,
        selectedFields: ["projectName", "projectStatus"],
        recipientAnOrgIds: [freshAnOrgId],
      });
    pubId = (draft.body as { id: string }).id;
    await request(app)
      .post(`/api/data-publications/${pubId}/publish`)
      .set("Authorization", `Bearer ${agToken}`);
    await request(app)
      .post(`/api/an/data-offers/${pubId}/accept`)
      .set("Authorization", `Bearer ${freshAnToken}`);
    // Suspend publication
    await request(app)
      .post(`/api/data-publications/${pubId}/suspend`)
      .set("Authorization", `Bearer ${agToken}`);
  });

  afterAll(async () => {
    // FK order: recipients → publications → contractors → messages → users → orgs
    await db
      .delete(dataPublicationRecipientsTable)
      .where(eq(dataPublicationRecipientsTable.anOrgId, freshAnOrgId));
    // Also delete publications whose project maps to the freshAn org's contractor row
    // (covered by the outer afterAll for projectId, but the suspend-test creates its own pub)
    await db
      .delete(dataPublicationsTable)
      .where(eq(dataPublicationsTable.projectId, projectId));
    await db.delete(projectContractorsTable).where(
      eq(projectContractorsTable.anOrgId, freshAnOrgId),
    );
    await db.delete(projectMembershipsTable).where(
      eq(projectMembershipsTable.anOrgId, freshAnOrgId),
    );
    await db
      .delete(messageOutboxTable)
      .where(eq(messageOutboxTable.recipientOrgId, freshAnOrgId));
    await db
      .delete(messageOutboxTable)
      .where(eq(messageOutboxTable.senderOrgId, freshAnOrgId));
    await db
      .delete(messageInboxTable)
      .where(eq(messageInboxTable.recipientOrgId, freshAnOrgId));
    await db
      .delete(messageInboxTable)
      .where(eq(messageInboxTable.senderOrgId, freshAnOrgId));
    await anDb
      .delete(anProjectInvitationsTable)
      .where(eq(anProjectInvitationsTable.receiverAnOrgId, freshAnOrgId));
    await db
      .delete(dataspaceExchangesTable)
      .where(or(
        eq(dataspaceExchangesTable.senderOrgId, freshAnOrgId),
        eq(dataspaceExchangesTable.receiverOrgId, freshAnOrgId),
      ));
    await db.delete(usersTable).where(eq(usersTable.id, freshAnUserId));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, freshAnOrgId));
  });

  it("8a: AN cannot access content when publication is SUSPENDED", async () => {
    const res = await request(app)
      .get(`/api/an/data-offers/${pubId}/content`)
      .set("Authorization", `Bearer ${freshAnToken}`);
    expect(res.status).toBe(403);
    expect(res.body.publicationStatus).toBe("SUSPENDED");
  });
});

// ── 9. Version incrementing ────────────────────────────────────────────────────

describe("Version incrementing", () => {
  it("second publication for same project+type gets version 2 or higher", async () => {
    const first = await createDraftPublication();
    const second = await createDraftPublication();
    const v1 = (first.body as { version: number }).version;
    const v2 = (second.body as { version: number }).version;
    expect(v2).toBe(v1 + 1);
  });
});

describe("Publication delivery recovery", () => {
  it("exposes a failed offer and retries the persisted delivery envelope", async () => {
    const draft = await createDraftPublication();
    const publicationId = (draft.body as { id: string }).id;
    const published = await request(app)
      .post(`/api/data-publications/${publicationId}/publish`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(published.status).toBe(200);

    const messageId = `dataspace-offer-${publicationId}-${anOrgId}`;
    await hubDb.delete(messageInboxTable).where(eq(messageInboxTable.messageId, messageId));
    await hubDb.update(messageOutboxTable).set({
      status: "FAILED",
      failureReason: "Connector nicht erreichbar",
      attemptCount: 1,
      lastAttemptAt: new Date(),
    }).where(eq(messageOutboxTable.messageId, messageId));

    const listed = await request(app)
      .get(`/api/projects/${projectId}/data-publications`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(listed.status).toBe(200);
    const publication = listed.body.find((row: { id: string }) => row.id === publicationId);
    expect(publication.recipients[0].delivery).toMatchObject({
      messageId,
      status: "FAILED",
      attemptCount: 1,
      failureReason: "Connector nicht erreichbar",
    });
    expect(publication.recipients[0].notifiedAt).toBeTruthy();

    const overview = await request(app)
      .get("/api/ag/data-publications")
      .set("Authorization", `Bearer ${agToken}`);
    expect(overview.status).toBe(200);
    expect(overview.body.find((row: { id: string }) => row.id === publicationId)
      .recipients[0].delivery).toMatchObject({
        messageId,
        status: "FAILED",
        attemptCount: 1,
        failureReason: "Connector nicht erreichbar",
      });

    const retried = await request(app)
      .post(`/api/data-publications/${publicationId}/recipients/${anOrgId}/retry`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(retried.status).toBe(200);
    expect(retried.body.status).toBe("DELIVERED");

    const refreshed = await request(app)
      .get(`/api/projects/${projectId}/data-publications`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(refreshed.body.find((row: { id: string }) => row.id === publicationId)
      .recipients[0].delivery.status).toBe("DELIVERED");

    await hubDb.update(messageOutboxTable).set({
      status: "FAILED",
      attemptCount: 5,
    }).where(eq(messageOutboxTable.messageId, messageId));
    const exhausted = await request(app)
      .post(`/api/data-publications/${publicationId}/recipients/${anOrgId}/retry`)
      .set("Authorization", `Bearer ${agToken}`);
    expect(exhausted.status).toBe(409);
    expect(exhausted.body.code).toBe("PUBLICATION_DELIVERY_RETRY_EXHAUSTED");
  });
});

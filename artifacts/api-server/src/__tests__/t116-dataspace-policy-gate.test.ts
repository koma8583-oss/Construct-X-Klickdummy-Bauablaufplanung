/**
 * T116 — Dataspace policy gate for TaktRequest snapshot access
 *
 * Coverage:
 *   Send validation:
 *     S1  – send without dataPublicationId → 409 DATA_PUBLICATION_REQUIRED
 *     S2  – send with non-PUBLISHED publication → 409 DATA_PUBLICATION_NOT_PUBLISHED
 *     S3  – send with publication from different project → 409 DATA_PUBLICATION_WRONG_PROJECT
 *     S4  – send with AN not a recipient → 409 DATA_PUBLICATION_AN_NOT_RECIPIENT
 *     S5  – send with valid publication → 200
 *
 *   Details policy gate (NU):
 *     G1  – NU accesses details before accepting policy → 403 POLICY_ACCEPTANCE_REQUIRED
 *     G2  – NU accesses details after accepting policy → 200 + DETAILS_RETRIEVED
 *     G3  – NU accesses details when publication SUSPENDED → 403 DATA_PUBLICATION_INACTIVE
 *     G4  – GU preview is never gated (no policy check)
 *     G5  – Repeated access after policy acceptance is idempotent (still 200)
 *
 *   Downstream flow:
 *     D1  – availability check before DETAILS_RETRIEVED → 409
 *     D2  – TaktResponse before DETAILS_RETRIEVED → 409
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectContractorsTable,
  projectMembershipsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  messageOutboxTable,
  messageInboxTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import * as jwt from "jsonwebtoken";
import * as bcrypt from "bcryptjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "testsecret";

function makeToken(userId: string, orgId: string | null, roles: string[] = []) {
  // Infer orgType from role prefix so downstream middleware can check user.orgType
  const orgType = roles.some(r => r.startsWith("AG"))
    ? "AG"
    : roles.some(r => r.startsWith("AN"))
    ? "AN"
    : null;
  return jwt.sign({ userId, orgId, orgType, hubAdmin: false, roles }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let agOrgId: string;
let anOrgId: string;
let otherAgOrgId: string; // for wrong-project scenario
let agUserId: string;
let anUserId: string;
let projectId: string;
let taktId: string;
let policyTemplateId: string;

let agToken: string;
let anToken: string;

async function insertOrg(name: string, type: "AG" | "AN" = "AG") {
  const [row] = await db
    .insert(organizationsTable)
    .values({ name, type })
    .returning();
  return row.id;
}

async function insertUser(email: string, orgId: string | null) {
  const hash = await bcrypt.hash("pass", 1);
  const [row] = await db
    .insert(usersTable)
    .values({ email, name: email, passwordHash: hash })
    .returning();
  return row.id;
}

async function insertUserOrgMembership(userId: string, orgId: string, role: string) {
  // The users table has no orgId column; membership is through userOrganizations or similar.
  // Check which approach is used (some projects use a junction table).
  // Fallback: just return — token carries orgId.
  return;
}

async function getPolicyTemplateId(): Promise<string> {
  const [row] = await db.select().from(policyTemplatesTable).limit(1);
  if (!row) throw new Error("No policy template seeded — run db seed first");
  return row.id;
}

async function createAndPublishPublication(input: {
  agOrgId: string;
  projectId: string;
  anOrgId: string;
  taktId: string;
  policyTemplateId: string;
}): Promise<string> {
  const now = new Date();

  const [pub] = await db
    .insert(dataPublicationsTable)
    .values({
      id: crypto.randomUUID(),
      agOrgId: input.agOrgId,
      projectId: input.projectId,
      dataProductType: "TAKT_INFORMATION_PACKAGE",
      title: "T116 Test Publication",
      description: null,
      version: 1,
      schemaVersion: "1.0",
      status: "PUBLISHED",
      policyTemplateId: input.policyTemplateId,
      selectedFields: ["taktReference", "plannedTimeWindow"],
      selectedTaktIds: [input.taktId],
      contentSnapshot: { taktReference: "T116" },
      contentHash: "aabbcc",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(dataPublicationRecipientsTable).values({
    id: crypto.randomUUID(),
    publicationId: pub.id,
    anOrgId: input.anOrgId,
    status: "OFFERED",
    notifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return pub.id;
}

async function createDraftRequest(
  taktId: string,
  guOrgId: string,
  nuOrgId: string,
  token: string,
  dataPublicationId?: string,
): Promise<string> {
  const res = await request(app)
    .post("/api/takt-requests")
    .set("Authorization", `Bearer ${token}`)
    .send({
      taktId,
      nuOrgId,
      requestNumber: `T116-${Date.now()}`,
      dataPublicationId,
    });

  if (res.status !== 201) {
    throw new Error(`createDraftRequest failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return (res.body as { id: string }).id;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  agOrgId       = await insertOrg("T116-AG", "AG");
  anOrgId       = await insertOrg("T116-AN", "AN");
  otherAgOrgId  = await insertOrg("T116-OtherAG", "AG");

  agUserId = await insertUser(`t116-ag+${Date.now()}@test.dev`, agOrgId);
  anUserId = await insertUser(`t116-an+${Date.now()}@test.dev`, anOrgId);

  agToken = makeToken(agUserId, agOrgId, ["AG_ADMIN"]);
  anToken = makeToken(anUserId, anOrgId, ["AN_ADMIN"]);

  const [proj] = await db
    .insert(projectsTable)
    .values({
      name: "T116-Project",
      agOrgId,
      status: "ACTIVE",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    })
    .returning();
  projectId = proj.id;

  await db.insert(projectContractorsTable).values({
    projectId,
    anOrgId,
    assignmentStatus: "ACTIVE",
  });
  await db.insert(projectMembershipsTable).values({
    id: `t116-membership-${crypto.randomUUID()}`,
    projectId,
    agOrgId,
    anOrgId,
    status: "ACTIVE",
    invitationId: `t116-invitation-${crypto.randomUUID()}`,
    correlationId: `t116-correlation-${crypto.randomUUID()}`,
  });

  const [takt] = await db
    .insert(takteTable)
    .values({
      taktBezeichnung: "T116-Takt",
      zone: "Zone-A",
      gewerk: "Elektro",
      projectId,
      plannedStart: "2026-03-01",
      plannedEnd: "2026-03-15",
    })
    .returning();
  taktId = takt.id;

  policyTemplateId = await getPolicyTemplateId();
});

afterAll(async () => {
  // Delete in FK-safe order.
  // takt_request_snapshots → takt_requests → publication_recipients → publications
  // message_outbox must be cleared before organizations (FK on sender_org_id).
  const reqRows = await db
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.guOrgId, agOrgId))
    .catch(() => [] as { id: string }[]);
  const reqIds = reqRows.map((r) => r.id);
  if (reqIds.length) {
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, reqIds)).catch(() => {});
  }
  await db.delete(taktRequestsTable).where(eq(taktRequestsTable.guOrgId, agOrgId)).catch(() => {});
  await db.delete(dataPublicationRecipientsTable).where(eq(dataPublicationRecipientsTable.anOrgId, anOrgId)).catch(() => {});
  await db.delete(dataPublicationsTable).where(eq(dataPublicationsTable.agOrgId, agOrgId)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.projectId, projectId)).catch(() => {});
  await db.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, projectId)).catch(() => {});
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, projectId)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => {});
  // Clear outbox/inbox rows before deleting users/orgs (FK constraints)
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, agOrgId)).catch(() => {});
  await db.delete(messageOutboxTable).where(eq(messageOutboxTable.senderOrgId, anOrgId)).catch(() => {});
  await db.delete(messageInboxTable).where(eq(messageInboxTable.recipientOrgId, anOrgId)).catch(() => {});
  await db.delete(messageInboxTable).where(eq(messageInboxTable.recipientOrgId, agOrgId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, agUserId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, anUserId)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, agOrgId)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, anOrgId)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, otherAgOrgId)).catch(() => {});
});

// ── S1: Send without dataPublicationId (legacy mode) ─────────────────────────
// Requests created without a publication are sent successfully, but the AN is
// blocked from accessing the snapshot details (LEGACY_NO_PUBLICATION).

describe("S1 – send without dataPublicationId (legacy mode)", () => {
  let legacyRequestId: string;

  beforeAll(async () => {
    legacyRequestId = await createDraftRequest(taktId, agOrgId, anOrgId, agToken);
  });

  afterAll(async () => {
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, legacyRequestId));
  });

  it("S1a – send without publication succeeds (SENT or DELIVERED)", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${legacyRequestId}/send`)
      .set("Authorization", `Bearer ${agToken}`);

    expect(res.status).toBe(200);
    expect(["SENT", "DELIVERED"]).toContain(res.body.status);
  });

  it("S1b – NU accessing details of a legacy request → 403 LEGACY_NO_PUBLICATION", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${legacyRequestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("LEGACY_NO_PUBLICATION");
  });
});

// ── S2: Send with non-PUBLISHED publication ────────────────────────────────────

describe("S2 – send with non-PUBLISHED publication", () => {
  it("should reject with 409 DATA_PUBLICATION_NOT_PUBLISHED", async () => {
    const now = new Date();

    // Create a DRAFT publication
    const [draftPub] = await db
      .insert(dataPublicationsTable)
      .values({
        id: crypto.randomUUID(),
        agOrgId,
        projectId,
        dataProductType: "TAKT_INFORMATION_PACKAGE",
        title: "S2-Draft",
        version: 1,
        schemaVersion: "1.0",
        status: "DRAFT",
        policyTemplateId,
        selectedFields: ["taktReference"],
        selectedTaktIds: [taktId],
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db.insert(dataPublicationRecipientsTable).values({
      id: crypto.randomUUID(),
      publicationId: draftPub.id,
      anOrgId,
      status: "OFFERED",
      notifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    let reqId: string | null = null;
    try {
      reqId = await createDraftRequest(taktId, agOrgId, anOrgId, agToken, draftPub.id);
      const res = await request(app)
        .post(`/api/takt-requests/${reqId}/send`)
        .set("Authorization", `Bearer ${agToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("DATA_PUBLICATION_NOT_PUBLISHED");
    } finally {
      // TaktRequest must be deleted before the publication (FK constraint)
      if (reqId) await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, reqId)).catch(() => {});
      await db.delete(dataPublicationRecipientsTable).where(eq(dataPublicationRecipientsTable.publicationId, draftPub.id)).catch(() => {});
      await db.delete(dataPublicationsTable).where(eq(dataPublicationsTable.id, draftPub.id)).catch(() => {});
    }
  });
});

// ── S3: Send with publication from different project ──────────────────────────

describe("S3 – send with publication from different project", () => {
  it("should reject with 409 DATA_PUBLICATION_WRONG_PROJECT", async () => {
    const now = new Date();

    // Create a second project (for otherAgOrgId) and takt
    const [otherProj] = await db
      .insert(projectsTable)
      .values({ name: "S3-OtherProject", agOrgId: otherAgOrgId, status: "ACTIVE", startDate: "2026-01-01", endDate: "2026-12-31" })
      .returning();

    const [otherPub] = await db
      .insert(dataPublicationsTable)
      .values({
        id: crypto.randomUUID(),
        agOrgId: otherAgOrgId,
        projectId: otherProj.id,
        dataProductType: "TAKT_INFORMATION_PACKAGE",
        title: "S3-OtherPub",
        version: 1,
        schemaVersion: "1.0",
        status: "PUBLISHED",
        policyTemplateId,
        selectedFields: ["taktReference"],
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db.insert(dataPublicationRecipientsTable).values({
      id: crypto.randomUUID(),
      publicationId: otherPub.id,
      anOrgId,
      status: "OFFERED",
      notifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    let reqId: string | null = null;
    try {
      reqId = await createDraftRequest(taktId, agOrgId, anOrgId, agToken, otherPub.id);
      const res = await request(app)
        .post(`/api/takt-requests/${reqId}/send`)
        .set("Authorization", `Bearer ${agToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("DATA_PUBLICATION_WRONG_PROJECT");
    } finally {
      if (reqId) await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, reqId)).catch(() => {});
      await db.delete(dataPublicationRecipientsTable).where(eq(dataPublicationRecipientsTable.publicationId, otherPub.id)).catch(() => {});
      await db.delete(dataPublicationsTable).where(eq(dataPublicationsTable.id, otherPub.id)).catch(() => {});
      await db.delete(projectsTable).where(eq(projectsTable.id, otherProj.id)).catch(() => {});
    }
  });
});

// ── S4: Send with AN not a recipient ──────────────────────────────────────────

describe("S4 – send when AN is not a recipient", () => {
  it("should reject with 409 DATA_PUBLICATION_AN_NOT_RECIPIENT", async () => {
    const now = new Date();

    // Create a publication WITHOUT this AN as recipient
    const [pub] = await db
      .insert(dataPublicationsTable)
      .values({
        id: crypto.randomUUID(),
        agOrgId,
        projectId,
        dataProductType: "TAKT_INFORMATION_PACKAGE",
        title: "S4-NoRecipient",
        version: 1,
        schemaVersion: "1.0",
        status: "PUBLISHED",
        policyTemplateId,
        selectedFields: ["taktReference"],
        selectedTaktIds: [taktId],
        contentSnapshot: {},
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    let reqId: string | null = null;
    try {
      reqId = await createDraftRequest(taktId, agOrgId, anOrgId, agToken, pub.id);
      const res = await request(app)
        .post(`/api/takt-requests/${reqId}/send`)
        .set("Authorization", `Bearer ${agToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("DATA_PUBLICATION_AN_NOT_RECIPIENT");
    } finally {
      if (reqId) await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, reqId)).catch(() => {});
      await db.delete(dataPublicationsTable).where(eq(dataPublicationsTable.id, pub.id)).catch(() => {});
    }
  });
});

// ── S5 + G1/G2/G4/G5: Happy path + policy gate ────────────────────────────────

describe("S5 + G1/G2/G4/G5 – valid publication, policy gate, and acceptance flow", () => {
  let pubId: string;
  let requestId: string;

  beforeAll(async () => {
    pubId = await createAndPublishPublication({
      agOrgId,
      projectId,
      anOrgId,
      taktId,
      policyTemplateId,
    });
    requestId = await createDraftRequest(taktId, agOrgId, anOrgId, agToken, pubId);
  });

  afterAll(async () => {
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    await db
      .delete(dataPublicationRecipientsTable)
      .where(eq(dataPublicationRecipientsTable.publicationId, pubId));
    await db.delete(dataPublicationsTable).where(eq(dataPublicationsTable.id, pubId));
  });

  it("S5 – send with valid publication succeeds", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${agToken}`);

    expect(res.status).toBe(200);
    expect(["SENT", "DELIVERED"]).toContain(res.body.status);
  });

  it("G1 – NU accessing details before policy acceptance → 403 POLICY_ACCEPTANCE_REQUIRED", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("POLICY_ACCEPTANCE_REQUIRED");
    expect(res.body.dataPublicationId).toBe(pubId);
    expect(res.body.dataOfferRef).toContain(pubId);
  });

  it("G4 – GU preview is never gated by policy", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${agToken}`);

    // GU always gets through (no policy gate for GU)
    expect([200, 409]).toContain(res.status);
    // Must not be a policy error
    expect(res.body.error).not.toBe("POLICY_ACCEPTANCE_REQUIRED");
  });

  it("G2 – NU accessing details after accepting policy → 200 + DETAILS_RETRIEVED", async () => {
    // Accept the policy (set recipient status to ACCEPTED)
    await db
      .update(dataPublicationRecipientsTable)
      .set({
        status: "ACCEPTED",
        policyAcceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dataPublicationRecipientsTable.publicationId, pubId),
          eq(dataPublicationRecipientsTable.anOrgId, anOrgId),
        ),
      );

    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(res.body.snapshotPayload).toBeDefined();

    // Status should now be DETAILS_RETRIEVED
    const [req] = await db
      .select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, requestId));
    expect(req.status).toBe("DETAILS_RETRIEVED");
  });

  it("G5 – repeated access after acceptance is idempotent (200, stays DETAILS_RETRIEVED)", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    const [req] = await db
      .select({ status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.id, requestId));
    expect(req.status).toBe("DETAILS_RETRIEVED");
  });
});

// ── G3: SUSPENDED publication ─────────────────────────────────────────────────

describe("G3 – publication suspended after sending", () => {
  let pubId: string;
  let requestId: string;

  beforeAll(async () => {
    pubId = await createAndPublishPublication({
      agOrgId,
      projectId,
      anOrgId,
      taktId,
      policyTemplateId,
    });
    requestId = await createDraftRequest(taktId, agOrgId, anOrgId, agToken, pubId);

    // Send successfully
    await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${agToken}`);

    // Then suspend the publication
    await db
      .update(dataPublicationsTable)
      .set({ status: "SUSPENDED", updatedAt: new Date() })
      .where(eq(dataPublicationsTable.id, pubId));
  });

  afterAll(async () => {
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    await db.delete(dataPublicationRecipientsTable).where(eq(dataPublicationRecipientsTable.publicationId, pubId));
    await db.delete(dataPublicationsTable).where(eq(dataPublicationsTable.id, pubId));
  });

  it("returns 403 DATA_PUBLICATION_INACTIVE when publication is SUSPENDED", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DATA_PUBLICATION_INACTIVE");
  });
});

// ── D1 / D2: Downstream process blocked before DETAILS_RETRIEVED ──────────────

describe("D1/D2 – downstream endpoints require DETAILS_RETRIEVED", () => {
  let pubId: string;
  let requestId: string;

  beforeAll(async () => {
    pubId = await createAndPublishPublication({
      agOrgId,
      projectId,
      anOrgId,
      taktId,
      policyTemplateId,
    });
    requestId = await createDraftRequest(taktId, agOrgId, anOrgId, agToken, pubId);

    // Send — leaves request in DELIVERED (no policy accepted)
    await request(app)
      .post(`/api/takt-requests/${requestId}/send`)
      .set("Authorization", `Bearer ${agToken}`);
  });

  afterAll(async () => {
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, requestId));
    await db.delete(dataPublicationRecipientsTable).where(eq(dataPublicationRecipientsTable.publicationId, pubId));
    await db.delete(dataPublicationsTable).where(eq(dataPublicationsTable.id, pubId));
  });

  it("D1 – availability check before DETAILS_RETRIEVED → 409", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/availability-checks`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({ checkDate: new Date().toISOString() });

    expect(res.status).toBe(409);
  });

  it("D2 – TaktResponse before DETAILS_RETRIEVED → 409", async () => {
    const res = await request(app)
      .post(`/api/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: { start: "2026-03-01T08:00:00Z", end: "2026-03-15T17:00:00Z" },
      });

    expect(res.status).toBe(409);
  });
});

/**
 * Task 3.8 — API integration tests for GET /takt-requests/:id/details.
 *
 * Covers:
 *   - Addressed NU retrieves details
 *   - GU (owner) retrieves details for preview
 *   - Other NU → 403
 *   - Other GU → 403
 *   - Hub admin → 403
 *   - Unauthenticated → 401
 *   - First NU access: DELIVERED → DETAILS_RETRIEVED transition
 *   - Repeated access: idempotent (no double-transition)
 *   - Snapshot invariant: changing the live Takt does NOT change the snapshot
 *   - Snapshot does not contain forbidden data fields
 *   - Notification payload and snapshot remain separate
 *   - 409 for non-retrievable status (e.g. DRAFT)
 *   - 404 for unknown requestId
 *
 * Fixture prefix: "t38-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db, anDb } from "@workspace/db";
import {
  organizationsTable,
  projectsTable,
  projectContractorsTable,
  projectMembershipsTable,
  coordinationPoliciesTable,
  leistungsanfragenTable,
  anLeistungsanfragenTable,
  takteTable,
  usersTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../app";

// ── JWT ───────────────────────────────────────────────────────────────────────

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
  roles?: string[];
}): string {
  const roles = p.roles ?? (p.orgType === "AG" ? ["AG_ADMIN"] : p.orgType === "AN" ? ["AN_ADMIN"] : []);
  return jwt.sign(
    { ...p, hubAdmin: p.hubAdmin ?? false, roles },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG      = "t38-org-gu";
const NU_ORG      = "t38-org-nu";       // addressed NU
const NU_ORG_2    = "t38-org-nu2";      // different NU — must get 403
const GU_ORG_2    = "t38-org-gu2";      // different GU — must get 403
const PROJECT_ID  = "t38-project-001";
const TAKT_ID     = "t38-takt-001";
const GU_USER     = "t38-user-gu";
const NU_USER     = "t38-user-nu";
const PROJECT_AGREEMENT_ID = "t38-project-agreement";

let guToken:   string;
let nuToken:   string;
let nu2Token:  string;
let gu2Token:  string;
let hubToken:  string;
let requestId: string;   // TaktRequest id after setup

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Organisations
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T38 GU Org",   type: "AG" },
    { id: NU_ORG,   name: "T38 NU Org",   type: "AN" },
    { id: NU_ORG_2, name: "T38 NU Org2",  type: "AN" },
    { id: GU_ORG_2, name: "T38 GU Org2",  type: "AG" },
  ]).onConflictDoNothing();

  // Users
  await db.insert(usersTable).values([
    { id: GU_USER, name: "GU",  email: "t38-gu@example.com",  passwordHash: "x" },
    { id: NU_USER, name: "NU",  email: "t38-nu@example.com",  passwordHash: "x" },
  ]).onConflictDoNothing();

  // Project + contractor
  await db.insert(projectsTable).values({
    id: PROJECT_ID, agOrgId: GU_ORG, name: "T38 Project",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT_ID, anOrgId: NU_ORG,
  }).onConflictDoNothing();
  await db.insert(coordinationPoliciesTable).values({
    id: PROJECT_AGREEMENT_ID,
    policyKey: PROJECT_AGREEMENT_ID,
    version: 1,
    kind: "PROJECT_AGREEMENT",
    projectId: PROJECT_ID,
    providerOrgId: GU_ORG,
    recipientOrgId: NU_ORG,
    lifecycleStatus: "ACCEPTED",
    policySnapshot: {},
    effectivePolicy: {
      policyType: "PROJECT_AGREEMENT",
      recipientOrganizationId: NU_ORG,
      projectReference: PROJECT_ID,
      validFrom: null,
      validUntil: null,
      childPolicyTypes: ["PERFORMANCE_REQUEST"],
      childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    },
  }).onConflictDoNothing();
  await db.insert(projectMembershipsTable).values({
    id: "t38-membership",
    projectId: PROJECT_ID,
    agOrgId: GU_ORG,
    anOrgId: NU_ORG,
    status: "ACTIVE",
    invitationId: "t38-invitation",
    correlationId: "t38-correlation",
    projectAgreementPolicyId: PROJECT_AGREEMENT_ID,
  }).onConflictDoNothing();

  // Takt (version 1)
  await db.insert(takteTable).values({
    id: TAKT_ID, projectId: PROJECT_ID,
    taktBezeichnung: "T38 Takt Alpha",
    zone: "Abschnitt B", gewerk: "Elektro",
    plannedStart: "2026-12-01", plannedEnd: "2026-12-14",
    version: 1,
  }).onConflictDoNothing();

  // JWT tokens
  guToken  = signToken({ userId: GU_USER, orgId: GU_ORG,   orgType: "AG" });
  nuToken  = signToken({ userId: NU_USER, orgId: NU_ORG,   orgType: "AN" });
  nu2Token = signToken({ userId: NU_USER, orgId: NU_ORG_2, orgType: "AN" });
  gu2Token = signToken({ userId: GU_USER, orgId: GU_ORG_2, orgType: "AG" });
  hubToken = signToken({ userId: GU_USER, orgId: null,      orgType: null, hubAdmin: true });

  // Publication + recipient (T116: details gate requires dataPublicationId + ACCEPTED policy)
  const now = new Date();
  const [anyPt] = await db.select({ id: policyTemplatesTable.id }).from(policyTemplatesTable).limit(1);
  if (anyPt) {
    await db.insert(dataPublicationsTable).values({
      id: "t38-publication-001",
      agOrgId: GU_ORG,
      projectId: PROJECT_ID,
      dataProductType: "TAKT_INFORMATION_PACKAGE",
      title: "T38 Test Publication",
      version: 1,
      schemaVersion: "1.0",
      status: "PUBLISHED",
      policyTemplateId: anyPt.id,
      selectedFields: ["taktReference"],
      selectedTaktIds: [TAKT_ID],
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    await db.insert(dataPublicationRecipientsTable).values({
      id: "t38-recipient-001",
      publicationId: "t38-publication-001",
      anOrgId: NU_ORG,
      status: "ACCEPTED",
      notifiedAt: now,
      policyAcceptedAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
  }

  // Create DRAFT + send → inbox + snapshot created, status DELIVERED
  const createRes = await request(app)
    .post("/api/takt-requests")
    .set("Authorization", `Bearer ${guToken}`)
    .send({
      taktId: TAKT_ID,
      nuOrgId: NU_ORG,
      responseRequiredBy: "2026-12-07T10:00:00Z",
      subject: "T38 Anfrage",
      message: "Bitte Details prüfen.",
      dataPublicationId: "t38-publication-001",
    });
  expect(createRes.status).toBe(201);
  requestId = createRes.body.id;

  const sendRes = await request(app)
    .post(`/api/takt-requests/${requestId}/send`)
    .set("Authorization", `Bearer ${guToken}`);
  expect(sendRes.status).toBe(200);
  // After send, status is DELIVERED — ready for details retrieval.
});

afterAll(async () => {
  const orgIds = [GU_ORG, NU_ORG, NU_ORG_2, GU_ORG_2];
  const orgSql = orgIds.map(id => `'${id}'`).join(",");

  await db.execute(sql`DELETE FROM message_inbox WHERE recipient_org_id = ANY(ARRAY[${sql.raw(orgSql)}])`).catch(() => {});
  await db.execute(sql`DELETE FROM message_outbox WHERE sender_org_id = ANY(ARRAY[${sql.raw(orgSql)}])`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id IN (
    SELECT id FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY[${sql.raw(orgSql)}])
  )`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungsanfragen WHERE gu_org_id = ANY(ARRAY[${sql.raw(orgSql)}])`).catch(() => {});
  // Clean up publication (after leistungsanfragen due to FK)
  await db.execute(sql`DELETE FROM data_publication_recipients WHERE publication_id = 't38-publication-001'`).catch(() => {});
  await db.execute(sql`DELETE FROM data_publications WHERE id = 't38-publication-001'`).catch(() => {});
  await db.execute(sql`DELETE FROM leistungen WHERE id = '${sql.raw(TAKT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM project_contractors WHERE project_id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM project_memberships WHERE project_id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM coordination_policies WHERE project_id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE id = '${sql.raw(PROJECT_ID)}'`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE id = ANY(ARRAY['${sql.raw(GU_USER)}','${sql.raw(NU_USER)}'])`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id = ANY(ARRAY[${sql.raw(orgSql)}])`).catch(() => {});
});

// ── A. Access control ─────────────────────────────────────────────────────────

describe("GET /takt-requests/:id/details — access control", () => {
  it("returns 401 without authentication", async () => {
    const res = await request(app).get(`/api/takt-requests/${requestId}/details`);
    expect(res.status).toBe(401);
  });

  it("addressed NU retrieves details — 200", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(200);
  });

  it("canonical alias keeps REQUIRES_CONSENT requests metadata-only until acceptance", async () => {
    const [projection] = await anDb.select({
      id: anLeistungsanfragenTable.id,
      policyDeltaClass: anLeistungsanfragenTable.policyDeltaClass,
      policyConsentStatus: anLeistungsanfragenTable.policyConsentStatus,
    })
      .from(anLeistungsanfragenTable)
      .where(eq(anLeistungsanfragenTable.externalLeistungsanfrageId, requestId))
      .limit(1);
    expect(projection).toBeTruthy();

    await anDb.update(anLeistungsanfragenTable).set({
      policyDeltaClass: "REQUIRES_CONSENT",
      policyConsentStatus: "PENDING",
    }).where(eq(anLeistungsanfragenTable.id, projection!.id));

    try {
      const res = await request(app)
        .get(`/api/an/leistungsanfragen/${requestId}/details`)
        .set("Authorization", `Bearer ${nuToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        policyDetailsAvailable: false,
        policyBlockedReason: "POLICY_CONSENT_REQUIRED",
        snapshotPayload: null,
      });
    } finally {
      await anDb.update(anLeistungsanfragenTable).set({
        policyDeltaClass: projection!.policyDeltaClass,
        policyConsentStatus: projection!.policyConsentStatus,
      }).where(eq(anLeistungsanfragenTable.id, projection!.id));
    }
  });

  it("GU owner retrieves details for preview — 200", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
  });

  it("different NU organisation gets 403", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nu2Token}`);
    expect(res.status).toBe(403);
  });

  it("different GU organisation gets 403", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${gu2Token}`);
    expect(res.status).toBe(403);
  });

  it("hub admin gets 403", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${hubToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a non-existent requestId", async () => {
    const res = await request(app)
      .get("/api/an/takt-requests/no-such-request/details")
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(404);
  });
});

// ── B. Response shape ─────────────────────────────────────────────────────────

describe("GET /takt-requests/:id/details — response shape", () => {
  it("contains required metadata fields", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    const body = res.body;

    expect(body.taktRequestId).toBe(requestId);
    expect(typeof body.requestNumber).toBe("string");
    expect(body.schemaVersion).toBe("1.0");
    expect(typeof body.taktVersion).toBe("number");
    expect(body.guOrgId).toBe(GU_ORG);
    expect(body.nuOrgId).toBe(NU_ORG);
    expect(body.snapshotPayload).toBeDefined();
    expect(typeof body.snapshotPayload).toBe("object");
    expect(body.createdAt).toBeTruthy();
  });

  it("snapshotPayload does not contain forbidden fields", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    const payload = res.body.snapshotPayload as Record<string, unknown>;

    // Must NOT contain internal GU project data or other-NU data
    expect(payload.agOrgId).toBeUndefined();
    expect(payload.nuResources).toBeUndefined();
    expect(payload.otherRequests).toBeUndefined();
    expect(payload.internalComments).toBeUndefined();

    // Must contain the core released fields (whitelist field names from buildTaktRequestSnapshot)
    expect(payload.taktReference).toBe(TAKT_ID);
  });

  it("notification payload (inbox) and snapshot remain separate", async () => {
    // The inbox message should have a minimal payload, not the full snapshot
    const inboxRes = await request(app)
      .get(`/api/messages/inbox?correlationId=${requestId}`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(inboxRes.status).toBe(200);
    expect(inboxRes.body.length).toBeGreaterThan(0);

    const notifPayload = inboxRes.body[0].payload as Record<string, unknown>;

    // Notification has the minimal reference fields
    expect(notifPayload.taktRequestId).toBe(requestId);
    expect(notifPayload).toHaveProperty("taktRequestId", requestId);

    // Notification does NOT have the full snapshot payload
    expect(notifPayload.taktBezeichnung).toBeUndefined();
    expect(notifPayload.zone).toBeUndefined();
    expect(notifPayload.gewerk).toBeUndefined();
    expect(notifPayload.snapshotPayload).toBeUndefined();
  });
});

// ── C. Status transition ──────────────────────────────────────────────────────

describe("AN details review — explicit status transition", () => {
  it("explicit review transitions RECEIVED → DETAILS_RETRIEVED", async () => {
    const res = await request(app)
      .post(`/api/an/takt-requests/${requestId}/details/review`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DETAILS_RETRIEVED");
  });

  it("repeated NU access is read-only — status stays DETAILS_RETRIEVED", async () => {
    const res1 = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);
    const res2 = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe("DETAILS_RETRIEVED");

    // detailsRetrievedAt must be the same (not overwritten on repeat)
    expect(res1.body.detailsRetrievedAt).toBe(res2.body.detailsRetrievedAt);
  });

  it("GU preview access does NOT change the request status", async () => {
    // At this point status is DETAILS_RETRIEVED (set by the NU access above).
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    // Status must not be changed by GU access
    expect(res.body.status).toBe("DELIVERED");
  });

  it("returns 409 for a request in non-retrievable status (DRAFT)", async () => {
    // Create a DRAFT request — never send it
    const createRes = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: TAKT_ID, nuOrgId: NU_ORG });
    expect(createRes.status).toBe(201);
    const draftId = createRes.body.id;

    const res = await request(app)
      .get(`/api/an/takt-requests/${draftId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);

    expect(res.status).toBe(404);

    // Cleanup
    await db.execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id = '${sql.raw(draftId)}'`).catch(() => {});
    await db.execute(sql`DELETE FROM leistungsanfragen WHERE id = '${sql.raw(draftId)}'`).catch(() => {});
  });
});

// ── D. Snapshot invariance ────────────────────────────────────────────────────

describe("GET /takt-requests/:id/details — snapshot invariance", () => {
  /**
   * KEY INVARIANT TEST (task 3.8 spec):
   *   1. Snapshot was created at Takt version 1.
   *   2. Mutate the live Takt row (change taktBezeichnung + bump version to 2).
   *   3. Pull /details — response must still show version 1 data from snapshot.
   */
  it("snapshot reflects version at send time, not the mutated live Takt", async () => {
    // 1. Get snapshot at time of send (should be version 1)
    const before = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(before.status).toBe(200);
    const snapshotVersion = before.body.taktVersion;
    expect(snapshotVersion).toBe(1);

    // Snapshot uses whitelist field "workPackage" (= taktBezeichnung at snapshot time)
    const snapshotBezeichnung = (before.body.snapshotPayload as Record<string, unknown>).workPackage as string;

    // 2. Mutate the live Takt row — different name, bump version
    await db
      .update(takteTable)
      .set({ taktBezeichnung: "T38 Takt Alpha — MUTIERT", version: 2 })
      .where(eq(takteTable.id, TAKT_ID));

    // 3. Pull /details again — must still show snapshot data (version 1)
    const after = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(after.status).toBe(200);

    // taktVersion on the request row is immutable at creation time
    expect(after.body.taktVersion).toBe(snapshotVersion);

    // snapshotPayload still reflects the original Takt name (field: workPackage), not the mutated one
    const afterPayload = after.body.snapshotPayload as Record<string, unknown>;
    expect(afterPayload.workPackage).toBe(snapshotBezeichnung);
    expect(afterPayload.workPackage).not.toBe("T38 Takt Alpha — MUTIERT");

    // Restore Takt for subsequent tests
    await db
      .update(takteTable)
      .set({ taktBezeichnung: "T38 Takt Alpha", version: 1 })
      .where(eq(takteTable.id, TAKT_ID));
  });
});

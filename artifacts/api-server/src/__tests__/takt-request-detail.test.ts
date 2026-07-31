/**
 * Task 5.4 — GET /takt-requests/:id (GU detail view)
 *
 * Tests:
 *   - GU can open own request — enriched metadata present
 *   - foreign GU gets 404 (not 403, to avoid existence leak)
 *   - NU gets 404 (belongs to different guOrgId)
 *   - hub admin gets 403
 *   - 401 without token
 *   - timeline timestamps all present in response
 *   - fachlicher and technischer status are separate fields
 *   - snapshot returned correctly (immutable payload)
 *   - notification preview: outbox payload present after send
 *   - snapshot and notification are separate fields (not merged)
 *   - no internal NU data in response (only generic fields)
 *
 * Fixture prefix: "t54-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  projectContractorsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";

// ── JWT ───────────────────────────────────────────────────────────────────────

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(p: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
}): string {
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG    = "t54-gu-org";
const NU_ORG    = "t54-nu-org";
const OTHER_GU  = "t54-other-gu";
const GU_USER   = "t54-gu-user";
const NU_USER   = "t54-nu-user";
const PROJECT   = "t54-project";
const TAKT      = "t54-takt";

const guToken      = signToken({ userId: GU_USER,  orgId: GU_ORG,  orgType: "AG" });
const nuToken      = signToken({ userId: NU_USER,  orgId: NU_ORG,  orgType: "AN" });
const otherGuToken = signToken({ userId: "t54-other-user", orgId: OTHER_GU, orgType: "AG" });
const hubToken     = signToken({ userId: "t54-hub-user",   orgId: null,     orgType: null, hubAdmin: true });

let requestId = "";

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "t54 GU Org",    type: "AG" as const },
    { id: NU_ORG,   name: "t54 NU Org",    type: "AN" as const },
    { id: OTHER_GU, name: "t54 Other GU",  type: "AG" as const },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER,          email: "t54-gu@test.com",    name: "GU",       passwordHash: "x" },
    { id: NU_USER,          email: "t54-nu@test.com",    name: "NU",       passwordHash: "x" },
    { id: "t54-other-user", email: "t54-other@test.com", name: "Other GU", passwordHash: "x" },
    { id: "t54-hub-user",   email: "t54-hub@test.com",   name: "Hub",      passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values({
    id: PROJECT,
    agOrgId: GU_ORG,
    name: "t54 Test Project",
    status: "ACTIVE" as const,
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT,
    anOrgId: NU_ORG,
  }).onConflictDoNothing();

  await db.insert(takteTable).values({
    id: TAKT,
    projectId: PROJECT,
    taktBezeichnung: "t54 Takt Eins",
    zone: "Z1",
    gewerk: "Elektro",
    plannedStart: "2026-10-01",
    plannedEnd: "2026-10-07",
  }).onConflictDoNothing();

  const [row] = await db.insert(taktRequestsTable).values({
    taktId: TAKT,
    taktVersion: 1,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG,
    requestNumber: "TKR-5400-0001",
    status: "DELIVERED" as const,
    responseRequiredBy: new Date("2026-11-01T00:00:00Z"),
    sentAt: new Date("2026-10-01T09:00:00Z"),
    deliveredAt: new Date("2026-10-01T09:00:05Z"),
    createdByUserId: GU_USER,
  }).returning();
  requestId = row.id;

  // Insert a snapshot for this request
  await db.insert(taktRequestSnapshotsTable).values({
    taktRequestId: requestId,
    schemaVersion: "1.0",
    snapshotPayload: {
      gewerk: "Elektro",
      arbeitspaket: "Verdrahtung EG",
      ort: "Z1",
      taktVersion: 1,
      taktWindow: { start: "2026-10-01", end: "2026-10-07" },
      resourceRequirements: [{ type: "Elektriker", count: 3 }],
      constraints: ["Zugang ab 7:00 Uhr"],
      documentReferences: ["ELK-2026-01"],
    },
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(taktRequestSnapshotsTable).where(
    eq(taktRequestSnapshotsTable.taktRequestId, requestId),
  );
  await db.delete(taktRequestsTable).where(
    eq(taktRequestsTable.guOrgId, GU_ORG),
  );
  await db.delete(takteTable).where(eq(takteTable.id, TAKT));
  await db.delete(projectContractorsTable).where(
    eq(projectContractorsTable.projectId, PROJECT),
  );
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  for (const email of [
    "t54-gu@test.com", "t54-nu@test.com",
    "t54-other@test.com", "t54-hub@test.com",
  ]) {
    await db.delete(usersTable).where(eq(usersTable.email, email));
  }
  for (const id of [GU_ORG, NU_ORG, OTHER_GU]) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /takt-requests/:id — GU detail view", () => {
  it("401 without token", async () => {
    const res = await request(app).get(`/api/takt-requests/${requestId}`);
    expect(res.status).toBe(401);
  });

  it("hub admin gets 403", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${hubToken}`);
    expect(res.status).toBe(403);
  });

  it("foreign GU gets 404 (existence not leaked)", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${otherGuToken}`);
    expect(res.status).toBe(404);
  });

  it("NU gets 404 (guOrgId does not match NU's orgId)", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${nuToken}`);
    expect(res.status).toBe(404);
  });

  it("non-existent ID returns 404", async () => {
    const res = await request(app)
      .get("/api/takt-requests/non-existent-id")
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(404);
  });

  it("GU can open own request — all required fields present", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const body = res.body;

    // Core identity
    expect(body.id).toBe(requestId);
    expect(body.requestNumber).toBe("TKR-5400-0001");
    expect(body.status).toBe("DELIVERED");

    // Enriched fields
    expect(body.taktBezeichnung).toBe("t54 Takt Eins");
    expect(body.projectName).toBe("t54 Test Project");
    expect(body.nuOrgName).toBe("t54 NU Org");

    // Timeline object present
    expect(body.timeline).toBeDefined();
    expect(body.timeline.requestCreatedAt).toBeTruthy();

    // Transport object present
    expect(body.transport).toBeDefined();

    // Snapshot present
    expect(body.snapshot).toBeDefined();
    expect(body.snapshot).not.toBeNull();
  });

  it("fachlicher status and technischer transport.status are separate fields", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const body = res.body;

    // Fachlicher Status
    expect(body).toHaveProperty("status");
    expect(["DRAFT","SENT","DELIVERED","DETAILS_RETRIEVED","UNDER_REVIEW",
      "ACCEPTED","ALTERNATIVES_PROPOSED","REJECTED","REVISION_REQUIRED",
      "CANCELLED","EXPIRED","SUPERSEDED"]).toContain(body.status);

    // Technischer (Outbox) Status — in transport sub-object
    expect(body.transport).toHaveProperty("status");
    // They are separate objects; technischer status is NOT top-level status
    expect(body.transport.status).not.toEqual(undefined);
  });

  it("timeline timestamps are available for sent+delivered request", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const tl = res.body.timeline;

    expect(tl.requestCreatedAt).toBeTruthy();     // always present
    expect(tl.snapshotCreatedAt).toBeTruthy();    // snapshot was inserted
    expect(tl.sentAt).toBeTruthy();               // sentAt was set in fixture
    expect(tl.deliveredAt).toBeTruthy();          // deliveredAt was set in fixture
    expect(tl.inboxReadAt).toBeNull();            // no inbox entry in test
    expect(tl.detailsRetrievedAt).toBeNull();     // not yet retrieved
    expect(tl.checkedAt).toBeNull();              // never tracked from GU side
    expect(tl.responseCreatedAt).toBeNull();      // no response yet
  });

  it("snapshot is present and contains snapshotPayload", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const snap = res.body.snapshot;
    expect(snap).not.toBeNull();
    expect(snap.schemaVersion).toBe("1.0");
    expect(snap.snapshotPayload).toBeDefined();
    expect(snap.snapshotPayload.gewerk).toBe("Elektro");
    expect(snap.createdAt).toBeTruthy();
  });

  it("snapshot and notification are returned as separate fields", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const body = res.body;

    // snapshot is a separate top-level field
    expect(body).toHaveProperty("snapshot");
    // transport contains the notification payload (separate from snapshot)
    expect(body).toHaveProperty("transport");
    expect(body.transport).toHaveProperty("notificationPayload");

    // They are NOT the same object
    expect(body.snapshot).not.toEqual(body.transport.notificationPayload);
  });

  it("no internal NU data exposed — only generic fields", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    const body = res.body;

    // Internal NU fields must never appear
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("internalNuProjectId");
    expect(bodyStr).not.toContain("nuResourceId");
    expect(bodyStr).not.toContain("internalNuData");

    // NU org name is safe — generic org name, not internal plan data
    expect(body.nuOrgName).toBe("t54 NU Org");
  });

  it("response field is null when no response exists", async () => {
    const res = await request(app)
      .get(`/api/takt-requests/${requestId}`)
      .set("Authorization", `Bearer ${guToken}`);

    expect(res.status).toBe(200);
    expect(res.body.response).toBeNull();
  });
});

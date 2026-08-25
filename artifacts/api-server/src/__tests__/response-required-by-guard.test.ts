/**
 * Task 135 — responseRequiredBy past-date guard
 *
 * Tests:
 *   - POST /takt-requests with responseRequiredBy in the past → 400 (German message)
 *   - POST /takt-requests with responseRequiredBy exactly 1 h from now → 201
 *   - POST /projects/:id/takt-requests with responseRequiredBy in the past → 400
 *   - POST /projects/:id/takt-requests with responseRequiredBy exactly 1 h from now → 201
 *
 * The guard fires before any DB lookup on the "past" path, so no fixtures are
 * required for those cases. The "valid" cases (→ 201) do need a minimal fixture
 * so that createTaktRequestWithSnapshot() can succeed.
 *
 * Fixture prefix: "t135-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktRequestAuditEventsTable,
  projectContractorsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";

// ── JWT helpers ───────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function sign(p: { userId: string; orgId: string | null; orgType: "AG" | "AN" | null; hubAdmin?: boolean; roles?: string[] }): string {
  return jwt.sign({ ...p, hubAdmin: p.hubAdmin ?? false }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG  = "t135-gu-org";
const NU_ORG  = "t135-nu-org";
const GU_USER = "t135-gu-user";
const PROJECT = "t135-project";
const TAKT    = "t135-takt";

const guToken = sign({ userId: GU_USER, orgId: GU_ORG, orgType: "AG", roles: ["AG_ADMIN"] });

// ── Date helpers ──────────────────────────────────────────────────────────────

/** ISO-8601 string that is exactly `offsetMs` ms from now. */
function isoOffset(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const ONE_HOUR_MS   = 60 * 60 * 1000;
const PAST_DATE     = isoOffset(-ONE_HOUR_MS);          // 1 hour in the past → rejected
const VALID_DATE    = isoOffset(ONE_HOUR_MS + 60_000);  // 1 h + 1 min from now → accepted

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Pre-cleanup in case a previous run crashed
  const staleReqs = await db
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.taktId, TAKT))
    .catch(() => [] as { id: string }[]);

  const staleIds = staleReqs.map((r) => r.id);
  if (staleIds.length > 0) {
    await db.delete(taktRequestAuditEventsTable).where(inArray(taktRequestAuditEventsTable.requestId, staleIds)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, staleIds)).catch(() => {});
    await db.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, staleIds)).catch(() => {});
  }

  await db.delete(takteTable).where(eq(takteTable.id, TAKT)).catch(() => {});
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG)).catch(() => {});

  // Insert fresh fixtures
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "t135 GU", type: "AG" as const },
    { id: NU_ORG, name: "t135 NU", type: "AN" as const },
  ]);

  await db.insert(usersTable).values({
    id: GU_USER, name: "t135 GU User", email: "t135-gu@test.invalid", passwordHash: "x",
  });

  await db.insert(projectsTable).values({
    id: PROJECT, name: "t135 Project", agOrgId: GU_ORG, status: "ACTIVE" as const,
    startDate: "2026-09-01", endDate: "2026-12-31",
  });

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT, anOrgId: NU_ORG,
  });

  await db.insert(takteTable).values({
    id: TAKT, projectId: PROJECT,
    taktBezeichnung: "t135 Takt", zone: "Z1", gewerk: "Rohbau",
    plannedStart: "2026-11-01", plannedEnd: "2026-11-07",
  });
});

afterAll(async () => {
  // FK-safe deletion order
  const reqs = await db
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(eq(taktRequestsTable.taktId, TAKT))
    .catch(() => [] as { id: string }[]);

  const ids = reqs.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(taktRequestAuditEventsTable).where(inArray(taktRequestAuditEventsTable.requestId, ids)).catch(() => {});
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, ids)).catch(() => {});
    await db.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, ids)).catch(() => {});
  }

  await db.delete(takteTable).where(eq(takteTable.id, TAKT));
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  await db.delete(usersTable).where(eq(usersTable.id, GU_USER));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG));
});

// ── POST /api/takt-requests ───────────────────────────────────────────────────

describe("POST /api/takt-requests — responseRequiredBy guard", () => {
  it("returns 400 with German error message when responseRequiredBy is in the past", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
        responseRequiredBy: PAST_DATE,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen.",
    );
  });

  it("returns 400 when responseRequiredBy is less than 1 hour from now", async () => {
    const almostAnHour = isoOffset(ONE_HOUR_MS - 60_000); // 59 min from now
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
        responseRequiredBy: almostAnHour,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Antwortfrist");
  });

  it("returns 201 when responseRequiredBy is at least 1 hour in the future", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
        responseRequiredBy: VALID_DATE,
      });

    expect(res.status).toBe(201);
    expect(res.body.responseRequiredBy).toBeTruthy();
    expect(res.body.status).toBe("DRAFT");
  });

  it("returns 201 when responseRequiredBy is omitted entirely", async () => {
    const res = await request(app)
      .post("/api/takt-requests")
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
      });

    expect(res.status).toBe(201);
    expect(res.body.responseRequiredBy).toBeNull();
  });
});

// ── POST /api/projects/:id/takt-requests ─────────────────────────────────────

describe("POST /api/projects/:id/takt-requests — responseRequiredBy guard", () => {
  it("returns 400 with German error message when responseRequiredBy is in the past", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takt-requests`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
        responseRequiredBy: PAST_DATE,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen.",
    );
  });

  it("returns 400 when responseRequiredBy is less than 1 hour from now", async () => {
    const almostAnHour = isoOffset(ONE_HOUR_MS - 60_000); // 59 min from now
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takt-requests`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
        responseRequiredBy: almostAnHour,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Antwortfrist");
  });

  it("returns 201 when responseRequiredBy is at least 1 hour in the future", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takt-requests`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
        responseRequiredBy: VALID_DATE,
      });

    expect(res.status).toBe(201);
    expect(res.body.responseRequiredBy).toBeTruthy();
    expect(res.body.status).toBe("DRAFT");
  });

  it("returns 201 when responseRequiredBy is omitted entirely", async () => {
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takt-requests`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        taktId: TAKT,
        nuOrgId: NU_ORG,
      });

    expect(res.status).toBe(201);
    expect(res.body.responseRequiredBy).toBeNull();
  });
});

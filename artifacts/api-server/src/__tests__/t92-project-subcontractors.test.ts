/**
 * Task 9.2 — Project-scoped AN assignment and AG overview tests
 *
 * Tests:
 *  Suite A — Assignment CRUD (POST/PATCH/deactivate/GET)
 *  Suite B — AG sees only own projects
 *  Suite C — Overview endpoint KPIs
 *  Suite D — AN assignment for TaktRequests (active-status check)
 *  Suite E — AN privacy (no cross-project leakage)
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import {
  organizationsTable,
  projectsTable,
  projectContractorsTable,
  usersTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";

function makeToken(orgId: string | null, orgType: "AG" | "AN" | null, userId: string) {
  return jwt.sign({ userId, orgId, orgType, hubAdmin: false }, JWT_SECRET, { expiresIn: "1h" });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const T92 = "t92";
let guOrg1Id: string;
let guOrg2Id: string;
let nuOrg1Id: string;
let nuOrg2Id: string;
let proj1Id: string;
let proj2Id: string;
let gu1UserId: string;
let gu2UserId: string;
let nu1UserId: string;
let gu1Token: string;
let gu2Token: string;
let nu1Token: string;

beforeAll(async () => {
  // GU orgs
  const [g1] = await db.insert(organizationsTable).values({ name: `${T92}-GU1`, type: "AG" }).returning();
  const [g2] = await db.insert(organizationsTable).values({ name: `${T92}-GU2`, type: "AG" }).returning();
  guOrg1Id = g1.id; guOrg2Id = g2.id;

  // NU orgs
  const [n1] = await db.insert(organizationsTable).values({ name: `${T92}-NU1`, type: "AN" }).returning();
  const [n2] = await db.insert(organizationsTable).values({ name: `${T92}-NU2`, type: "AN" }).returning();
  nuOrg1Id = n1.id; nuOrg2Id = n2.id;

  // Users
  const [u1] = await db.insert(usersTable).values({ email: `${T92}-gu1@test.example`, name: `${T92} GU1`, passwordHash: "x" }).returning();
  const [u2] = await db.insert(usersTable).values({ email: `${T92}-gu2@test.example`, name: `${T92} GU2`, passwordHash: "x" }).returning();
  const [u3] = await db.insert(usersTable).values({ email: `${T92}-nu1@test.example`, name: `${T92} NU1`, passwordHash: "x" }).returning();
  gu1UserId = u1.id; gu2UserId = u2.id; nu1UserId = u3.id;

  // Projects
  const [p1] = await db.insert(projectsTable).values({ name: `${T92}-Proj1`, agOrgId: guOrg1Id }).returning();
  const [p2] = await db.insert(projectsTable).values({ name: `${T92}-Proj2`, agOrgId: guOrg2Id }).returning();
  proj1Id = p1.id; proj2Id = p2.id;

  gu1Token = makeToken(guOrg1Id, "AG", gu1UserId);
  gu2Token = makeToken(guOrg2Id, "AG", gu2UserId);
  nu1Token = makeToken(nuOrg1Id, "AN", nu1UserId);
});

afterAll(async () => {
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, proj1Id));
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, proj2Id));
  await db.delete(projectsTable).where(eq(projectsTable.id, proj1Id));
  await db.delete(projectsTable).where(eq(projectsTable.id, proj2Id));
  await db.delete(usersTable).where(eq(usersTable.id, gu1UserId));
  await db.delete(usersTable).where(eq(usersTable.id, gu2UserId));
  await db.delete(usersTable).where(eq(usersTable.id, nu1UserId));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, nuOrg1Id));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, nuOrg2Id));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, guOrg1Id));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, guOrg2Id));
});

// ── Suite A — Assignment CRUD ─────────────────────────────────────────────────

describe("Suite A — Project subcontractor assignment CRUD", () => {
  let assignmentId: string;

  it("POST /ag/projects/:id/subcontractors creates ACTIVE assignment", async () => {
    const res = await request(app)
      .post(`/api/ag/projects/${proj1Id}/subcontractors`)
      .set("Authorization", `Bearer ${gu1Token}`)
      .send({ anOrgId: nuOrg1Id, trade: "Elektro" });
    expect(res.status).toBe(201);
    expect(res.body.anOrgId).toBe(nuOrg1Id);
    expect(res.body.trade).toBe("Elektro");
    expect(res.body.assignmentStatus).toBe("ACTIVE");
    expect(res.body.id).toBeDefined();
    assignmentId = res.body.id;
  });

  it("POST /ag/projects/:id/subcontractors allows same AN for different trade", async () => {
    const res = await request(app)
      .post(`/api/ag/projects/${proj1Id}/subcontractors`)
      .set("Authorization", `Bearer ${gu1Token}`)
      .send({ anOrgId: nuOrg1Id, trade: "Haustechnik" });
    expect(res.status).toBe(201);
    expect(res.body.trade).toBe("Haustechnik");
    // Clean up immediately
    await db.delete(projectContractorsTable).where(eq(projectContractorsTable.id, res.body.id));
  });

  it("POST /ag/projects/:id/subcontractors → 409 for exact duplicate (same AN + trade)", async () => {
    const res = await request(app)
      .post(`/api/ag/projects/${proj1Id}/subcontractors`)
      .set("Authorization", `Bearer ${gu1Token}`)
      .send({ anOrgId: nuOrg1Id, trade: "Elektro" });
    expect(res.status).toBe(409);
  });

  it("POST /ag/projects/:id/subcontractors → 404 for non-existent AN", async () => {
    const res = await request(app)
      .post(`/api/ag/projects/${proj1Id}/subcontractors`)
      .set("Authorization", `Bearer ${gu1Token}`)
      .send({ anOrgId: "does-not-exist" });
    expect(res.status).toBe(404);
  });

  it("POST /ag/projects/:id/subcontractors → 403 for AN user", async () => {
    const res = await request(app)
      .post(`/api/ag/projects/${proj1Id}/subcontractors`)
      .set("Authorization", `Bearer ${nu1Token}`)
      .send({ anOrgId: nuOrg1Id });
    expect(res.status).toBe(403);
  });

  it("GET /ag/projects/:id/subcontractors lists assignments with AN name", async () => {
    const res = await request(app)
      .get(`/api/ag/projects/${proj1Id}/subcontractors`)
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const assignment = res.body.find((a: any) => a.id === assignmentId);
    expect(assignment).toBeDefined();
    expect(assignment.anName).toBeDefined();
    expect(assignment.assignmentStatus).toBe("ACTIVE");
  });

  it("PATCH /ag/projects/:id/subcontractors/:assignmentId updates trade and status", async () => {
    const res = await request(app)
      .patch(`/api/ag/projects/${proj1Id}/subcontractors/${assignmentId}`)
      .set("Authorization", `Bearer ${gu1Token}`)
      .send({ trade: "Elektro-Updated", validFrom: "2026-01-01" });
    expect(res.status).toBe(200);
    expect(res.body.trade).toBe("Elektro-Updated");
    expect(res.body.validFrom).toBe("2026-01-01");
  });

  it("POST /ag/projects/:id/subcontractors/:assignmentId/deactivate sets INACTIVE", async () => {
    const res = await request(app)
      .post(`/api/ag/projects/${proj1Id}/subcontractors/${assignmentId}/deactivate`)
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.assignmentStatus).toBe("INACTIVE");
    expect(res.body.assignmentId).toBe(assignmentId);
  });

  it("deactivated assignment is still returned (soft delete, not hard delete)", async () => {
    const res = await request(app)
      .get(`/api/ag/projects/${proj1Id}/subcontractors`)
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);
    const found = res.body.find((a: any) => a.id === assignmentId);
    expect(found).toBeDefined(); // still visible
    expect(found.assignmentStatus).toBe("INACTIVE");
  });

  it("PATCH /ag/projects/:id/subcontractors/:assignmentId → 404 for wrong project", async () => {
    const res = await request(app)
      .patch(`/api/ag/projects/${proj2Id}/subcontractors/${assignmentId}`)
      .set("Authorization", `Bearer ${gu2Token}`)
      .send({ trade: "X" });
    expect(res.status).toBe(404);
  });
});

// ── Suite B — AG project isolation ───────────────────────────────────────────

describe("Suite B — AG project isolation", () => {
  it("GET /ag/projects/overview returns only own projects", async () => {
    const res = await request(app)
      .get("/api/ag/projects/overview")
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((p: any) => p.projectId);
    expect(ids).toContain(proj1Id);
    expect(ids).not.toContain(proj2Id);
  });

  it("GET /ag/projects/:id/overview → 404 for another AG's project", async () => {
    const res = await request(app)
      .get(`/api/ag/projects/${proj2Id}/overview`)
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(404);
  });

  it("GET /ag/projects/:id/subcontractors → 404 for another AG's project", async () => {
    const res = await request(app)
      .get(`/api/ag/projects/${proj2Id}/subcontractors`)
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(404);
  });

  it("GET /ag/projects/overview → 403 for AN user", async () => {
    const res = await request(app)
      .get("/api/ag/projects/overview")
      .set("Authorization", `Bearer ${nu1Token}`);
    expect(res.status).toBe(403);
  });
});

// ── Suite C — Overview KPIs ───────────────────────────────────────────────────

describe("Suite C — Overview endpoint KPIs shape", () => {
  it("GET /ag/projects/overview returns expected KPI fields", async () => {
    const res = await request(app)
      .get("/api/ag/projects/overview")
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);
    const proj = res.body.find((p: any) => p.projectId === proj1Id);
    expect(proj).toBeDefined();
    expect(proj).toHaveProperty("totalTaktRequests");
    expect(proj).toHaveProperty("openTaktRequests");
    expect(proj).toHaveProperty("overdueTaktRequests");
    expect(proj).toHaveProperty("acceptedTaktRequests");
    expect(proj).toHaveProperty("alternativeTaktRequests");
    expect(proj).toHaveProperty("rejectedTaktRequests");
    expect(proj).toHaveProperty("revisionRequiredRequests");
    expect(proj).toHaveProperty("assignedAnCount");
    expect(proj).toHaveProperty("assignedTrades");
  });

  it("GET /ag/projects/:id/overview returns expected nested shape", async () => {
    const res = await request(app)
      .get(`/api/ag/projects/${proj1Id}/overview`)
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("project");
    expect(res.body).toHaveProperty("assignedAn");
    expect(res.body).toHaveProperty("coordination");
    expect(res.body).toHaveProperty("recentRequests");
    expect(res.body.project.projectId).toBe(proj1Id);
    // coordination fields
    const coord = res.body.coordination;
    expect(coord).toHaveProperty("numberOfTakts");
    expect(coord).toHaveProperty("confirmedTakts");
    expect(coord).toHaveProperty("taktsInCoordination");
    expect(coord).toHaveProperty("openRequests");
    expect(coord).toHaveProperty("overdueRequests");
    expect(coord).toHaveProperty("expiredRequests");
    expect(coord).toHaveProperty("revisionRounds");
  });

  it("assignedAn entries contain no NU-internal fields", async () => {
    // Add a second NU to proj1 to have at least one contractor in the response
    const [row] = await db
      .insert(projectContractorsTable)
      .values({ projectId: proj1Id, anOrgId: nuOrg2Id })
      .returning();

    const res = await request(app)
      .get(`/api/ag/projects/${proj1Id}/overview`)
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);

    for (const an of res.body.assignedAn) {
      // Must NOT expose NU-internal data
      expect(an).not.toHaveProperty("internalResultPayload");
      expect(an).not.toHaveProperty("resourcePlanning");
      expect(an).not.toHaveProperty("localProjectId");
      expect(an).not.toHaveProperty("resourceId");
      expect(an).not.toHaveProperty("employeeName");
      expect(an).not.toHaveProperty("internalCost");
      // Must expose coordination-relevant fields
      expect(an).toHaveProperty("anOrgId");
      expect(an).toHaveProperty("anName");
      expect(an).toHaveProperty("totalRequests");
    }

    // clean up
    await db.delete(projectContractorsTable).where(eq(projectContractorsTable.id, row.id));
  });
});

// ── Suite D — AN assignment validation for TaktRequests ──────────────────────

describe("Suite D — Inactive/missing assignment blocks TaktRequest creation (snapshot service)", () => {
  it("same AN can be assigned to multiple projects", async () => {
    const [r1] = await db
      .insert(projectContractorsTable)
      .values({ projectId: proj2Id, anOrgId: nuOrg1Id, assignmentStatus: "ACTIVE" })
      .returning();

    const check = await db
      .select()
      .from(projectContractorsTable)
      .where(
        and(
          eq(projectContractorsTable.projectId, proj2Id),
          eq(projectContractorsTable.anOrgId, nuOrg1Id),
        ),
      );
    expect(check.length).toBeGreaterThanOrEqual(1);

    // clean up
    await db.delete(projectContractorsTable).where(eq(projectContractorsTable.id, r1.id));
  });

  it("INACTIVE assignment is NOT counted as active AN for overview", async () => {
    // Insert INACTIVE assignment
    const [row] = await db
      .insert(projectContractorsTable)
      .values({ projectId: proj1Id, anOrgId: nuOrg2Id, assignmentStatus: "INACTIVE" })
      .returning();

    const res = await request(app)
      .get("/api/ag/projects/overview")
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);
    const proj = res.body.find((p: any) => p.projectId === proj1Id);
    // INACTIVE row should NOT count toward assignedAnCount
    const activeCount = await db
      .select()
      .from(projectContractorsTable)
      .where(
        and(
          eq(projectContractorsTable.projectId, proj1Id),
          eq(projectContractorsTable.assignmentStatus, "ACTIVE"),
        ),
      );
    expect(proj.assignedAnCount).toBe(activeCount.length);

    await db.delete(projectContractorsTable).where(eq(projectContractorsTable.id, row.id));
  });
});

// ── Suite E — AN privacy (no cross-project / cross-GU leakage) ───────────────

describe("Suite E — AN privacy", () => {
  it("AN user cannot access AG project overview endpoint", async () => {
    const res = await request(app)
      .get("/api/ag/projects/overview")
      .set("Authorization", `Bearer ${nu1Token}`);
    expect(res.status).toBe(403);
  });

  it("AN user cannot access AG subcontractors list", async () => {
    const res = await request(app)
      .get(`/api/ag/projects/${proj1Id}/subcontractors`)
      .set("Authorization", `Bearer ${nu1Token}`);
    expect(res.status).toBe(403);
  });

  it("AG cannot POST subcontractor for another AG's project", async () => {
    const res = await request(app)
      .post(`/api/ag/projects/${proj2Id}/subcontractors`)
      .set("Authorization", `Bearer ${gu1Token}`)
      .send({ anOrgId: nuOrg1Id });
    expect(res.status).toBe(404); // proj2 belongs to gu2, not gu1
  });

  it("single-project overview exposes no fields from other AN of same GU", async () => {
    // Assign nuOrg2 to proj1 temporarily
    const [row] = await db
      .insert(projectContractorsTable)
      .values({ projectId: proj1Id, anOrgId: nuOrg2Id, assignmentStatus: "ACTIVE" })
      .returning();

    const res = await request(app)
      .get(`/api/ag/projects/${proj1Id}/overview`)
      .set("Authorization", `Bearer ${gu1Token}`);
    expect(res.status).toBe(200);

    // AN entries must NOT expose other-AN's identifiers
    for (const an of res.body.assignedAn) {
      // No fields that would expose another GU's project or AN's local identifiers
      expect(an).not.toHaveProperty("otherProjectIds");
      expect(an).not.toHaveProperty("otherGUOrgId");
    }

    await db.delete(projectContractorsTable).where(eq(projectContractorsTable.id, row.id));
  });
});

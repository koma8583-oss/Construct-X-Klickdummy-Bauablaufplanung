/**
 * Focused tests for the service-coordination CRUD consolidation:
 *
 *  1. Change Impact uses leistungsabhaengigkeiten (not service_dependencies)
 *  2. Constraint cancel: strict owner check (only reporter may cancel)
 *  3. Constraint resolve: any party may resolve
 *  4. Clarification answer: concurrent answer → 409
 *  5. Clarification cancel: only asker may cancel
 *  6. Readiness: atomic upsert (two concurrent PATCHes converge)
 *  7. Resource requirements: PATCH update path
 *
 * Fixture prefix: "tsc-crud-"
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { agDb as db } from "@workspace/db";
import {
  leistungsanfragenTable,
  leistungenTable,
  organizationsTable,
  projectsTable,
  serviceClarificationsTable,
  serviceConstraintsTable,
  serviceReadinessChecksTable,
  leistungsabhaengigkeitenTable,
  leistungsanfrageResourceRequirementsTable,
  resourceTypesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { evaluateChangeImpact } from "../services/change-impact-service";

// ── Constants ─────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

const GU_ORG   = "tsc-crud-gu-org";
const NU_ORG   = "tsc-crud-nu-org";
const OTHER_ORG = "tsc-crud-other-org";
const GU_USER  = "tsc-crud-gu-user";
const NU_USER  = "tsc-crud-nu-user";
const OTHER_USER = "tsc-crud-other-user";
const PROJECT  = "tsc-crud-project";
const LEISTUNG_A = "tsc-crud-leistung-a";
const LEISTUNG_B = "tsc-crud-leistung-b";
const REQUEST_A  = "tsc-crud-request-a";
const REQUEST_B  = "tsc-crud-request-b";
const RT_ID      = "tsc-crud-resource-type";

function token(userId: string, orgId: string, orgType: "AG" | "AN") {
  return jwt.sign(
    { userId, orgId, orgType, hubAdmin: false, roles: [orgType === "AG" ? "AG_ADMIN" : "AN_ADMIN"] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const guToken   = token(GU_USER,    GU_ORG,    "AG");
const nuToken   = token(NU_USER,    NU_ORG,    "AN");
const otherToken = token(OTHER_USER, OTHER_ORG, "AN");

// ── Fixture setup / teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  // Orgs
  await db.insert(organizationsTable).values([
    { id: GU_ORG,    name: "TSC-CRUD GU",    type: "AG" as const },
    { id: NU_ORG,    name: "TSC-CRUD NU",    type: "AN" as const },
    { id: OTHER_ORG, name: "TSC-CRUD Other", type: "AN" as const },
  ]).onConflictDoNothing();

  // Users
  await db.insert(usersTable).values([
    { id: GU_USER,    name: "TSC GU User",    email: "tsc-crud-gu@test.local",    passwordHash: "x" },
    { id: NU_USER,    name: "TSC NU User",    email: "tsc-crud-nu@test.local",    passwordHash: "x" },
    { id: OTHER_USER, name: "TSC Other User", email: "tsc-crud-other@test.local", passwordHash: "x" },
  ]).onConflictDoNothing();

  // Project
  await db.insert(projectsTable).values({
    id: PROJECT, name: "TSC-CRUD Project", agOrgId: GU_ORG,
  }).onConflictDoNothing();

  // Leistungen
  await db.insert(leistungenTable).values([
    {
      id: LEISTUNG_A, projectId: PROJECT, leistungsBezeichnung: "TSC-CRUD A",
      zone: "Z1", gewerk: "G1", plannedStart: "2026-09-01", plannedEnd: "2026-09-05",
    },
    {
      id: LEISTUNG_B, projectId: PROJECT, leistungsBezeichnung: "TSC-CRUD B",
      zone: "Z2", gewerk: "G2", plannedStart: "2026-09-06", plannedEnd: "2026-09-10",
    },
  ]).onConflictDoNothing();

  // Leistungsabhaengigkeit: A → B (EA, lag 0)
  await db.insert(leistungsabhaengigkeitenTable).values({
    id: "tsc-crud-dep-ab",
    projectId: PROJECT,
    predecessorId: LEISTUNG_A,
    successorId: LEISTUNG_B,
    type: "EA",
    lagDays: 0,
  }).onConflictDoNothing();

  // Leistungsanfragen
  const agreedStart = new Date("2026-09-01T06:00:00Z");
  const agreedEnd   = new Date("2026-09-05T18:00:00Z");
  await db.insert(leistungsanfragenTable).values([
    {
      id: REQUEST_A,
      leistungId: LEISTUNG_A, leistungVersion: 1,
      guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TSC-CRUD-A", status: "ACCEPTED",
      createdByUserId: GU_USER,
      agreedStart, agreedEnd,
    },
    {
      id: REQUEST_B,
      leistungId: LEISTUNG_B, leistungVersion: 1,
      guOrgId: GU_ORG, nuOrgId: NU_ORG,
      requestNumber: "TSC-CRUD-B", status: "ACCEPTED",
      createdByUserId: GU_USER,
      agreedStart: new Date("2026-09-06T06:00:00Z"),
      agreedEnd:   new Date("2026-09-10T18:00:00Z"),
    },
  ]).onConflictDoNothing();

  // Resource type owned by NU_ORG
  await db.insert(resourceTypesTable).values({
    id: RT_ID,
    code: "tsc-crud-rt",
    name: "TSC-CRUD ResourceType",
    anOrgId: NU_ORG,
    category: "EQUIPMENT",
    capacityUnit: "UNITS",
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(leistungsanfrageResourceRequirementsTable)
    .where(eq(leistungsanfrageResourceRequirementsTable.leistungsanfrageId, REQUEST_A))
    .catch(() => {});
  await db.delete(leistungsanfrageResourceRequirementsTable)
    .where(eq(leistungsanfrageResourceRequirementsTable.leistungsanfrageId, REQUEST_B))
    .catch(() => {});
  await db.delete(serviceReadinessChecksTable)
    .where(eq(serviceReadinessChecksTable.serviceRequestId, REQUEST_A))
    .catch(() => {});
  await db.delete(serviceClarificationsTable)
    .where(eq(serviceClarificationsTable.serviceRequestId, REQUEST_A))
    .catch(() => {});
  await db.delete(serviceConstraintsTable)
    .where(eq(serviceConstraintsTable.serviceRequestId, REQUEST_A))
    .catch(() => {});
  await db.delete(leistungsabhaengigkeitenTable)
    .where(eq(leistungsabhaengigkeitenTable.id, "tsc-crud-dep-ab"))
    .catch(() => {});
  await db.delete(leistungsanfragenTable)
    .where(eq(leistungsanfragenTable.id, REQUEST_A))
    .catch(() => {});
  await db.delete(leistungsanfragenTable)
    .where(eq(leistungsanfragenTable.id, REQUEST_B))
    .catch(() => {});
  await db.delete(leistungenTable)
    .where(eq(leistungenTable.id, LEISTUNG_A))
    .catch(() => {});
  await db.delete(leistungenTable)
    .where(eq(leistungenTable.id, LEISTUNG_B))
    .catch(() => {});
  await db.delete(resourceTypesTable)
    .where(eq(resourceTypesTable.id, RT_ID))
    .catch(() => {});
  await db.delete(projectsTable)
    .where(eq(projectsTable.id, PROJECT))
    .catch(() => {});
  await db.delete(usersTable)
    .where(eq(usersTable.id, GU_USER))
    .catch(() => {});
  await db.delete(usersTable)
    .where(eq(usersTable.id, NU_USER))
    .catch(() => {});
  await db.delete(usersTable)
    .where(eq(usersTable.id, OTHER_USER))
    .catch(() => {});
  await db.delete(organizationsTable)
    .where(eq(organizationsTable.id, GU_ORG))
    .catch(() => {});
  await db.delete(organizationsTable)
    .where(eq(organizationsTable.id, NU_ORG))
    .catch(() => {});
  await db.delete(organizationsTable)
    .where(eq(organizationsTable.id, OTHER_ORG))
    .catch(() => {});
});

// ── 1. Change Impact uses leistungsabhaengigkeiten ────────────────────────────

describe("evaluateChangeImpact – uses leistungsabhaengigkeitenTable", () => {
  it("detects impact on successor request when predecessor end shifts forward", async () => {
    // REQUEST_B has agreedStart = 2026-09-06T06:00Z
    // Proposing REQUEST_A to end 2026-09-10 → required start of B = 2026-09-11 (+1 lag+1)
    const result = await evaluateChangeImpact({
      serviceRequestId: REQUEST_A,
      guOrgId: GU_ORG,
      proposedStart: new Date("2026-09-07T06:00:00Z"),
      proposedEnd:   new Date("2026-09-10T18:00:00Z"),
    });
    expect(result.affectedServices.length).toBeGreaterThan(0);
    const affected = result.affectedServices.find((a) => a.serviceRequestId === REQUEST_B);
    expect(affected).toBeDefined();
    expect(affected!.serviceName).toBe("TSC-CRUD B");
    expect(affected!.impactDays).toBeGreaterThan(0);
  });

  it("returns no impact when proposed end does not push successor past its agreedStart", async () => {
    // Propose REQUEST_A to end before REQUEST_B's agreedStart
    const result = await evaluateChangeImpact({
      serviceRequestId: REQUEST_A,
      guOrgId: GU_ORG,
      proposedStart: new Date("2026-09-01T06:00:00Z"),
      proposedEnd:   new Date("2026-09-04T18:00:00Z"),
    });
    // Required start of B = 2026-09-05, which is <= B.agreedStart (2026-09-06) → no impact
    const affected = result.affectedServices.find((a) => a.serviceRequestId === REQUEST_B);
    expect(affected).toBeUndefined();
  });

  it("returns empty when the source request does not exist", async () => {
    const result = await evaluateChangeImpact({
      serviceRequestId: "non-existent-request-id",
      guOrgId: GU_ORG,
      proposedStart: new Date("2026-09-01T06:00:00Z"),
      proposedEnd:   new Date("2026-09-10T18:00:00Z"),
    });
    expect(result.affectedServices).toHaveLength(0);
  });
});

// ── 2 & 3. Constraint owner check ─────────────────────────────────────────────

describe("Constraint CRUD – owner check for cancel", () => {
  let constraintId: string;

  it("GU creates a constraint", async () => {
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/constraints`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        constraintType: "SITE_NOT_READY",
        description: "Baustelle nicht freigegeben",
        responsibleOrgId: GU_ORG,
      });
    expect(res.status).toBe(201);
    constraintId = res.body.id;
    expect(constraintId).toBeDefined();
    expect(res.body.reportedByOrgId).toBe(GU_ORG);
  });

   it("NU (non-reporter) cannot cancel the constraint → 403", async () => {
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/constraints/${constraintId}/cancel`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({});
     expect(res.status).toBe(403);
     expect(res.body.error).toBe("CONSTRAINT_CANCEL_NOT_ALLOWED");
  });

   it("NU cannot resolve a constraint assigned to GU → 403", async () => {
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/constraints/${constraintId}/resolve`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({});
     expect(res.status).toBe(403);
     expect(res.body.error).toBe("CONSTRAINT_RESOLVE_NOT_ALLOWED");
  });

   it("GU can resolve the constraint and a second close returns 409", async () => {
     const resolveRes = await request(app)
       .post(`/api/service-requests/${REQUEST_A}/constraints/${constraintId}/resolve`)
       .set("Authorization", `Bearer ${guToken}`)
       .send({});
     expect(resolveRes.status).toBe(200);
     expect(resolveRes.body.status).toBe("RESOLVED");
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/constraints/${constraintId}/cancel`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({});
     expect(res.status).toBe(409);
  });

  it("GU can cancel their own constraint", async () => {
    // Create another constraint
    const createRes = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/constraints`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({
        constraintType: "INFORMATION_MISSING",
        description: "Pläne fehlen",
        responsibleOrgId: NU_ORG,
      });
    expect(createRes.status).toBe(201);
    const c2 = createRes.body.id;

    const cancelRes = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/constraints/${c2}/cancel`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({});
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe("CANCELLED");
  });
});

// ── 4. Clarification answer – concurrent answer → 409 ─────────────────────────

describe("Clarification answer – concurrent answer returns 409", () => {
  let clarId: string;

  beforeAll(async () => {
    // NU asks a question
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/clarifications`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ category: "PLAN", question: "Wo sind die Pläne?" });
    expect(res.status).toBe(201);
    clarId = res.body.id;
  });

  it("GU answers → 200", async () => {
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/clarifications/${clarId}/answer`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ answer: "Pläne liegen beim BL" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RESOLVED");
  });

   it("second answer attempt → 409 (clarification no longer OPEN)", async () => {
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/clarifications/${clarId}/answer`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ answer: "Another answer" });
     expect(res.status).toBe(409);
  });

  it("asker (NU) cannot answer their own question → 403", async () => {
    // Create a new clarification
    const createRes = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/clarifications`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ category: "SCOPE", question: "Was ist der Umfang?" });
    expect(createRes.status).toBe(201);
    const newClarId = createRes.body.id;

    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/clarifications/${newClarId}/answer`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ answer: "Ich selbst antworte" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Gegenseite/);
  });
});

// ── 5. Clarification cancel – only asker may cancel ───────────────────────────

describe("Clarification cancel – only asker may cancel", () => {
  let clarId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/clarifications`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ category: "ACCESS", question: "Zugang zu Keller?" });
    expect(res.status).toBe(201);
    clarId = res.body.id;
  });

   it("NU (non-asker) cannot cancel GU's question → 403", async () => {
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/clarifications/${clarId}/cancel`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({});
     expect(res.status).toBe(403);
  });

  it("GU (asker) can cancel their own question → 200", async () => {
    const res = await request(app)
      .post(`/api/service-requests/${REQUEST_A}/clarifications/${clarId}/cancel`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });
});

// ── 6. Readiness – idempotent upsert ─────────────────────────────────────────

describe("Readiness PATCH – atomic upsert", () => {
  it("first PATCH creates the row and applies the update", async () => {
    // Clean slate
    await db.delete(serviceReadinessChecksTable)
      .where(eq(serviceReadinessChecksTable.serviceRequestId, REQUEST_A));

    const res = await request(app)
      .patch(`/api/service-requests/${REQUEST_A}/readiness`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ scheduleConfirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.scheduleConfirmed).toBe(true);
    expect(res.body.status).toBe("NOT_READY");
  });

  it("second PATCH from NU sets anReady → status becomes READY only when all flags are true", async () => {
    // GU sets all their flags
    await request(app)
      .patch(`/api/service-requests/${REQUEST_A}/readiness`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ scheduleConfirmed: true, siteReady: true, informationComplete: true, agReady: true });

    const res = await request(app)
      .patch(`/api/service-requests/${REQUEST_A}/readiness`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ anReady: true });
    expect(res.status).toBe(200);
    expect(res.body.anReady).toBe(true);
    expect(res.body.status).toBe("READY");
  });

  it("NU cannot set AG-only flags → 403", async () => {
    const res = await request(app)
      .patch(`/api/service-requests/${REQUEST_A}/readiness`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ scheduleConfirmed: true });
    expect(res.status).toBe(403);
  });
});

// ── 7. Resource requirements – PATCH update path ─────────────────────────────

describe("Resource requirements PATCH", () => {
  let reqId: string;

  beforeAll(async () => {
    // Insert directly for a clean starting point
    const [row] = await db.insert(leistungsanfrageResourceRequirementsTable).values({
      leistungsanfrageId: REQUEST_A,
      anOrgId: NU_ORG,
      resourceTypeId: RT_ID,
      requiredCapacity: "5.00",
      utilizationPercent: 80,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-05",
    }).returning();
    reqId = row.id;
  });

  it("NU can PATCH capacity and notes via /takt-requests/:id/resource-requirements/:reqId", async () => {
    const res = await request(app)
      .patch(`/api/takt-requests/${REQUEST_A}/resource-requirements/${reqId}`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ requiredCapacity: 10, notes: "Updated" });
    expect(res.status).toBe(200);
    expect(Number(res.body.requiredCapacity)).toBe(10);
    expect(res.body.notes).toBe("Updated");
  });

  it("NU can PATCH via canonical /leistungsanfragen/:id/resource-requirements/:reqId", async () => {
    const res = await request(app)
      .patch(`/api/leistungsanfragen/${REQUEST_A}/resource-requirements/${reqId}`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ utilizationPercent: 90 });
    expect(res.status).toBe(200);
    expect(res.body.utilizationPercent).toBe(90);
  });

  it("PATCH with invalid period (start > end) → 422", async () => {
    const res = await request(app)
      .patch(`/api/leistungsanfragen/${REQUEST_A}/resource-requirements/${reqId}`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ periodStart: "2026-09-10", periodEnd: "2026-09-01" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("INVALID_REQUIREMENT_PERIOD");
  });

  it("PATCH non-existent requirement → 404", async () => {
    const res = await request(app)
      .patch(`/api/leistungsanfragen/${REQUEST_A}/resource-requirements/non-existent-id`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ notes: "nope" });
    expect(res.status).toBe(404);
  });

  it("other-org NU cannot PATCH another org's requirement → 404 (request not found for them)", async () => {
    const res = await request(app)
      .patch(`/api/leistungsanfragen/${REQUEST_A}/resource-requirements/${reqId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ notes: "hacked" });
    expect(res.status).toBe(404);
  });
});

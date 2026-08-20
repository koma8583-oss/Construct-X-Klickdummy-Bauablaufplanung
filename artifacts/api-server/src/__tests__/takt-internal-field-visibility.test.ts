/**
 * Task #77 — GU-internal Takt field visibility regression tests.
 *
 * Verifies that:
 *  1. The four GU-internal columns (internalNote, costEstimate,
 *     procurementPriority, riskClassification) are visible to the owning AG.
 *  2. AN callers are blocked entirely (403) from Takt CRUD.
 *  3. A different AG organisation cannot access or mutate another AG's Takte
 *     (cross-tenant isolation — returns 404 to avoid leaking existence).
 *  4. Write operations (POST/PATCH/DELETE) are also AG-owner-only.
 *
 * Fixture prefix: "t77-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import {
  organizationsTable,
  projectsTable,
  takteTable,
  usersTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app";

// ── JWT helper ────────────────────────────────────────────────────────────────

const DEV_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

function signToken(payload: {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin?: boolean;
}): string {
  return jwt.sign(
    { ...payload, hubAdmin: payload.hubAdmin ?? false },
    DEV_SECRET,
    { expiresIn: "1h" },
  );
}

// ── Fixture IDs ───────────────────────────────────────────────────────────────

const GU_ORG      = "t77-org-gu";
const OTHER_GU    = "t77-org-other-gu";
const NU_ORG      = "t77-org-nu";
const PROJECT     = "t77-project-001";
const OTHER_PROJ  = "t77-project-002"; // owned by OTHER_GU
const TAKT_ID     = "t77-takt-001";
const GU_USER     = "t77-user-gu";
const OTHER_USER  = "t77-user-other-gu";
const NU_USER     = "t77-user-nu";

let guToken: string;
let otherGuToken: string;
let nuToken: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG,   name: "T77 GU Org",       type: "AG" },
    { id: OTHER_GU, name: "T77 Other GU Org",  type: "AG" },
    { id: NU_ORG,   name: "T77 NU Org",        type: "AN" },
  ]).onConflictDoNothing();

  await db.insert(usersTable).values([
    { id: GU_USER,   name: "T77 GU User",       email: "t77-gu@example.com",    passwordHash: "x" },
    { id: OTHER_USER,name: "T77 Other GU User",  email: "t77-other@example.com", passwordHash: "x" },
    { id: NU_USER,   name: "T77 NU User",        email: "t77-nu@example.com",    passwordHash: "x" },
  ]).onConflictDoNothing();

  await db.insert(projectsTable).values([
    { id: PROJECT,    agOrgId: GU_ORG,   name: "T77 Test Project"   },
    { id: OTHER_PROJ, agOrgId: OTHER_GU, name: "T77 Other Project"  },
  ]).onConflictDoNothing();

  await db.insert(takteTable).values({
    id:               TAKT_ID,
    projectId:        PROJECT,
    taktBezeichnung:  "T77-1",
    zone:             "EG",
    gewerk:           "Trockenbau",
    plannedStart:     "2026-09-01",
    plannedEnd:       "2026-09-15",
    // ── GU-internal fields ──
    internalNote:         "Vertrauliche Notiz",
    costEstimate:         "42.000 €",
    procurementPriority:  "HIGH",
    riskClassification:   "A",
  }).onConflictDoNothing();

  guToken      = signToken({ userId: GU_USER,    orgId: GU_ORG,   orgType: "AG" });
  otherGuToken = signToken({ userId: OTHER_USER,  orgId: OTHER_GU, orgType: "AG" });
  nuToken      = signToken({ userId: NU_USER,     orgId: NU_ORG,   orgType: "AN" });
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM leistungen     WHERE id        = 't77-takt-001'`).catch(() => {});
  await db.execute(sql`DELETE FROM projects      WHERE id IN ('t77-project-001','t77-project-002')`).catch(() => {});
  await db.execute(sql`DELETE FROM users         WHERE id IN ('t77-user-gu','t77-user-other-gu','t77-user-nu')`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id IN ('t77-org-gu','t77-org-other-gu','t77-org-nu')`).catch(() => {});
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Takt internal field visibility — GET /api/projects/:id/takte", () => {
  it("owning AG receives internal fields in the list response", async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT}/takte`)
      .set("Authorization", `Bearer ${guToken}`)
      .expect(200);

    const takt = (res.body as any[]).find((t: any) => t.id === TAKT_ID);
    expect(takt).toBeDefined();
    expect(takt.internalNote).toBe("Vertrauliche Notiz");
    expect(takt.costEstimate).toBe("42.000 €");
    expect(takt.procurementPriority).toBe("HIGH");
    expect(takt.riskClassification).toBe("A");
  });

  it("AN caller is blocked from the Takt list (403)", async () => {
    await request(app)
      .get(`/api/projects/${PROJECT}/takte`)
      .set("Authorization", `Bearer ${nuToken}`)
      .expect(403);
  });

  it("different AG cannot list another AG's Takte (404)", async () => {
    await request(app)
      .get(`/api/projects/${PROJECT}/takte`)
      .set("Authorization", `Bearer ${otherGuToken}`)
      .expect(404);
  });
});

describe("Takt internal field visibility — GET /api/projects/:id/takte/:taktId", () => {
  it("owning AG receives internal fields in the single-takt response", async () => {
    const res = await request(app)
      .get(`/api/projects/${PROJECT}/takte/${TAKT_ID}`)
      .set("Authorization", `Bearer ${guToken}`)
      .expect(200);

    expect(res.body.internalNote).toBe("Vertrauliche Notiz");
    expect(res.body.costEstimate).toBe("42.000 €");
    expect(res.body.procurementPriority).toBe("HIGH");
    expect(res.body.riskClassification).toBe("A");
  });

  it("AN caller is blocked from single Takt detail (403)", async () => {
    await request(app)
      .get(`/api/projects/${PROJECT}/takte/${TAKT_ID}`)
      .set("Authorization", `Bearer ${nuToken}`)
      .expect(403);
  });

  it("different AG cannot read another AG's Takt detail (404)", async () => {
    await request(app)
      .get(`/api/projects/${PROJECT}/takte/${TAKT_ID}`)
      .set("Authorization", `Bearer ${otherGuToken}`)
      .expect(404);
  });
});

describe("Takt write operations — owning AG only", () => {
  const newTaktBody = {
    taktBezeichnung: "T77-X",
    zone: "OG",
    gewerk: "Elektro",
    plannedStart: "2026-10-01",
    plannedEnd: "2026-10-10",
  };

  it("AN caller cannot create a Takt (403)", async () => {
    await request(app)
      .post(`/api/projects/${PROJECT}/takte`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send(newTaktBody)
      .expect(403);
  });

  it("different AG cannot create a Takt in another AG's project (404)", async () => {
    await request(app)
      .post(`/api/projects/${PROJECT}/takte`)
      .set("Authorization", `Bearer ${otherGuToken}`)
      .send(newTaktBody)
      .expect(404);
  });

  it("AN caller cannot patch a Takt (403)", async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT}/takte/${TAKT_ID}`)
      .set("Authorization", `Bearer ${nuToken}`)
      .send({ description: "hacked" })
      .expect(403);
  });

  it("different AG cannot patch another AG's Takt (404)", async () => {
    await request(app)
      .patch(`/api/projects/${PROJECT}/takte/${TAKT_ID}`)
      .set("Authorization", `Bearer ${otherGuToken}`)
      .send({ description: "hacked" })
      .expect(404);
  });

  it("AN caller cannot delete a Takt (403)", async () => {
    await request(app)
      .delete(`/api/projects/${PROJECT}/takte/${TAKT_ID}`)
      .set("Authorization", `Bearer ${nuToken}`)
      .expect(403);
  });

  it("different AG cannot delete another AG's Takt (404)", async () => {
    await request(app)
      .delete(`/api/projects/${PROJECT}/takte/${TAKT_ID}`)
      .set("Authorization", `Bearer ${otherGuToken}`)
      .expect(404);
  });

  it("owning AG can still POST/PATCH their own project (201/200)", async () => {
    // POST creates successfully
    const res = await request(app)
      .post(`/api/projects/${PROJECT}/takte`)
      .set("Authorization", `Bearer ${guToken}`)
      .send(newTaktBody)
      .expect(201);

    const createdId = res.body.id;
    expect(createdId).toBeDefined();

    // PATCH the freshly-created takt
    await request(app)
      .patch(`/api/projects/${PROJECT}/takte/${createdId}`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ description: "Aktualisiert" })
      .expect(200);

    // DELETE it to clean up
    await request(app)
      .delete(`/api/projects/${PROJECT}/takte/${createdId}`)
      .set("Authorization", `Bearer ${guToken}`)
      .expect(204);
  });
});

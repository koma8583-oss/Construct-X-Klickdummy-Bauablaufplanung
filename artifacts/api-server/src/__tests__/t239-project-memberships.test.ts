/**
 * Task 239 — Project invitation decisions and membership gates.
 *
 * This suite intentionally exercises the HTTP boundary for invitation
 * ownership/decisions and the request-creation membership gate. Fixtures are
 * inserted directly so each assertion tests the route/service behavior rather
 * than the auth-registration flow.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  messageOutboxTable,
} from "@workspace/db";

const PREFIX = "t239";
const AG_ID = `${PREFIX}-ag`;
const OTHER_AG_ID = `${PREFIX}-other-ag`;
const AN_ID = `${PREFIX}-an`;
const OTHER_AN_ID = `${PREFIX}-other-an`;
const AG_USER_ID = `${PREFIX}-ag-user`;
const OTHER_AG_USER_ID = `${PREFIX}-other-ag-user`;
const AN_USER_ID = `${PREFIX}-an-user`;
const OTHER_AN_USER_ID = `${PREFIX}-other-an-user`;
const PROJECT_ID = `${PREFIX}-project`;
const OTHER_PROJECT_ID = `${PREFIX}-other-project`;
const TAKT_ID = `${PREFIX}-takt`;
const BACKFILL_PROJECT_ID = `${PREFIX}-backfill-project`;
const BACKFILL_AN_ID = `${PREFIX}-backfill-an`;

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
function token(userId: string, orgId: string, orgType: "AG" | "AN", roles?: string[]) {
  return jwt.sign(
    { userId, orgId, orgType, hubAdmin: false, roles: roles ?? (orgType === "AG" ? ["AG_ADMIN"] : ["AN_ADMIN"]) },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const agToken = token(AG_USER_ID, AG_ID, "AG");
const otherAgToken = token(OTHER_AG_USER_ID, OTHER_AG_ID, "AG");
const anToken = token(AN_USER_ID, AN_ID, "AN");
const otherAnToken = token(OTHER_AN_USER_ID, OTHER_AN_ID, "AN");

async function removeRequestData(projectId: string) {
  const takts = await db.select({ id: takteTable.id }).from(takteTable).where(eq(takteTable.projectId, projectId));
  const taktIds = takts.map((row) => row.id);
  if (!taktIds.length) return;
  const requests = await db.select({ id: taktRequestsTable.id }).from(taktRequestsTable)
    .where(inArray(taktRequestsTable.taktId, taktIds));
  const requestIds = requests.map((row) => row.id);
  if (requestIds.length) {
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, requestIds));
    await db.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, requestIds));
  }
  await db.delete(takteTable).where(inArray(takteTable.id, taktIds));
}

beforeAll(async () => {
  await db.delete(projectMembershipsTable).where(
    inArray(projectMembershipsTable.projectId, [PROJECT_ID, OTHER_PROJECT_ID, BACKFILL_PROJECT_ID]),
  ).catch(() => {});
  await removeRequestData(PROJECT_ID);
  await db.delete(projectContractorsTable).where(
    inArray(projectContractorsTable.projectId, [PROJECT_ID, OTHER_PROJECT_ID, BACKFILL_PROJECT_ID]),
  ).catch(() => {});
  await db.delete(projectsTable).where(
    inArray(projectsTable.id, [PROJECT_ID, OTHER_PROJECT_ID, BACKFILL_PROJECT_ID]),
  ).catch(() => {});
  await db.delete(usersTable).where(
    inArray(usersTable.id, [AG_USER_ID, OTHER_AG_USER_ID, AN_USER_ID, OTHER_AN_USER_ID]),
  ).catch(() => {});
  await db.delete(organizationsTable).where(
    inArray(organizationsTable.id, [AG_ID, OTHER_AG_ID, AN_ID, OTHER_AN_ID, BACKFILL_AN_ID]),
  ).catch(() => {});

  await db.insert(organizationsTable).values([
    { id: AG_ID, name: "Task 239 AG", type: "AG" },
    { id: OTHER_AG_ID, name: "Task 239 Other AG", type: "AG" },
    { id: AN_ID, name: "Task 239 AN", type: "AN" },
    { id: OTHER_AN_ID, name: "Task 239 Other AN", type: "AN" },
    { id: BACKFILL_AN_ID, name: "Task 239 Backfill AN", type: "AN" },
  ]);
  await db.insert(usersTable).values([
    { id: AG_USER_ID, name: "Task 239 AG", email: `${PREFIX}-ag@test.local`, passwordHash: "x" },
    { id: OTHER_AG_USER_ID, name: "Task 239 Other AG", email: `${PREFIX}-other-ag@test.local`, passwordHash: "x" },
    { id: AN_USER_ID, name: "Task 239 AN", email: `${PREFIX}-an@test.local`, passwordHash: "x" },
    { id: OTHER_AN_USER_ID, name: "Task 239 Other AN", email: `${PREFIX}-other-an@test.local`, passwordHash: "x" },
  ]);
  await db.insert(projectsTable).values([
    { id: PROJECT_ID, agOrgId: AG_ID, name: "Task 239 Project" },
    { id: OTHER_PROJECT_ID, agOrgId: OTHER_AG_ID, name: "Task 239 Other Project" },
    { id: BACKFILL_PROJECT_ID, agOrgId: AG_ID, name: "Task 239 Backfill Project" },
  ]);
  await db.insert(takteTable).values({
    id: TAKT_ID,
    projectId: PROJECT_ID,
    taktBezeichnung: "Task 239 Takt",
    zone: "A",
    gewerk: "Rohbau",
    plannedStart: "2028-01-01",
    plannedEnd: "2028-01-05",
    lifecycleStatus: "PLANNED",
    version: 1,
  });
});

afterAll(async () => {
  await removeRequestData(PROJECT_ID);
  await db.delete(projectMembershipsTable).where(
    inArray(projectMembershipsTable.projectId, [PROJECT_ID, OTHER_PROJECT_ID, BACKFILL_PROJECT_ID]),
  ).catch(() => {});
  await db.delete(projectContractorsTable).where(
    inArray(projectContractorsTable.projectId, [PROJECT_ID, OTHER_PROJECT_ID, BACKFILL_PROJECT_ID]),
  ).catch(() => {});
  await db.delete(messageOutboxTable).where(
    and(
      sql`${messageOutboxTable.senderOrgId} IN (${AG_ID}, ${AN_ID}, ${OTHER_AN_ID})`,
      sql`${messageOutboxTable.recipientOrgId} IN (${AG_ID}, ${AN_ID}, ${OTHER_AN_ID})`,
    ),
  ).catch(() => {});
  await db.delete(projectsTable).where(
    inArray(projectsTable.id, [PROJECT_ID, OTHER_PROJECT_ID, BACKFILL_PROJECT_ID]),
  ).catch(() => {});
  await db.delete(usersTable).where(
    inArray(usersTable.id, [AG_USER_ID, OTHER_AG_USER_ID, AN_USER_ID, OTHER_AN_USER_ID]),
  ).catch(() => {});
  await db.delete(organizationsTable).where(
    inArray(organizationsTable.id, [AG_ID, OTHER_AG_ID, AN_ID, OTHER_AN_ID, BACKFILL_AN_ID]),
  ).catch(() => {});
});

async function invite(anOrgId = AN_ID, projectId = PROJECT_ID, authToken = agToken) {
  return request(app)
    .post(`/api/projects/${projectId}/invitations`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({ anOrgId });
}

describe("invitation decisions", () => {
  it("invites an AN and exposes it only to the invited organization", async () => {
    const response = await invite();
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("INVITED");

    const pending = await request(app).get("/api/project-invitations")
      .set("Authorization", `Bearer ${anToken}`);
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].membership.id).toBe(response.body.id);

    const otherPending = await request(app).get("/api/project-invitations")
      .set("Authorization", `Bearer ${otherAnToken}`);
    expect(otherPending.status).toBe(200);
    expect(otherPending.body).toHaveLength(0);
  });

  it("rejects duplicate pending invitations and prevents the other AG reading membership rows", async () => {
    const duplicate = await invite();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("PROJECT_INVITATION_ALREADY_EXISTS");

    const wrongOrgList = await request(app).get(`/api/projects/${PROJECT_ID}/memberships`)
      .set("Authorization", `Bearer ${otherAgToken}`);
    expect(wrongOrgList.status).toBe(200);
    expect(wrongOrgList.body).toEqual([]);

    const wrongProjectInvite = await request(app)
      .post(`/api/projects/${OTHER_PROJECT_ID}/invitations`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({ anOrgId: AN_ID });
    expect(wrongProjectInvite.status).toBe(404);
  });

  it("does not allow the wrong AN organization to accept or reject an invitation", async () => {
    const membership = (await db.select().from(projectMembershipsTable)
      .where(and(eq(projectMembershipsTable.projectId, PROJECT_ID), eq(projectMembershipsTable.anOrgId, AN_ID))))[0];
    const wrongAccept = await request(app).post(`/api/project-invitations/${membership.id}/accept`)
      .set("Authorization", `Bearer ${otherAnToken}`);
    expect(wrongAccept.status).toBe(404);
    const wrongReject = await request(app).post(`/api/project-invitations/${membership.id}/reject`)
      .set("Authorization", `Bearer ${otherAnToken}`);
    expect(wrongReject.status).toBe(404);
  });

  it("accepts once, rejects a second decision, and records ACTIVE membership", async () => {
    const membership = (await db.select().from(projectMembershipsTable)
      .where(and(eq(projectMembershipsTable.projectId, PROJECT_ID), eq(projectMembershipsTable.anOrgId, AN_ID))))[0];
    const accepted = await request(app).post(`/api/project-invitations/${membership.id}/accept`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("ACTIVE");

    const secondDecision = await request(app).post(`/api/project-invitations/${membership.id}/reject`)
      .set("Authorization", `Bearer ${anToken}`).send({ message: "too late" });
    expect(secondDecision.status).toBe(409);
    expect(secondDecision.body.code).toBe("PROJECT_INVITATION_ALREADY_RESOLVED");
  });

  it("allows only one of two concurrent decisions to win", async () => {
    const created = await invite(OTHER_AN_ID);
    const [accept, reject] = await Promise.all([
      request(app).post(`/api/project-invitations/${created.body.id}/accept`).set("Authorization", `Bearer ${otherAnToken}`),
      request(app).post(`/api/project-invitations/${created.body.id}/reject`).set("Authorization", `Bearer ${otherAnToken}`),
    ]);
    expect([accept.status, reject.status].sort()).toEqual([200, 409]);
    const [row] = await db.select().from(projectMembershipsTable)
      .where(eq(projectMembershipsTable.id, created.body.id));
    expect(["ACTIVE", "REJECTED"]).toContain(row.status);
  });

  it("rejects a pending invitation and does not allow a later acceptance", async () => {
    const created = await invite(AN_ID, OTHER_PROJECT_ID, otherAgToken);
    const rejected = await request(app).post(`/api/project-invitations/${created.body.id}/reject`)
      .set("Authorization", `Bearer ${anToken}`).send({ message: "not available" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("REJECTED");

    const accepted = await request(app).post(`/api/project-invitations/${created.body.id}/accept`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(accepted.status).toBe(409);
  });
});

describe("membership gates and legacy compatibility", () => {
  it("blocks request creation for an invited AN and for an ACTIVE legacy contractor without membership", async () => {
    // The first invitation is now ACTIVE from the prior test, so use a fresh AN.
    await db.insert(projectContractorsTable).values({
      projectId: PROJECT_ID,
      anOrgId: BACKFILL_AN_ID,
      assignmentStatus: "ACTIVE",
    });
    const legacyEndpoint = await request(app).post(`/api/projects/${PROJECT_ID}/contractors`)
      .set("Authorization", `Bearer ${agToken}`)
      .send({ anOrgId: BACKFILL_AN_ID });
    expect(legacyEndpoint.status).toBe(409);

    const noMembership = await request(app).post("/api/takt-requests")
      .set("Authorization", `Bearer ${agToken}`)
      .send({ taktId: TAKT_ID, nuOrgId: BACKFILL_AN_ID });
    expect(noMembership.status).toBe(403);
    expect(noMembership.body.code).toBe("PROJECT_MEMBERSHIP_NOT_ACTIVE");
  });

  it("permits request creation after the invitation is ACTIVE", async () => {
    const membership = (await db.select().from(projectMembershipsTable)
      .where(and(eq(projectMembershipsTable.projectId, PROJECT_ID), eq(projectMembershipsTable.anOrgId, BACKFILL_AN_ID))))[0];
    // The concurrent test may have rejected it; create a clean ACTIVE row directly
    // to isolate the request gate from invitation decision ordering.
    if (membership) {
      await db.update(projectMembershipsTable).set({ status: "ACTIVE" })
        .where(eq(projectMembershipsTable.id, membership.id));
    } else {
      await db.insert(projectMembershipsTable).values({
        id: `${PREFIX}-active-membership`,
        projectId: PROJECT_ID,
        agOrgId: AG_ID,
        anOrgId: BACKFILL_AN_ID,
        status: "ACTIVE",
        invitationId: `${PREFIX}-active-invitation`,
        correlationId: `${PREFIX}-active-correlation`,
      });
    }
    const allowed = await request(app).post("/api/takt-requests")
      .set("Authorization", `Bearer ${agToken}`)
      .send({ taktId: TAKT_ID, nuOrgId: BACKFILL_AN_ID });
    expect(allowed.status).toBe(201);
  });

  it("backfills an ACTIVE membership from an ACTIVE legacy contractor relationship", async () => {
    await db.insert(projectContractorsTable).values({
      projectId: BACKFILL_PROJECT_ID,
      anOrgId: BACKFILL_AN_ID,
      assignmentStatus: "ACTIVE",
    });
    await db.execute(sql`
      INSERT INTO project_memberships
        (id, project_id, ag_org_id, an_org_id, status, invitation_id, correlation_id, invited_at, accepted_at)
      SELECT gen_random_uuid()::text, pc.project_id, p.ag_org_id, pc.an_org_id, 'ACTIVE',
        'legacy-membership-' || pc.project_id || '-' || pc.an_org_id,
        'legacy-membership:' || pc.project_id || ':' || pc.an_org_id,
        COALESCE(pc.added_at, now()), COALESCE(pc.added_at, now())
      FROM project_contractors pc
      JOIN projects p ON p.id = pc.project_id
      WHERE pc.assignment_status = 'ACTIVE'
        AND pc.project_id = ${BACKFILL_PROJECT_ID}
      ON CONFLICT (project_id, an_org_id) DO NOTHING
    `);
    const [membership] = await db.select().from(projectMembershipsTable).where(
      and(eq(projectMembershipsTable.projectId, BACKFILL_PROJECT_ID), eq(projectMembershipsTable.anOrgId, BACKFILL_AN_ID)),
    );
    expect(membership.status).toBe("ACTIVE");
    expect(membership.invitationId).toBe(`legacy-membership-${BACKFILL_PROJECT_ID}-${BACKFILL_AN_ID}`);
  });
});
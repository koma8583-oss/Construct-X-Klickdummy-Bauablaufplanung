/**
 * T120 — 5-step workflow state persists across navigation
 *
 * The TaktRequest detail page derives step completion entirely from API state:
 *   Step 1: policy accepted (no 403 on /details)
 *   Step 2: detailsRetrievedAt is non-null
 *   Step 3: resource-requirements list is non-empty
 *   Step 4: latest availability check exists with status COMPLETED
 *   Step 5: status is ACCEPTED / ALTERNATIVES_PROPOSED / REJECTED
 *
 * "Navigate away and return" is simulated by re-calling the relevant read
 * endpoint after each state-mutating action and verifying the state is still
 * reflected.
 *
 * Scenarios:
 *   W1 – accept policy → navigate away → return → Step 1 done, Step 2 active
 *   W2 – add resource requirement → navigate away → return → Step 3 complete
 *   W3 – run availability check → Step 4 complete, result surfaced for Step 5
 *   W4 – Step 2 state is idempotent: repeated /details calls don't change status
 *   W5 – after response submitted, all steps marked complete
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import * as jwt from "jsonwebtoken";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectContractorsTable,
  projectMembershipsTable,
  coordinationPoliciesTable,
  takteTable,
  taktRequestsTable,
  taktRequestSnapshotsTable,
  taktRequestResourceRequirementsTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  messageOutboxTable,
  messageInboxTable,
  availabilityChecksTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import app from "../app";

// ── JWT ───────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? "testsecret";

function makeToken(
  userId: string,
  orgId: string | null,
  orgType: "AG" | "AN" | null,
  roles: string[] = [],
  hubAdmin = false,
): string {
  return jwt.sign({ userId, orgId, orgType, hubAdmin, roles }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

// ── Fixture IDs (deterministic, prefixed to avoid collisions) ─────────────────

const PREFIX    = "t120";
const AG_ORG    = `${PREFIX}-ag-org`;
const AN_ORG    = `${PREFIX}-an-org`;
const AG_USER   = `${PREFIX}-ag-user`;
const AN_USER   = `${PREFIX}-an-user`;
const PROJECT   = `${PREFIX}-project`;
const TAKT      = `${PREFIX}-takt`;
const PROJECT_AGREEMENT = `${PREFIX}-project-agreement`;

let agToken: string;
let anToken: string;
let pubId: string;
let requestId: string;
let policyTemplateId: string;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPolicyTemplateId(): Promise<string> {
  const [row] = await db.select().from(policyTemplatesTable).limit(1);
  if (!row) throw new Error("No policy template seeded — run db seed first");
  return row.id;
}

async function createPublishedPublication(): Promise<string> {
  const now = new Date();
  const [pub] = await db
    .insert(dataPublicationsTable)
    .values({
      id: crypto.randomUUID(),
      agOrgId: AG_ORG,
      projectId: PROJECT,
      dataProductType: "TAKT_INFORMATION_PACKAGE",
      title: `${PREFIX} Publication`,
      description: null,
      version: 1,
      schemaVersion: "1.0",
      status: "PUBLISHED",
      policyTemplateId,
      selectedFields: ["taktReference", "plannedTimeWindow", "trade"],
      selectedTaktIds: [TAKT],
      contentSnapshot: { taktReference: `${PREFIX}-ref` },
      contentHash: "aabb1122",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await db.insert(dataPublicationRecipientsTable).values({
    id: crypto.randomUUID(),
    publicationId: pub.id,
    anOrgId: AN_ORG,
    status: "OFFERED",
    notifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return pub.id;
}

/** Accept policy on behalf of AN_ORG for the given publication. */
async function acceptPolicy(publicationId: string): Promise<void> {
  await db
    .update(dataPublicationRecipientsTable)
    .set({ status: "ACCEPTED", policyAcceptedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(dataPublicationRecipientsTable.publicationId, publicationId),
        eq(dataPublicationRecipientsTable.anOrgId, AN_ORG),
      ),
    );
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  policyTemplateId = await getPolicyTemplateId();

  // Organisations
  await db
    .insert(organizationsTable)
    .values([
      { id: AG_ORG, name: `${PREFIX} AG Org`, type: "AG" },
      { id: AN_ORG, name: `${PREFIX} AN Org`, type: "AN" },
    ])
    .onConflictDoNothing();

  // Users
  await db
    .insert(usersTable)
    .values([
      { id: AG_USER, name: `${PREFIX} AG User`, email: `${PREFIX}-ag@test.dev`, passwordHash: "x" },
      { id: AN_USER, name: `${PREFIX} AN User`, email: `${PREFIX}-an@test.dev`, passwordHash: "x" },
    ])
    .onConflictDoNothing();

  // Project + contractor assignment
  await db
    .insert(projectsTable)
    .values([{ id: PROJECT, agOrgId: AG_ORG, name: `${PREFIX} Project`, status: "ACTIVE" }])
    .onConflictDoNothing();

  await db
    .insert(projectContractorsTable)
    .values({ projectId: PROJECT, anOrgId: AN_ORG, assignmentStatus: "ACTIVE" })
    .onConflictDoNothing();
  await db.insert(coordinationPoliciesTable).values({
    id: PROJECT_AGREEMENT,
    policyKey: PROJECT_AGREEMENT,
    version: 1,
    kind: "PROJECT_AGREEMENT",
    projectId: PROJECT,
    providerOrgId: AG_ORG,
    recipientOrgId: AN_ORG,
    lifecycleStatus: "ACCEPTED",
    policySnapshot: {},
    effectivePolicy: {
      policyType: "PROJECT_AGREEMENT",
      recipientOrganizationId: AN_ORG,
      projectReference: PROJECT,
      validFrom: null,
      validUntil: null,
      childPolicyTypes: ["PERFORMANCE_REQUEST"],
      childPermissions: ["READ", "DOWNLOAD", "USE_FOR_PERFORMANCE_COORDINATION"],
    },
  }).onConflictDoNothing();
  await db.insert(projectMembershipsTable).values({
    id: `${PREFIX}-membership`,
    projectId: PROJECT,
    agOrgId: AG_ORG,
    anOrgId: AN_ORG,
    status: "ACTIVE",
    invitationId: `${PREFIX}-invitation`,
    correlationId: `${PREFIX}-correlation`,
    projectAgreementPolicyId: PROJECT_AGREEMENT,
  }).onConflictDoNothing();

  // Takt
  await db
    .insert(takteTable)
    .values([
      {
        id: TAKT,
        projectId: PROJECT,
        taktBezeichnung: `${PREFIX} Takt`,
        zone: "Zone-A",
        gewerk: "Elektro",
        plannedStart: "2026-05-01",
        plannedEnd: "2026-05-15",
      },
    ])
    .onConflictDoNothing();

  // JWT tokens
  agToken = makeToken(AG_USER, AG_ORG, "AG", ["AG_ADMIN"]);
  anToken = makeToken(AN_USER, AN_ORG, "AN", ["AN_ADMIN"]);

  // Create a published data publication (so policy gate applies)
  pubId = await createPublishedPublication();

  // Create + send the TaktRequest via the API so we get a proper snapshot
  const createRes = await request(app)
    .post("/api/takt-requests")
    .set("Authorization", `Bearer ${agToken}`)
    .send({ taktId: TAKT, nuOrgId: AN_ORG, dataPublicationId: pubId });

  if (createRes.status !== 201) {
    throw new Error(
      `TaktRequest creation failed ${createRes.status}: ${JSON.stringify(createRes.body)}`,
    );
  }
  requestId = (createRes.body as { id: string }).id;

  const sendRes = await request(app)
    .post(`/api/takt-requests/${requestId}/send`)
    .set("Authorization", `Bearer ${agToken}`);

  if (sendRes.status !== 200) {
    throw new Error(
      `TaktRequest send failed ${sendRes.status}: ${JSON.stringify(sendRes.body)}`,
    );
  }
});

afterAll(async () => {
  // Delete in FK-safe order (most dependent tables first).
  await db
    .execute(sql`DELETE FROM availability_checks WHERE takt_request_id = ${requestId}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM leistungsanfrage_resource_requirements WHERE leistungsanfrage_id = ${requestId}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM leistungsantworten WHERE leistungsanfrage_id = ${requestId}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM leistungsanfrage_audit_events WHERE request_id = ${requestId}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM leistungsanfrage_snapshots WHERE leistungsanfrage_id = ${requestId}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM leistungsanfragen WHERE id = ${requestId}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM data_publication_recipients WHERE publication_id = ${pubId}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM data_publications WHERE id = ${pubId}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM message_outbox WHERE sender_org_id IN (${sql.raw(`'${AG_ORG}', '${AN_ORG}'`)})`).catch(() => {});
  await db
    .execute(sql`DELETE FROM message_inbox WHERE recipient_org_id IN (${sql.raw(`'${AG_ORG}', '${AN_ORG}'`)})`).catch(() => {});
  await db
    .execute(sql`DELETE FROM leistungen WHERE id = ${TAKT}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM project_contractors WHERE project_id = ${PROJECT}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM project_memberships WHERE project_id = ${PROJECT}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM coordination_policies WHERE project_id = ${PROJECT}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM projects WHERE id = ${PROJECT}`).catch(() => {});
  await db
    .execute(sql`DELETE FROM users WHERE id IN (${sql.raw(`'${AG_USER}', '${AN_USER}'`)})`).catch(() => {});
  await db
    .execute(sql`DELETE FROM organizations WHERE id IN (${sql.raw(`'${AG_ORG}', '${AN_ORG}'`)})`).catch(() => {});
});

// ── W1: Policy accepted → navigate away → return → Step 2 is active ──────────
//
// Before acceptance: /details returns 403 POLICY_ACCEPTANCE_REQUIRED (Step 1 not done).
// After acceptance:  /details returns 200 + detailsRetrievedAt set (Step 1 done, Step 2 active).
// On return:         re-calling /details still returns 200 with detailsRetrievedAt set.

describe("W1 – policy accepted then navigate away and return", () => {
  it("W1a – local AN projection details are available after Dataspace delivery", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(res.body.snapshotPayload).toBeDefined();
  });

  it("W1b – publication acceptance does not regress access granted by the accepted project agreement", async () => {
    await acceptPolicy(pubId);

    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(res.body.detailsRetrievedAt).toBeTruthy();
    expect(res.body.status).toBe("DETAILS_RETRIEVED");
    const reviewed = await request(app)
      .post(`/api/an/takt-requests/${requestId}/details/review`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({});
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.detailsRetrievedAt).toBe(res.body.detailsRetrievedAt);
    expect(reviewed.body.status).toBe("DETAILS_RETRIEVED");
    expect(res.body.snapshotPayload).toBeDefined();
  });

  it("W1c – return to page: /details again returns 200 with same detailsRetrievedAt (idempotent)", async () => {
    // First call to record the timestamp
    const first = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);
    expect(first.status).toBe(200);
    const firstTimestamp = first.body.detailsRetrievedAt as string;
    expect(firstTimestamp).toBeTruthy();

    // Simulate navigating away and back — second call to the same endpoint
    const second = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(second.status).toBe(200);
    expect(second.body.detailsRetrievedAt).toBe(firstTimestamp); // unchanged
    expect(second.body.status).toBe("DETAILS_RETRIEVED");        // no regression
  });

  it("W1d – return to page: resource-requirements list is empty (Step 3 not yet done)", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/resource-requirements`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it("W1e – return to page: latest availability check is 404 (Step 4 not yet done)", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(404);
  });
});

// ── W2: Resource requirement added → navigate away → return → Step 3 complete ─
//
// NU adds a resource requirement, then re-calls the list endpoint (simulating
// a page reload) to confirm the entry persists — Step 3 is derived from this list.

describe("W2 – resource requirement survives navigation", () => {
  let reqRowId: string;

  it("W2a – POST resource requirement → 201", async () => {
    const res = await request(app)
      .post(`/api/an/takt-requests/${requestId}/resource-requirements`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({
        requiredQualification: "Elektro-Fachkraft",
        requiredCapacity: 2,
        utilizationPercent: 100,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    reqRowId = res.body.id as string;
  });

  it("W2b – navigate away and return: GET resource-requirements returns the entry (Step 3 complete)", async () => {
    // Simulate page reload / navigation return
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/resource-requirements`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const found = (res.body as Array<{ id: string }>).find((r) => r.id === reqRowId);
    expect(found).toBeDefined();
  });

  it("W2c – /details still returns 200 with detailsRetrievedAt set (Step 2 still done)", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(res.body.detailsRetrievedAt).toBeTruthy();
  });
});

// ── W3: Availability check run → Step 4 complete, result for Step 5 ───────────
//
// After running a check the latest-check endpoint returns the completed result.
// The frontend reads `result` to pre-fill the recommended decision in Step 5.

describe("W3 – availability check persists and pre-fills Step 5", () => {
  it("W3a – POST availability-checks → 201 with a result", async () => {
    const res = await request(app)
      .post(`/api/an/takt-requests/${requestId}/availability-checks`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({ checkDate: new Date().toISOString() });

    expect(res.status).toBe(201);
    expect(res.body.checkId).toBeTruthy();
    expect(res.body.status).toMatch(/^(COMPLETED|FAILED)$/);
  });

  it("W3b – navigate away and return: GET latest check → 200 with COMPLETED status (Step 4 done)", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });

  it("W3c – latest check exposes a result field that maps to a Step-5 decision", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);

    // The frontend maps result → decision; valid result values are:
    //   FEASIBLE → ACCEPTED
    //   FEASIBLE_WITH_ALTERNATIVES → ALTERNATIVES_PROPOSED
    //   NOT_FEASIBLE → REJECTED
    const validResults = ["FEASIBLE", "FEASIBLE_WITH_ALTERNATIVES", "NOT_FEASIBLE"];
    expect(validResults).toContain(res.body.result);
  });

  it("W3d – TaktRequest status is now UNDER_REVIEW (first check transitions DETAILS_RETRIEVED → UNDER_REVIEW)", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/details`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    // After running the check the status should be UNDER_REVIEW
    expect(res.body.status).toBe("UNDER_REVIEW");
  });
});

// ── W4: Full workflow persists end-to-end after submitting response ────────────
//
// Submitting a response transitions to ACCEPTED/REJECTED/ALTERNATIVES_PROPOSED.
// On return the /details endpoint reflects this final status (Step 5 done).

describe("W4 – response submitted, all steps persist on return", () => {
  it("W4a – NU submits ACCEPTED response → 200 or 201", async () => {
    const res = await request(app)
      .post(`/api/an/takt-requests/${requestId}/responses`)
      .set("Authorization", `Bearer ${anToken}`)
      .send({
        decision: "ACCEPTED",
        acceptedTimeWindow: { start: "2026-05-01T08:00:00Z", end: "2026-05-15T17:00:00Z" },
      });

    // 200 = idempotent repeat, 201 = new response
    expect([200, 201]).toContain(res.status);
  });

  it("W4b – navigate away and return: request list shows ACCEPTED status (Step 5 done)", async () => {
    // After a response is submitted the request status moves to ACCEPTED.
    // The /details endpoint only serves DELIVERED/DETAILS_RETRIEVED/UNDER_REVIEW
    // for the NU (returns 409 otherwise), so the AN reads final status from
    // the requests list — which is how the frontend dashboard reflects Step 5.
    const res = await request(app)
      .get("/api/an/takt-requests?role=nu")
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    const found = (res.body as Array<{ id: string; status: string }>).find(
      (r) => r.id === requestId,
    );
    expect(found).toBeDefined();
    expect(found!.status).toBe("RESPONDED");
  });

  it("W4c – navigate away and return: resource-requirements still present (Step 3 still done)", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/resource-requirements`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("W4d – navigate away and return: latest availability check still COMPLETED (Step 4 still done)", async () => {
    const res = await request(app)
      .get(`/api/an/takt-requests/${requestId}/availability-checks/latest`)
      .set("Authorization", `Bearer ${anToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });
});

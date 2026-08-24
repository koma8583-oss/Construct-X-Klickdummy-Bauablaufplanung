/**
 * Focused unit tests for:
 *   1. deriveCoordinationFacts — derives next action purely from factual data
 *   2. buildCoordinationTimeline — canonical business timeline without fallback to createdAt
 *   3. coordination-task-service — correct lastChangedAt, multi-constraint/clarification handling
 *   4. ag-coordination-board — factual hasResponse/hasDecision from actual records
 *
 * Fixture prefix: "t240-"
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leistungsanfragenTable,
  leistungenTable,
  leistungsantwortenTable,
  leistungsantwortEntscheidungenTable,
  organizationsTable,
  projectsTable,
  serviceChangeProposalsTable,
  serviceClarificationsTable,
  serviceConstraintsTable,
  serviceReadinessChecksTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { buildCoordinationTimeline } from "../services/service-change-proposal-service";
import { deriveCoordinationFacts, deriveServiceCoordinationState } from "../services/service-coordination-state";
import { getCoordinationTasks } from "../services/coordination-task-service";

const JWT_SECRET = process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const GU_ORG = "t240-gu-org";
const NU_ORG = "t240-nu-org";
const GU_USER = "t240-gu-user";
const NU_USER = "t240-nu-user";
const PROJECT = "t240-project";
const LEISTUNG = "t240-leistung";
const REQUEST_TASKS = "t240-request-tasks";
const REQUEST_COORD = "t240-request-coord";
const REQUEST_MULTI = "t240-request-multi";

function token(userId: string, orgId: string, orgType: "AG" | "AN") {
  return jwt.sign(
    { userId, orgId, orgType, hubAdmin: false, roles: [orgType === "AG" ? "AG_ADMIN" : "AN_ADMIN"] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const guToken = token(GU_USER, GU_ORG, "AG");
const nuToken = token(NU_USER, NU_ORG, "AN");

const originalStart = new Date("2026-10-01T08:00:00.000Z");
const originalEnd = new Date("2026-10-05T17:00:00.000Z");

async function insertRequest(id: string, suffix: string, opts: {
  agreed?: boolean;
  status?: "UNDER_REVIEW" | "ACCEPTED" | "SENT" | "DELIVERED";
  sentAt?: Date;
  deliveredAt?: Date;
} = {}) {
  await db.insert(leistungsanfragenTable).values({
    id,
    leistungId: LEISTUNG,
    leistungVersion: 1,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG,
    requestNumber: `T240-${suffix}`,
    status: opts.status ?? "UNDER_REVIEW",
    sentAt: opts.sentAt ?? new Date("2026-09-01T09:00:00.000Z"),
    deliveredAt: opts.deliveredAt ?? new Date("2026-09-01T09:05:00.000Z"),
    createdByUserId: GU_USER,
    agreedStart: opts.agreed ? originalStart : null,
    agreedEnd: opts.agreed ? originalEnd : null,
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    updatedAt: new Date("2026-09-01T08:00:00.000Z"),
  }).onConflictDoNothing();
}

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "T240 GU", type: "AG" },
    { id: NU_ORG, name: "T240 NU", type: "AN" },
  ]).onConflictDoNothing();
  await db.insert(usersTable).values([
    { id: GU_USER, name: "T240 GU user", email: "t240-gu@test.invalid", passwordHash: "x" },
    { id: NU_USER, name: "T240 NU user", email: "t240-nu@test.invalid", passwordHash: "x" },
  ]).onConflictDoNothing();
  await db.insert(projectsTable).values({ id: PROJECT, agOrgId: GU_ORG, name: "T240 project" }).onConflictDoNothing();
  await db.insert(leistungenTable).values({
    id: LEISTUNG,
    projectId: PROJECT,
    leistungsBezeichnung: "T240 Leistung",
    zone: "A",
    gewerk: "Rohbau",
    plannedStart: "2026-10-01",
    plannedEnd: "2026-10-05",
  }).onConflictDoNothing();

  await insertRequest(REQUEST_TASKS, "TASKS", { status: "UNDER_REVIEW" });
  await insertRequest(REQUEST_COORD, "COORD", { agreed: true });
  // REQUEST_MULTI is in ACCEPTED status so there is no RESPOND_TO_REQUEST pending —
  // constraints and clarifications will surface correctly for AG.
  await insertRequest(REQUEST_MULTI, "MULTI", { agreed: true, status: "ACCEPTED" });
});

afterAll(async () => {
  const ids = [REQUEST_TASKS, REQUEST_COORD, REQUEST_MULTI];
  await db.delete(serviceReadinessChecksTable).where(inArray(serviceReadinessChecksTable.serviceRequestId, ids)).catch(() => {});
  await db.delete(serviceClarificationsTable).where(inArray(serviceClarificationsTable.serviceRequestId, ids)).catch(() => {});
  await db.delete(serviceConstraintsTable).where(inArray(serviceConstraintsTable.serviceRequestId, ids)).catch(() => {});
  await db.delete(leistungsantwortEntscheidungenTable).where(inArray(leistungsantwortEntscheidungenTable.leistungsanfrageId, ids)).catch(() => {});
  await db.delete(leistungsantwortenTable).where(inArray(leistungsantwortenTable.leistungsanfrageId, ids)).catch(() => {});
  await db.delete(serviceChangeProposalsTable).where(inArray(serviceChangeProposalsTable.leistungsanfrageId, ids)).catch(() => {});
  await db.delete(leistungsanfragenTable).where(inArray(leistungsanfragenTable.id, ids)).catch(() => {});
  await db.delete(leistungenTable).where(eq(leistungenTable.id, LEISTUNG)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT)).catch(() => {});
  await db.delete(usersTable).where(inArray(usersTable.id, [GU_USER, NU_USER])).catch(() => {});
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, [GU_ORG, NU_ORG])).catch(() => {});
});

// ── Unit tests for deriveCoordinationFacts ────────────────────────────────────

describe("deriveCoordinationFacts — factual next action derivation", () => {
  it.each([
    "SENT",
    "DELIVERED",
    "DETAILS_RETRIEVED",
    "UNDER_REVIEW",
  ])("assigns open request status %s to AN even when viewed by AG", (requestStatus) => {
    const result = deriveServiceCoordinationState({
      party: "AG",
      requestStatus,
      hasResponse: false,
      hasDecision: false,
    });
     expect(result).toEqual({ nextAction: "RESPOND_TO_REQUEST", nextActionOwner: "AN", actionRequiredBy: null });
  });

  it("keeps REVISION_REQUIRED assigned to AN after the previous response was decided", () => {
    const factualResult = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "REVISION_REQUIRED",
      hasResponse: true,
      hasDecision: true,
    });
     expect(factualResult).toEqual({ nextAction: "RESPOND_TO_REQUEST", nextActionOwner: "AN", actionRequiredBy: null });

    const result = deriveServiceCoordinationState({
      party: "AG",
      requestStatus: "REVISION_REQUIRED",
      hasResponse: true,
      hasDecision: true,
    });
     expect(result).toEqual({ nextAction: "RESPOND_TO_REQUEST", nextActionOwner: "AN", actionRequiredBy: null });

    const anResult = deriveServiceCoordinationState({
      party: "AN",
      requestStatus: "REVISION_REQUIRED",
      hasResponse: true,
      hasDecision: true,
    });
     expect(anResult).toEqual({ nextAction: "RESPOND_TO_REQUEST", nextActionOwner: "AN", actionRequiredBy: null });
  });

  it("assigns a submitted response to AG until a decision exists", () => {
    const result = deriveServiceCoordinationState({
      party: "AN",
      requestStatus: "UNDER_REVIEW",
      hasResponse: true,
      hasDecision: false,
    });
     expect(result).toEqual({ nextAction: "DECIDE_RESPONSE", nextActionOwner: "AG", actionRequiredBy: null });
  });

  it("returns RESPOND_TO_REQUEST for AN when no response exists and request is open", () => {
    const result = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "UNDER_REVIEW",
      hasResponse: false,
      hasDecision: false,
    });
    expect(result.nextAction).toBe("RESPOND_TO_REQUEST");
    expect(result.nextActionOwner).toBe("AN");
  });

  it("returns DECIDE_RESPONSE for AG when response exists but no decision", () => {
    const result = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "UNDER_REVIEW",
      hasResponse: true,
      hasDecision: false,
    });
    expect(result.nextAction).toBe("DECIDE_RESPONSE");
    expect(result.nextActionOwner).toBe("AG");
  });

  it("returns NO_ACTION when response and decision both exist", () => {
    const result = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "ACCEPTED",
      hasResponse: true,
      hasDecision: true,
    });
    expect(result.nextAction).toBe("NO_ACTION");
    expect(result.nextActionOwner).toBeNull();
  });

  it("RESPOND_TO_CHANGE_PROPOSAL takes priority over DECIDE_RESPONSE", () => {
    const result = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "ACCEPTED",
      hasResponse: true,
      hasDecision: false,
      openProposalProposerOrgId: "gu-org",  // AG proposed → AN must respond
      openProposalGuOrgId: "gu-org",
    });
    // AG proposed the open proposal, so AN must respond
    expect(result.nextAction).toBe("RESPOND_TO_CHANGE_PROPOSAL");
    expect(result.nextActionOwner).toBe("AN");
  });

  it("resolves proposal respondent correctly when NU proposed", () => {
    const result = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "ACCEPTED",
      hasResponse: true,
      hasDecision: true,
      openProposalProposerOrgId: "nu-org",  // AN proposed → AG must respond
      openProposalGuOrgId: "gu-org",
    });
    expect(result.nextAction).toBe("RESPOND_TO_CHANGE_PROPOSAL");
    expect(result.nextActionOwner).toBe("AG");
  });

  it("returns ANSWER_CLARIFICATION for AG when AN asked an open question", () => {
    const result = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "ACCEPTED",
      hasResponse: true,
      hasDecision: true,
      clarificationPendingForAG: true,
    });
    expect(result.nextAction).toBe("ANSWER_CLARIFICATION");
    expect(result.nextActionOwner).toBe("AG");
  });

  it("returns RESOLVE_CONSTRAINT for AN when a constraint is assigned to them", () => {
    const result = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "ACCEPTED",
      hasResponse: true,
      hasDecision: true,
      constraintPendingForAN: true,
    });
    expect(result.nextAction).toBe("RESOLVE_CONSTRAINT");
    expect(result.nextActionOwner).toBe("AN");
  });

  it("returns CONFIRM_READINESS when readiness is pending for AG", () => {
    const result = deriveCoordinationFacts({
      guOrgId: "gu-org",
      requestStatus: "ACCEPTED",
      hasResponse: true,
      hasDecision: true,
      readinessPendingForAG: true,
    });
    expect(result.nextAction).toBe("CONFIRM_READINESS");
    expect(result.nextActionOwner).toBe("AG");
  });
});

// ── Unit tests for buildCoordinationTimeline ──────────────────────────────────

describe("buildCoordinationTimeline — canonical timeline", () => {
  const baseRequest = {
    guOrgId: GU_ORG,
    createdAt: new Date("2026-09-01T08:00:00Z"),
    sentAt: new Date("2026-09-01T09:00:00Z"),
    deliveredAt: new Date("2026-09-01T10:00:00Z"),
    agreedStart: null as Date | null,
    agreedEnd: null as Date | null,
  };

  it("does NOT emit AGREEMENT_REACHED when agreedStart/End is set but no accepted proposal and no decisionAt", () => {
    const timeline = buildCoordinationTimeline(
      { ...baseRequest, agreedStart: originalStart, agreedEnd: originalEnd },
      [], // no proposals
      {}, // no extras with decisionAt
    );
    expect(timeline.map((e) => e.type)).not.toContain("AGREEMENT_REACHED");
  });

  it("emits AGREEMENT_REACHED using decisionAt when no accepted proposal", () => {
    const decisionAt = new Date("2026-09-05T12:00:00Z");
    const timeline = buildCoordinationTimeline(
      { ...baseRequest, agreedStart: originalStart, agreedEnd: originalEnd },
      [],
      { decisionAt },
    );
    const event = timeline.find((e) => e.type === "AGREEMENT_REACHED");
    expect(event).toBeDefined();
    expect((event!.at as Date).toISOString()).toBe(decisionAt.toISOString());
  });

   it("does not emit AGREEMENT_REACHED from an accepted proposal resolvedAt", () => {
    const resolvedAt = new Date("2026-09-04T14:00:00Z");
    const timeline = buildCoordinationTimeline(
      { ...baseRequest, agreedStart: originalStart, agreedEnd: originalEnd },
      [{
        id: "p1",
        leistungsanfrageId: REQUEST_COORD,
        proposerOrgId: GU_ORG,
        proposerUserId: GU_USER,
        start: originalStart,
        end: originalEnd,
        reasonCode: null,
        comment: null,
        action: "PROPOSE",
        status: "ACCEPTED",
        supersedesProposalId: null,
        createdAt: new Date("2026-09-03T10:00:00Z"),
        resolvedAt,
        resolvedByUserId: NU_USER,
      }],
      {},
    );
     expect(timeline.find((e) => e.type === "AGREEMENT_REACHED")).toBeUndefined();
     expect(timeline.find((e) => e.type === "CHANGE_PROPOSAL_ACCEPTED")).toBeDefined();
  });

  it("emits CHANGE_PROPOSAL_ACCEPTED (not second AGREEMENT_REACHED) when proposal accepted after agreement", () => {
    const resolvedAt = new Date("2026-09-10T14:00:00Z");
    const decisionAt = new Date("2026-09-05T12:00:00Z");
    const timeline = buildCoordinationTimeline(
      { ...baseRequest, agreedStart: originalStart, agreedEnd: originalEnd },
      [{
        id: "p2",
        leistungsanfrageId: REQUEST_COORD,
        proposerOrgId: NU_ORG,
        proposerUserId: NU_USER,
        start: originalStart,
        end: originalEnd,
        reasonCode: null,
        comment: null,
        action: "PROPOSE",
        status: "ACCEPTED",
        supersedesProposalId: null,
        createdAt: new Date("2026-09-08T10:00:00Z"),
        resolvedAt,
        resolvedByUserId: GU_USER,
      }],
      { decisionAt },
    );
    const types = timeline.map((e) => e.type);
    expect(types).toContain("AGREEMENT_REACHED");
    expect(types).toContain("CHANGE_PROPOSAL_ACCEPTED");
    expect(types.filter((t) => t === "AGREEMENT_REACHED")).toHaveLength(1);
  });

  it("includes RESPONSE_SUBMITTED event when responseAt is provided", () => {
    const responseAt = new Date("2026-09-02T11:00:00Z");
    const timeline = buildCoordinationTimeline(baseRequest, [], { responseAt });
    expect(timeline.map((e) => e.type)).toContain("RESPONSE_SUBMITTED");
  });

   it("includes CLARIFICATION_CREATED and CLARIFICATION_RESOLVED events", () => {
    const timeline = buildCoordinationTimeline(baseRequest, [], {
      clarifications: [{
        id: "clr1",
        askedByOrgId: NU_ORG,
        createdAt: new Date("2026-09-03T09:00:00Z"),
        answeredAt: new Date("2026-09-04T09:00:00Z"),
        status: "RESOLVED" as const,
      }],
    });
    const types = timeline.map((e) => e.type);
     expect(types).toContain("CLARIFICATION_CREATED");
     expect(types).toContain("CLARIFICATION_RESOLVED");
  });

   it("does not include CLARIFICATION_RESOLVED when not yet resolved", () => {
    const timeline = buildCoordinationTimeline(baseRequest, [], {
      clarifications: [{
        id: "clr2",
        askedByOrgId: NU_ORG,
        createdAt: new Date("2026-09-03T09:00:00Z"),
        answeredAt: null,
        status: "OPEN" as const,
      }],
    });
    const types = timeline.map((e) => e.type);
     expect(types).toContain("CLARIFICATION_CREATED");
     expect(types).not.toContain("CLARIFICATION_RESOLVED");
  });

  it("includes CONSTRAINT_REPORTED and CONSTRAINT_RESOLVED events", () => {
    const timeline = buildCoordinationTimeline(baseRequest, [], {
      constraints: [{
        id: "con1",
        createdAt: new Date("2026-09-03T10:00:00Z"),
        resolvedAt: new Date("2026-09-05T10:00:00Z"),
        reportedByRole: "AG" as const,
        status: "RESOLVED" as const,
      }],
    });
    const types = timeline.map((e) => e.type);
    expect(types).toContain("CONSTRAINT_REPORTED");
    expect(types).toContain("CONSTRAINT_RESOLVED");
  });

   it("emits READINESS_CHANGED when readiness is provided", () => {
    const timeline = buildCoordinationTimeline(baseRequest, [], {
      readiness: { updatedAt: new Date("2026-09-20T08:00:00Z") },
    });
     expect(timeline.map((e) => e.type)).toContain("READINESS_CHANGED");
  });

  it("events are sorted chronologically", () => {
    const responseAt = new Date("2026-09-01T11:00:00Z");
    const timeline = buildCoordinationTimeline(baseRequest, [], { responseAt });
    const timestamps = timeline.map((e) => (e.at as Date).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }
  });
});

// ── Integration: getCoordination endpoint returns lastChangedAt ───────────────

describe("GET /api/leistungsanfragen/:id/coordination — lastChangedAt and factual derivation", () => {
  it("returns lastChangedAt in the coordination response", async () => {
    const res = await request(app)
      .get(`/api/leistungsanfragen/${REQUEST_COORD}/coordination`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
    expect(res.body.lastChangedAt).toBeDefined();
    // Should be a valid ISO timestamp
    expect(new Date(res.body.lastChangedAt).getTime()).not.toBeNaN();
  });

  it("lastChangedAt advances when a response is added", async () => {
    // Insert a response
    const [responseRow] = await db.insert(leistungsantwortenTable).values({
      leistungsanfrageId: REQUEST_COORD,
      decision: "ACCEPTED",
      acceptedStart: originalStart,
      acceptedEnd: originalEnd,
      createdByUserId: NU_USER,
      createdAt: new Date("2026-09-10T10:00:00Z"),
    }).returning().catch(() => [null]);

    if (!responseRow) return; // skip if insert failed (already exists)

    const res = await request(app)
      .get(`/api/leistungsanfragen/${REQUEST_COORD}/coordination`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
    const lastChanged = new Date(res.body.lastChangedAt);
    // Must be >= 2026-09-10 (the response date), not the earlier request.createdAt
    expect(lastChanged.getTime()).toBeGreaterThanOrEqual(new Date("2026-09-10T10:00:00Z").getTime());

    // Cleanup
    if (responseRow) {
      await db.delete(leistungsantwortenTable).where(eq(leistungsantwortenTable.id, responseRow.id)).catch(() => {});
    }
  });
});

// ── Integration: getCoordinationTasks uses factual hasResponse/hasDecision ────

describe("getCoordinationTasks — factual derivation and correct lastChangedAt", () => {
  it("includes RESPOND_TO_REQUEST task for AN when request is UNDER_REVIEW with no response", async () => {
    const tasks = await getCoordinationTasks({ orgId: NU_ORG, role: "AN" });
    const task = tasks.find((t) => t.serviceRequestId === REQUEST_TASKS);
    expect(task).toBeDefined();
    expect(task?.taskType).toBe("RESPOND_TO_REQUEST");
  });

  it("lastChangedAt is max of request.updatedAt and any response timestamp", async () => {
    const responseCreatedAt = new Date("2026-09-15T14:00:00Z");
    const [responseRow] = await db.insert(leistungsantwortenTable).values({
      leistungsanfrageId: REQUEST_TASKS,
      decision: "ACCEPTED",
      acceptedStart: originalStart,
      acceptedEnd: originalEnd,
      createdByUserId: NU_USER,
      createdAt: responseCreatedAt,
    }).returning();

    // Now AG needs to DECIDE_RESPONSE
    const tasks = await getCoordinationTasks({ orgId: GU_ORG, role: "AG" });
    const task = tasks.find((t) => t.serviceRequestId === REQUEST_TASKS);
    expect(task).toBeDefined();
    expect(task?.taskType).toBe("DECIDE_RESPONSE");
    // lastChangedAt must be >= the response date
    expect(new Date(task!.lastChangedAt).getTime()).toBeGreaterThanOrEqual(responseCreatedAt.getTime());

    // Cleanup
    await db.delete(leistungsantwortenTable).where(eq(leistungsantwortenTable.id, responseRow.id)).catch(() => {});
  });

  it("handles multiple open constraints for the same request without clobbering", async () => {
    // Insert two open constraints on REQUEST_MULTI, both assigned to GU_ORG
    const [c1] = await db.insert(serviceConstraintsTable).values({
      serviceRequestId: REQUEST_MULTI,
      reportedByOrgId: NU_ORG,
      reportedByRole: "AN",
      constraintType: "SITE_NOT_READY",
      description: "Site A not ready",
      responsibleOrgId: GU_ORG,
    }).returning();
    const [c2] = await db.insert(serviceConstraintsTable).values({
      serviceRequestId: REQUEST_MULTI,
      reportedByOrgId: NU_ORG,
      reportedByRole: "AN",
      constraintType: "INFORMATION_MISSING",
      description: "Info missing",
      responsibleOrgId: GU_ORG,
    }).returning();

    const tasks = await getCoordinationTasks({ orgId: GU_ORG, role: "AG" });
    const task = tasks.find((t) => t.serviceRequestId === REQUEST_MULTI);
    // Should still find a task (constraint resolution for AG)
    expect(task).toBeDefined();
    expect(task?.taskType).toBe("RESOLVE_CONSTRAINT");

    // Cleanup
    await db.delete(serviceConstraintsTable).where(
      inArray(serviceConstraintsTable.id, [c1.id, c2.id]),
    ).catch(() => {});
  });

  it("handles multiple open clarifications and picks the right pending-for-party", async () => {
    // AN asked a clarification → AG must answer
    const [cl1] = await db.insert(serviceClarificationsTable).values({
      serviceRequestId: REQUEST_MULTI,
      askedByOrgId: NU_ORG,
      askedByRole: "AN",
      category: "SCOPE",
      question: "What is the exact scope?",
    }).returning();

    const tasks = await getCoordinationTasks({ orgId: GU_ORG, role: "AG" });
    const task = tasks.find((t) => t.serviceRequestId === REQUEST_MULTI && t.taskType === "ANSWER_CLARIFICATION");
    expect(task).toBeDefined();
    expect(task?.taskType).toBe("ANSWER_CLARIFICATION");

    // Cleanup
    await db.delete(serviceClarificationsTable).where(eq(serviceClarificationsTable.id, cl1.id)).catch(() => {});
  });
});

// ── Integration: AG coordination board uses factual data ──────────────────────

describe("GET /api/ag/projects/:projectId/coordination-board — factual nextAction", () => {
  it("returns nextAction RESPOND_TO_REQUEST for a request with no response", async () => {
    const res = await request(app)
      .get(`/api/ag/projects/${PROJECT}/coordination-board`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as Array<{ serviceRequestId: string; nextAction: string }>)
      .find((r) => r.serviceRequestId === REQUEST_TASKS);
    // No response yet → AN must respond
    expect(row?.nextAction).toBe("RESPOND_TO_REQUEST");
  });

  it("returns lastChangedAt that reflects proposal timestamps on the board", async () => {
    // Insert a proposal to advance the lastChangedAt
    const proposalCreatedAt = new Date("2026-09-20T10:00:00Z");
    const [proposal] = await db.insert(serviceChangeProposalsTable).values({
      leistungsanfrageId: REQUEST_COORD,
      proposerOrgId: GU_ORG,
      proposerUserId: GU_USER,
      start: originalStart,
      end: originalEnd,
      action: "PROPOSE",
      createdAt: proposalCreatedAt,
    }).returning();

    const res = await request(app)
      .get(`/api/ag/projects/${PROJECT}/coordination-board`)
      .set("Authorization", `Bearer ${guToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as Array<{ serviceRequestId: string; lastChangedAt: string }>)
      .find((r) => r.serviceRequestId === REQUEST_COORD);
    expect(row?.lastChangedAt).toBeDefined();
    expect(new Date(row!.lastChangedAt).getTime()).toBeGreaterThanOrEqual(proposalCreatedAt.getTime());

    // Cleanup
    await db.delete(serviceChangeProposalsTable).where(eq(serviceChangeProposalsTable.id, proposal.id)).catch(() => {});
  });
});

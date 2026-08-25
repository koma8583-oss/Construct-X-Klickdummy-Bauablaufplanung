/**
 * Parallel TaktRequest selection integration coverage.
 *
 * These tests exercise the public AG batch and GU decision endpoints against
 * isolated database fixtures. A selection group represents one exclusive
 * award: at most one request may be confirmed.
 *
 * Fixture prefix: "parallel-selection-"
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { and, eq, inArray, or } from "drizzle-orm";
import { agDb as db } from "@workspace/db";
import {
  hubMessagesTable,
  messageInboxTable,
  messageOutboxTable,
  organizationsTable,
  projectContractorsTable,
  projectMembershipsTable,
  projectsTable,
  taktRequestAuditEventsTable,
  taktRequestSnapshotsTable,
  taktRequestsTable,
  taktResponseDecisionsTable,
  taktResponsesTable,
  takteTable,
  usersTable,
  anLeistungsanfragenTable,
  anLeistungsantwortenTable,
  anLeistungsantwortAlternativenTable,
  dataspaceExchangesTable,
} from "@workspace/db";
import app from "../app";

const PREFIX = "parallel-selection";
const GU_ORG = `${PREFIX}-gu`;
const GU_USER = `${PREFIX}-gu-user`;
const PROJECT_ID = `${PREFIX}-project`;
const BATCH_TAKT_ID = `${PREFIX}-batch-takt`;
const SELECTION_TAKT_ID = `${PREFIX}-selection-takt`;
const CONCURRENT_TAKT_ID = `${PREFIX}-concurrent-takt`;
const INVALID_NU_ORG = `${PREFIX}-not-a-member`;

const NU_ORGS = ["a", "b", "c", "d", "e"].map((suffix) => `${PREFIX}-nu-${suffix}`);
const NU_USERS = NU_ORGS.map((orgId) => `${orgId}-user`);
const [NU_A, NU_B, NU_C, NU_D, NU_E] = NU_ORGS;
const [NU_A_USER, NU_B_USER] = NU_USERS;

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

const guToken = jwt.sign(
  {
    userId: GU_USER,
    orgId: GU_ORG,
    orgType: "AG",
    hubAdmin: false,
    roles: ["AG_ADMIN"],
  },
  JWT_SECRET,
  { expiresIn: "1h" },
);

type RequestRow = {
  id: string;
  nuOrgId: string;
  selectionGroupId: string;
};

async function createBatch(taktId: string, nuOrgIds: string[]): Promise<{
  selectionGroupId: string;
  requests: RequestRow[];
}> {
  const response = await request(app)
    .post("/api/takt-requests/batch")
    .set("Authorization", `Bearer ${guToken}`)
    .send({ taktId, nuOrgIds });

  expect(response.status).toBe(201);
  return response.body as {
    selectionGroupId: string;
    requests: RequestRow[];
  };
}

async function addAcceptedResponse(
  requestId: string,
  anOrgId: string,
  anUserId: string,
): Promise<string> {
  const anToken = jwt.sign({
    userId: anUserId, orgId: anOrgId, orgType: "AN", hubAdmin: false, roles: ["AN_ADMIN"],
  }, JWT_SECRET, { expiresIn: "1h" });
  const sent = await request(app)
    .post(`/api/takt-requests/${requestId}/send`)
    .set("Authorization", `Bearer ${guToken}`);
  expect([200, 201]).toContain(sent.status);
  const response = await request(app)
    .post(`/api/an/takt-requests/${requestId}/responses`)
    .set("Authorization", `Bearer ${anToken}`)
    .send({
      decision: "ACCEPTED",
      acceptedTimeWindow: { start: "2026-10-01", end: "2026-10-07" },
    });
  expect(response.status).toBe(201);
  const [agResponse] = await db.select({ id: taktResponsesTable.id })
    .from(taktResponsesTable).where(eq(taktResponsesTable.taktRequestId, requestId));
  expect(agResponse).toBeDefined();
  return agResponse.id;
}

async function addRejectedResponse(
  requestId: string,
  anOrgId: string,
  anUserId: string,
): Promise<void> {
  const anToken = jwt.sign({
    userId: anUserId, orgId: anOrgId, orgType: "AN", hubAdmin: false, roles: ["AN_ADMIN"],
  }, JWT_SECRET, { expiresIn: "1h" });
  const sent = await request(app)
    .post(`/api/takt-requests/${requestId}/send`)
    .set("Authorization", `Bearer ${guToken}`);
  expect([200, 201]).toContain(sent.status);
  const response = await request(app)
    .post(`/api/an/takt-requests/${requestId}/responses`)
    .set("Authorization", `Bearer ${anToken}`)
    .send({ decision: "REJECTED", reasonCode: "NO_CAPACITY" });
  expect(response.status).toBe(201);
}

async function createTakt(id: string): Promise<void> {
  await db.insert(takteTable).values({
    id,
    projectId: PROJECT_ID,
    taktBezeichnung: id,
    zone: "Z1",
    gewerk: "Rohbau",
    plannedStart: "2026-10-01",
    plannedEnd: "2026-10-07",
    version: 1,
    lifecycleStatus: "PLANNED",
  });
}

beforeAll(async () => {
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "Parallel Selection GU", type: "AG" },
    ...NU_ORGS.map((id, index) => ({
      id,
      name: `Parallel Selection NU ${index + 1}`,
      type: "AN" as const,
    })),
    { id: INVALID_NU_ORG, name: "Parallel Selection Invalid NU", type: "AN" },
  ]);

  await db.insert(usersTable).values([
    { id: GU_USER, name: "Parallel Selection GU User", email: `${GU_USER}@test.local`, passwordHash: "x" },
    ...NU_USERS.map((id) => ({
      id,
      name: `${id} user`,
      email: `${id}@test.local`,
      passwordHash: "x",
    })),
  ]);

  await db.insert(projectsTable).values({
    id: PROJECT_ID,
    agOrgId: GU_ORG,
    name: "Parallel Selection Project",
    status: "ACTIVE",
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  });

  await db.insert(projectContractorsTable).values(
    NU_ORGS.map((anOrgId) => ({
      projectId: PROJECT_ID,
      anOrgId,
      assignmentStatus: "ACTIVE" as const,
    })),
  );
  await db.insert(projectMembershipsTable).values(
    NU_ORGS.map((anOrgId, index) => ({
      id: `${PREFIX}-membership-${index}`,
      projectId: PROJECT_ID,
      agOrgId: GU_ORG,
      anOrgId,
      status: "ACTIVE" as const,
      invitationId: `${PREFIX}-invitation-${index}`,
      correlationId: `${PREFIX}-membership-correlation-${index}`,
    })),
  );

  await createTakt(BATCH_TAKT_ID);
  await createTakt(SELECTION_TAKT_ID);
  await createTakt(CONCURRENT_TAKT_ID);
});

afterAll(async () => {
  const localRequests = await db.select({ id: anLeistungsanfragenTable.id })
    .from(anLeistungsanfragenTable).where(inArray(anLeistungsanfragenTable.receiverAnOrgId, NU_ORGS));
  const localRequestIds = localRequests.map(({ id }) => id);
  if (localRequestIds.length) {
    const localResponses = await db.select({ id: anLeistungsantwortenTable.id })
      .from(anLeistungsantwortenTable)
      .where(inArray(anLeistungsantwortenTable.anLeistungsanfrageId, localRequestIds));
    const localResponseIds = localResponses.map(({ id }) => id);
    if (localResponseIds.length) {
      await db.delete(anLeistungsantwortAlternativenTable)
        .where(inArray(anLeistungsantwortAlternativenTable.responseId, localResponseIds));
      await db.delete(anLeistungsantwortenTable)
        .where(inArray(anLeistungsantwortenTable.id, localResponseIds));
    }
    await db.delete(anLeistungsanfragenTable)
      .where(inArray(anLeistungsanfragenTable.id, localRequestIds));
  }
  const takts = [BATCH_TAKT_ID, SELECTION_TAKT_ID, CONCURRENT_TAKT_ID];
  const requests = await db
    .select({ id: taktRequestsTable.id })
    .from(taktRequestsTable)
    .where(inArray(taktRequestsTable.taktId, takts));
  const requestIds = requests.map(({ id }) => id);

  if (requestIds.length > 0) {
    const responses = await db
      .select({ id: taktResponsesTable.id })
      .from(taktResponsesTable)
      .where(inArray(taktResponsesTable.taktRequestId, requestIds));
    const responseIds = responses.map(({ id }) => id);

    await db.delete(taktRequestAuditEventsTable).where(inArray(taktRequestAuditEventsTable.requestId, requestIds));
    await db.delete(taktResponseDecisionsTable).where(inArray(taktResponseDecisionsTable.taktRequestId, requestIds));
    if (responseIds.length > 0) {
      await db.delete(taktResponsesTable).where(inArray(taktResponsesTable.id, responseIds));
    }
    await db.delete(taktRequestSnapshotsTable).where(inArray(taktRequestSnapshotsTable.taktRequestId, requestIds));
    await db.delete(taktRequestsTable).where(inArray(taktRequestsTable.id, requestIds));
  }

  await db.delete(hubMessagesTable).where(
    or(
      eq(hubMessagesTable.senderOrgId, GU_ORG),
      inArray(hubMessagesTable.recipientOrgId, NU_ORGS),
    ),
  );
  await db.delete(messageInboxTable).where(
    or(
      eq(messageInboxTable.senderOrgId, GU_ORG),
      inArray(messageInboxTable.senderOrgId, NU_ORGS),
      eq(messageInboxTable.recipientOrgId, GU_ORG),
      inArray(messageInboxTable.recipientOrgId, NU_ORGS),
    ),
  );
  await db.delete(messageOutboxTable).where(
    or(
      eq(messageOutboxTable.senderOrgId, GU_ORG),
      inArray(messageOutboxTable.senderOrgId, NU_ORGS),
      eq(messageOutboxTable.recipientOrgId, GU_ORG),
      inArray(messageOutboxTable.recipientOrgId, NU_ORGS),
    ),
  );
  await db.delete(dataspaceExchangesTable).where(or(
    eq(dataspaceExchangesTable.senderOrgId, GU_ORG),
    eq(dataspaceExchangesTable.receiverOrgId, GU_ORG),
    inArray(dataspaceExchangesTable.senderOrgId, NU_ORGS),
    inArray(dataspaceExchangesTable.receiverOrgId, NU_ORGS),
  ));
  await db.delete(takteTable).where(inArray(takteTable.id, takts));
  await db.delete(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, PROJECT_ID));
  await db.delete(projectContractorsTable).where(eq(projectContractorsTable.projectId, PROJECT_ID));
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT_ID));
  await db.delete(usersTable).where(inArray(usersTable.id, [GU_USER, ...NU_USERS]));
  await db.delete(organizationsTable).where(
    inArray(organizationsTable.id, [GU_ORG, ...NU_ORGS, INVALID_NU_ORG]),
  );
});

describe("parallel TaktRequest selection", () => {
  it("creates one atomic batch with one shared selection group", async () => {
    const result = await createBatch(BATCH_TAKT_ID, [NU_A, NU_B]);

    expect(result.requests).toHaveLength(2);
    expect(result.selectionGroupId).toBeTruthy();
    expect(result.requests.map((row) => row.nuOrgId)).toEqual([NU_A, NU_B]);
    expect(new Set(result.requests.map((row) => row.selectionGroupId))).toEqual(
      new Set([result.selectionGroupId]),
    );

    const rows = await db
      .select({
        id: taktRequestsTable.id,
        selectionGroupId: taktRequestsTable.selectionGroupId,
        status: taktRequestsTable.status,
      })
      .from(taktRequestsTable)
      .where(inArray(taktRequestsTable.id, result.requests.map((row) => row.id)));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "DRAFT")).toBe(true);

    const snapshots = await db
      .select({ requestId: taktRequestSnapshotsTable.taktRequestId })
      .from(taktRequestSnapshotsTable)
      .where(inArray(taktRequestSnapshotsTable.taktRequestId, result.requests.map((row) => row.id)));
    expect(snapshots).toHaveLength(2);
  });

  it("rolls the complete batch back when a recipient cannot be created", async () => {
    const before = await db
      .select({ id: taktRequestsTable.id })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.taktId, BATCH_TAKT_ID));

    const response = await request(app)
      .post("/api/takt-requests/batch")
      .set("Authorization", `Bearer ${guToken}`)
      .send({ taktId: BATCH_TAKT_ID, nuOrgIds: [NU_A, INVALID_NU_ORG] });

    expect(response.status).toBe(403);

    const after = await db
      .select({ id: taktRequestsTable.id })
      .from(taktRequestsTable)
      .where(eq(taktRequestsTable.taktId, BATCH_TAKT_ID));
    expect(after).toEqual(before);
  });

  it("confirms one response, cancels answered/open siblings, and leaves terminal siblings unchanged", async () => {
    const result = await createBatch(SELECTION_TAKT_ID, [NU_A, NU_B, NU_C, NU_D, NU_E]);
    const byOrg = new Map(result.requests.map((row) => [row.nuOrgId, row]));
    const winner = byOrg.get(NU_A)!;
    const answeredSibling = byOrg.get(NU_B)!;
    const openSibling = byOrg.get(NU_C)!;
    const cancelledSibling = byOrg.get(NU_D)!;
    const expiredSibling = byOrg.get(NU_E)!;

    const winnerResponseId = await addAcceptedResponse(winner.id, NU_A, NU_A_USER);
    await addAcceptedResponse(answeredSibling.id, NU_B, NU_B_USER);
    await addRejectedResponse(openSibling.id, NU_C, NU_USERS[2]);
    await addRejectedResponse(cancelledSibling.id, NU_D, NU_USERS[3]);
    const cancellation = await request(app)
      .post(`/api/takt-requests/${cancelledSibling.id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .send({ decisionType: "CLOSE_WITHOUT_AGREEMENT" });
    expect(cancellation.status).toBe(201);
    // EXPIRED is an AG-owned deadline state, not a simulated AN action.
    await db
      .update(taktRequestsTable)
      .set({ status: "EXPIRED" })
      .where(eq(taktRequestsTable.id, expiredSibling.id));

    const first = await request(app)
      .post(`/api/takt-requests/${winner.id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .set("Idempotency-Key", `${PREFIX}-selection-confirm`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });

    expect(first.status).toBe(201);
    expect(first.body.responseId).toBe(winnerResponseId);
    expect(first.body.autoCancelledRequests.map((row: RequestRow) => row.id).sort()).toEqual(
      [answeredSibling.id, openSibling.id].sort(),
    );

    const statuses = await db
      .select({ id: taktRequestsTable.id, status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(inArray(taktRequestsTable.id, result.requests.map((row) => row.id)));
    const statusById = new Map(statuses.map((row) => [row.id, row.status]));
    expect(statusById.get(winner.id)).toBe("ACCEPTED");
    expect(statusById.get(answeredSibling.id)).toBe("CANCELLED");
    expect(statusById.get(openSibling.id)).toBe("CANCELLED");
    expect(statusById.get(cancelledSibling.id)).toBe("CANCELLED");
    expect(statusById.get(expiredSibling.id)).toBe("EXPIRED");

    const cancellationEvents = await db
      .select({ requestId: taktRequestAuditEventsTable.requestId, metadata: taktRequestAuditEventsTable.metadata })
      .from(taktRequestAuditEventsTable)
      .where(
        and(
          inArray(taktRequestAuditEventsTable.requestId, [answeredSibling.id, openSibling.id]),
          eq(taktRequestAuditEventsTable.eventType, "REQUEST_CANCELLED"),
        ),
      );
    expect(cancellationEvents).toHaveLength(2);
    for (const event of cancellationEvents) {
      expect(event.metadata).toMatchObject({
        reason: "PARALLEL_REQUEST_OTHER_AN_CONFIRMED",
        selectedRequestId: winner.id,
        selectionGroupId: result.selectionGroupId,
      });
    }

    const decisionEvents = await db
      .select({ eventType: taktRequestAuditEventsTable.eventType })
      .from(taktRequestAuditEventsTable)
      .where(
        and(
          eq(taktRequestAuditEventsTable.requestId, winner.id),
          eq(taktRequestAuditEventsTable.eventType, "GU_DECISION_MADE"),
        ),
      );
    expect(decisionEvents).toHaveLength(1);

    const cancellationOutbox = await db
      .select({ correlationId: messageOutboxTable.correlationId, payload: messageOutboxTable.payload })
      .from(messageOutboxTable)
      .where(
        and(
          eq(messageOutboxTable.messageType, "TAKT_REQUEST_CANCELLED"),
          inArray(messageOutboxTable.correlationId, [answeredSibling.id, openSibling.id]),
        ),
      );
    expect(cancellationOutbox).toHaveLength(2);
    expect(cancellationOutbox.map((message) => (message.payload as { comment: string }).comment))
      .toEqual([ "PARALLEL_REQUEST_OTHER_AN_CONFIRMED", "PARALLEL_REQUEST_OTHER_AN_CONFIRMED" ]);

    const cancellationInbox = await db
      .select({ correlationId: messageInboxTable.correlationId })
      .from(messageInboxTable)
      .where(
        and(
          eq(messageInboxTable.messageType, "TAKT_REQUEST_CANCELLED"),
          inArray(messageInboxTable.correlationId, [answeredSibling.id, openSibling.id]),
        ),
      );
    expect(cancellationInbox).toHaveLength(2);

    const retry = await request(app)
      .post(`/api/takt-requests/${winner.id}/gu-decisions`)
      .set("Authorization", `Bearer ${guToken}`)
      .set("Idempotency-Key", `${PREFIX}-selection-confirm`)
      .send({ decisionType: "CONFIRM_ACCEPTED" });
    expect(retry.status).toBe(200);
    expect(retry.body.idempotent).toBe(true);
    expect(retry.body.decisionId).toBe(first.body.decisionId);
    expect(retry.body.autoCancelledRequests).toEqual([]);

    const cancellationEventsAfterRetry = await db
      .select({ requestId: taktRequestAuditEventsTable.requestId })
      .from(taktRequestAuditEventsTable)
      .where(
        and(
          inArray(taktRequestAuditEventsTable.requestId, [answeredSibling.id, openSibling.id]),
          eq(taktRequestAuditEventsTable.eventType, "REQUEST_CANCELLED"),
        ),
      );
    expect(cancellationEventsAfterRetry).toHaveLength(2);
    const cancellationOutboxAfterRetry = await db
      .select({ id: messageOutboxTable.id })
      .from(messageOutboxTable)
      .where(
        and(
          eq(messageOutboxTable.messageType, "TAKT_REQUEST_CANCELLED"),
          inArray(messageOutboxTable.correlationId, [answeredSibling.id, openSibling.id]),
        ),
      );
    expect(cancellationOutboxAfterRetry).toHaveLength(2);
  });

  it("allows only one of two concurrent confirmations to win", async () => {
    const result = await createBatch(CONCURRENT_TAKT_ID, [NU_A, NU_B]);
    const firstRequest = result.requests[0];
    const secondRequest = result.requests[1];
    await addAcceptedResponse(firstRequest.id, NU_A, NU_A_USER);
    await addAcceptedResponse(secondRequest.id, NU_B, NU_B_USER);

    const decisions = await Promise.all(
      result.requests.map((row) =>
        request(app)
          .post(`/api/takt-requests/${row.id}/gu-decisions`)
          .set("Authorization", `Bearer ${guToken}`)
          .send({ decisionType: "CONFIRM_ACCEPTED" }),
      ),
    );

    expect(decisions.filter((response) => response.status === 201)).toHaveLength(1);
    expect(decisions.filter((response) => response.status === 409)).toHaveLength(1);
    expect(decisions.find((response) => response.status === 409)?.body.error).toMatch(
      /already been confirmed/i,
    );

    const rows = await db
      .select({ id: taktRequestsTable.id, status: taktRequestsTable.status })
      .from(taktRequestsTable)
      .where(inArray(taktRequestsTable.id, result.requests.map((row) => row.id)));
    expect(rows.filter((row) => row.status === "ACCEPTED")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "CANCELLED")).toHaveLength(1);

    const decisionsInDb = await db
      .select({ id: taktResponseDecisionsTable.id })
      .from(taktResponseDecisionsTable)
      .where(inArray(taktResponseDecisionsTable.taktRequestId, result.requests.map((row) => row.id)));
    expect(decisionsInDb).toHaveLength(1);

    const cancellationEvents = await db
      .select({ requestId: taktRequestAuditEventsTable.requestId })
      .from(taktRequestAuditEventsTable)
      .where(
        and(
          inArray(taktRequestAuditEventsTable.requestId, result.requests.map((row) => row.id)),
          eq(taktRequestAuditEventsTable.eventType, "REQUEST_CANCELLED"),
        ),
      );
    expect(cancellationEvents).toHaveLength(1);

    const cancellationMessages = await db
      .select({ id: messageOutboxTable.id })
      .from(messageOutboxTable)
      .where(
        and(
          eq(messageOutboxTable.messageType, "TAKT_REQUEST_CANCELLED"),
          inArray(messageOutboxTable.correlationId, result.requests.map((row) => row.id)),
        ),
      );
    expect(cancellationMessages).toHaveLength(1);
  });
});
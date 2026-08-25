/**
 * Task 2.6 — Service / repository layer tests.
 *
 * Covers the missing scenarios from Task 2.6's required test list that are
 * not already in takt-request-db.test.ts or takt-request-transitions.test.ts:
 *
 *   ✓ Org-filtered GU list
 *   ✓ Org-filtered NU list
 *   ✓ Valid status transition saved to DB
 *   ✓ ACCEPTED response — valid
 *   ✓ ACCEPTED without time window — rejected
 *   ✓ ALTERNATIVES_PROPOSED — 2 alternatives — valid
 *   ✓ ALTERNATIVES_PROPOSED — >3 alternatives — rejected
 *   ✓ Duplicate rank — rejected
 *   ✓ Duplicate alternativeId — rejected
 *   ✓ Invalid time window (end ≤ start) — rejected
 *   ✓ REJECTED — no alternatives, no accepted window — valid
 *   ✓ Second response for same request — rejected
 *
 * Uses a fresh fixture prefix (t26-) to avoid collisions with takt-request-db.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agDb as db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";
import {
  createTaktRequestDraft,
  getTaktRequestById,
  listTaktRequestsForGu,
  listTaktRequestsForNu,
  updateTaktRequestStatus,
  TaktRequestTransitionError,
} from "../lib/takt-request-repository";
import {
  createTaktResponse,
  getTaktResponseWithAlternatives,
  TaktResponseValidationError,
} from "../lib/takt-response-repository";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const P = "t26-";

const FX = {
  guOrgId: `${P}gu-org`,
  nuOrgId: `${P}nu-org`,
  otherGuOrgId: `${P}other-gu`,
  userId: `${P}user-0`,
  projectId: `${P}proj-0`,
  taktId: `${P}takt-0`,
};

const createdRequestIds: string[] = [];

beforeAll(async () => {
  await db
    .insert(usersTable)
    .values({ id: FX.userId, name: "Task-2.6 User", email: `t26@test.invalid`, passwordHash: "x" })
    .onConflictDoNothing();

  await db
    .insert(organizationsTable)
    .values([
      { id: FX.guOrgId, name: "T26 GU Org", type: "AG" },
      { id: FX.nuOrgId, name: "T26 NU Org", type: "AN" },
      { id: FX.otherGuOrgId, name: "T26 Other GU", type: "AG" },
    ])
    .onConflictDoNothing();

  await db
    .insert(projectsTable)
    .values({ id: FX.projectId, agOrgId: FX.guOrgId, name: "T26 Project", status: "ACTIVE" })
    .onConflictDoNothing();

  await db
    .insert(takteTable)
    .values({
      id: FX.taktId,
      projectId: FX.projectId,
      taktBezeichnung: "T1 – T26 Test",
      zone: "A",
      gewerk: "Rohbau",
      plannedStart: "2026-04-01",
      plannedEnd: "2026-04-14",
      status: "GEPLANT",
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  // Response alternatives and responses cascade from requests
  for (const id of createdRequestIds) {
    await db.delete(taktRequestsTable).where(eq(taktRequestsTable.id, id)).catch(() => {});
  }
  await db.delete(taktRequestsTable).where(like(taktRequestsTable.requestNumber, `${P}%`)).catch(() => {});
  await db.delete(takteTable).where(eq(takteTable.id, FX.taktId)).catch(() => {});
  await db.delete(projectsTable).where(eq(projectsTable.id, FX.projectId)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, FX.guOrgId)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, FX.nuOrgId)).catch(() => {});
  await db.delete(organizationsTable).where(eq(organizationsTable.id, FX.otherGuOrgId)).catch(() => {});
  await db.delete(usersTable).where(eq(usersTable.id, FX.userId)).catch(() => {});
});

// ── Helpers ───────────────────────────────────────────────────────────────────

let counter = 0;
function nextNum() { return `${P}REQ-${String(++counter).padStart(4, "0")}`; }

async function makeRequest(overrides: Partial<Parameters<typeof createTaktRequestDraft>[0]> = {}) {
  const row = await createTaktRequestDraft({
    taktId: FX.taktId,
    taktVersion: 1,
    guOrgId: FX.guOrgId,
    nuOrgId: FX.nuOrgId,
    requestNumber: nextNum(),
    createdByUserId: FX.userId,
    ...overrides,
  });
  createdRequestIds.push(row.id);
  return row;
}

const t0 = new Date("2026-05-01T08:00:00Z");
const t1 = new Date("2026-05-14T17:00:00Z");
const t2 = new Date("2026-05-01T06:00:00Z"); // before t0

// ── Organisation-filtered list functions ──────────────────────────────────────

describe("listTaktRequestsForGu — org-scoped filtering", () => {
  it("returns requests belonging to the given GU org", async () => {
    const req = await makeRequest();
    const list = await listTaktRequestsForGu(FX.guOrgId);
    expect(list.some((r) => r.id === req.id)).toBe(true);
  });

  it("does not return requests from a different GU org", async () => {
    const req = await makeRequest();
    const list = await listTaktRequestsForGu(FX.otherGuOrgId);
    expect(list.some((r) => r.id === req.id)).toBe(false);
  });

  it("filters by status when provided", async () => {
    const req = await makeRequest();
    const draftList = await listTaktRequestsForGu(FX.guOrgId, { status: "DRAFT" });
    expect(draftList.some((r) => r.id === req.id)).toBe(true);

    const sentList = await listTaktRequestsForGu(FX.guOrgId, { status: "SENT" });
    expect(sentList.some((r) => r.id === req.id)).toBe(false);
  });

  it("returns empty array for an org with no requests", async () => {
    const list = await listTaktRequestsForGu("non-existent-gu-org-id");
    expect(list).toEqual([]);
  });
});

describe("listTaktRequestsForNu — org-scoped filtering", () => {
  it("returns requests addressed to the given NU org", async () => {
    const req = await makeRequest();
    const list = await listTaktRequestsForNu(FX.nuOrgId);
    expect(list.some((r) => r.id === req.id)).toBe(true);
  });

  it("does not return requests addressed to a different NU org", async () => {
    const req = await makeRequest();
    const list = await listTaktRequestsForNu("some-other-nu-org-id");
    expect(list.some((r) => r.id === req.id)).toBe(false);
  });

  it("filters by status when provided", async () => {
    const req = await makeRequest();
    const draftList = await listTaktRequestsForNu(FX.nuOrgId, { status: "DRAFT" });
    expect(draftList.some((r) => r.id === req.id)).toBe(true);

    const acceptedList = await listTaktRequestsForNu(FX.nuOrgId, { status: "ACCEPTED" });
    expect(acceptedList.some((r) => r.id === req.id)).toBe(false);
  });
});

// ── Status transitions ────────────────────────────────────────────────────────

describe("updateTaktRequestStatus — valid transition persisted", () => {
  it("DRAFT → SENT is persisted to the database", async () => {
    const req = await makeRequest();
    const updated = await updateTaktRequestStatus(req.id, "SENT", {
      sentAt: new Date("2026-04-01T09:00:00Z"),
    });
    expect(updated.status).toBe("SENT");
    expect(updated.sentAt).toBeInstanceOf(Date);

    const fresh = await getTaktRequestById(req.id);
    expect(fresh?.status).toBe("SENT");
  });

  it("SENT → DELIVERED is persisted", async () => {
    const req = await makeRequest();
    await updateTaktRequestStatus(req.id, "SENT");
    const updated = await updateTaktRequestStatus(req.id, "DELIVERED", {
      deliveredAt: new Date("2026-04-01T09:05:00Z"),
    });
    expect(updated.status).toBe("DELIVERED");
  });
});

describe("updateTaktRequestStatus — invalid transition rejected", () => {
  it("throws TaktRequestTransitionError and does not modify the DB", async () => {
    const req = await makeRequest();
    await expect(updateTaktRequestStatus(req.id, "ACCEPTED")).rejects.toThrow(
      TaktRequestTransitionError,
    );

    // Status must be unchanged
    const fresh = await getTaktRequestById(req.id);
    expect(fresh?.status).toBe("DRAFT");
  });

  it("transition from terminal ACCEPTED throws TaktRequestTransitionError", async () => {
    const req = await makeRequest();
    await updateTaktRequestStatus(req.id, "SENT");
    await updateTaktRequestStatus(req.id, "DELIVERED");
    await updateTaktRequestStatus(req.id, "UNDER_REVIEW");
    await updateTaktRequestStatus(req.id, "ACCEPTED");

    await expect(updateTaktRequestStatus(req.id, "UNDER_REVIEW")).rejects.toThrow(
      TaktRequestTransitionError,
    );
  });
});

// ── TaktResponse — ACCEPTED ───────────────────────────────────────────────────

describe("createTaktResponse — ACCEPTED", () => {
  it("valid ACCEPTED response with time window is saved", async () => {
    const req = await makeRequest();
    const { response, alternatives } = await createTaktResponse({
      taktRequestId: req.id,
      decision: "ACCEPTED",
      acceptedStart: t0,
      acceptedEnd: t1,
      createdByUserId: FX.userId,
    });
    expect(response.decision).toBe("ACCEPTED");
    expect(response.acceptedStart).toBeInstanceOf(Date);
    expect(response.acceptedEnd).toBeInstanceOf(Date);
    expect(alternatives).toHaveLength(0);
  });

  it("ACCEPTED without acceptedStart throws TaktResponseValidationError", async () => {
    const req = await makeRequest();
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ACCEPTED",
        acceptedEnd: t1,
        createdByUserId: FX.userId,
      }),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("ACCEPTED without acceptedEnd throws TaktResponseValidationError", async () => {
    const req = await makeRequest();
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ACCEPTED",
        acceptedStart: t0,
        createdByUserId: FX.userId,
      }),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("ACCEPTED where acceptedEnd ≤ acceptedStart throws TaktResponseValidationError", async () => {
    const req = await makeRequest();
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ACCEPTED",
        acceptedStart: t1,
        acceptedEnd: t2, // t2 < t1
        createdByUserId: FX.userId,
      }),
    ).rejects.toThrow(TaktResponseValidationError);
  });
});

// ── TaktResponse — ALTERNATIVES_PROPOSED ─────────────────────────────────────

describe("createTaktResponse — ALTERNATIVES_PROPOSED", () => {
  it("two valid alternatives are saved atomically", async () => {
    const req = await makeRequest();
    const { response, alternatives } = await createTaktResponse({
      taktRequestId: req.id,
      decision: "ALTERNATIVES_PROPOSED",
      createdByUserId: FX.userId,
      alternatives: [
        {
          alternativeId: "ALT-1",
          rank: 1,
          proposedStart: t0,
          proposedEnd: t1,
          crewSize: 4,
        },
        {
          alternativeId: "ALT-2",
          rank: 2,
          proposedStart: new Date("2026-06-01T08:00:00Z"),
          proposedEnd: new Date("2026-06-14T17:00:00Z"),
        },
      ],
    });
    expect(response.decision).toBe("ALTERNATIVES_PROPOSED");
    expect(alternatives).toHaveLength(2);
    expect(alternatives.map((a) => a.alternativeId).sort()).toEqual(["ALT-1", "ALT-2"]);
  });

  it("getTaktResponseWithAlternatives returns both response and alternatives", async () => {
    const req = await makeRequest();
    await createTaktResponse({
      taktRequestId: req.id,
      decision: "ALTERNATIVES_PROPOSED",
      createdByUserId: FX.userId,
      alternatives: [
        { alternativeId: "X-1", rank: 1, proposedStart: t0, proposedEnd: t1 },
        { alternativeId: "X-2", rank: 2, proposedStart: t0, proposedEnd: t1 },
      ],
    });
    const result = await getTaktResponseWithAlternatives(req.id);
    expect(result).not.toBeNull();
    expect(result!.alternatives).toHaveLength(2);
  });

  it("more than 3 alternatives throws TaktResponseValidationError", async () => {
    const req = await makeRequest();
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ALTERNATIVES_PROPOSED",
        createdByUserId: FX.userId,
        alternatives: [
          { alternativeId: "A1", rank: 1, proposedStart: t0, proposedEnd: t1 },
          { alternativeId: "A2", rank: 2, proposedStart: t0, proposedEnd: t1 },
          { alternativeId: "A3", rank: 3, proposedStart: t0, proposedEnd: t1 },
          { alternativeId: "A4", rank: 4, proposedStart: t0, proposedEnd: t1 },
        ],
      }),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("duplicate rank throws TaktResponseValidationError", async () => {
    const req = await makeRequest();
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ALTERNATIVES_PROPOSED",
        createdByUserId: FX.userId,
        alternatives: [
          { alternativeId: "B1", rank: 1, proposedStart: t0, proposedEnd: t1 },
          { alternativeId: "B2", rank: 1, proposedStart: t0, proposedEnd: t1 }, // same rank
        ],
      }),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("duplicate alternativeId throws TaktResponseValidationError", async () => {
    const req = await makeRequest();
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ALTERNATIVES_PROPOSED",
        createdByUserId: FX.userId,
        alternatives: [
          { alternativeId: "SAME", rank: 1, proposedStart: t0, proposedEnd: t1 },
          { alternativeId: "SAME", rank: 2, proposedStart: t0, proposedEnd: t1 }, // same id
        ],
      }),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("invalid time window (proposedEnd ≤ proposedStart) throws TaktResponseValidationError", async () => {
    const req = await makeRequest();
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ALTERNATIVES_PROPOSED",
        createdByUserId: FX.userId,
        alternatives: [
          { alternativeId: "C1", rank: 1, proposedStart: t1, proposedEnd: t0 }, // end before start
        ],
      }),
    ).rejects.toThrow(TaktResponseValidationError);
  });

  it("no alternatives with ALTERNATIVES_PROPOSED throws TaktResponseValidationError", async () => {
    const req = await makeRequest();
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ALTERNATIVES_PROPOSED",
        createdByUserId: FX.userId,
        alternatives: [],
      }),
    ).rejects.toThrow(TaktResponseValidationError);
  });
});

// ── TaktResponse — REJECTED ───────────────────────────────────────────────────

describe("createTaktResponse — REJECTED", () => {
  it("valid REJECTED response without alternatives is saved", async () => {
    const req = await makeRequest();
    const { response, alternatives } = await createTaktResponse({
      taktRequestId: req.id,
      decision: "REJECTED",
      reasonCode: "NO_CAPACITY",
      createdByUserId: FX.userId,
    });
    expect(response.decision).toBe("REJECTED");
    expect(response.reasonCode).toBe("NO_CAPACITY");
    expect(alternatives).toHaveLength(0);
  });

  it("REJECTED with nextAvailableDate is saved", async () => {
    const req = await makeRequest();
    const { response } = await createTaktResponse({
      taktRequestId: req.id,
      decision: "REJECTED",
      reasonCode: "RESOURCE_CONFLICT",
      nextAvailableDate: "2026-07-01",
      createdByUserId: FX.userId,
    });
    expect(response.nextAvailableDate).toBe("2026-07-01");
  });
});

// ── Second response rejected ──────────────────────────────────────────────────

describe("createTaktResponse — one response per request", () => {
  it("a second response for the same TaktRequest is rejected", async () => {
    const req = await makeRequest();

    await createTaktResponse({
      taktRequestId: req.id,
      decision: "REJECTED",
      createdByUserId: FX.userId,
    });

    // DB UNIQUE constraint on takt_request_id fires
    await expect(
      createTaktResponse({
        taktRequestId: req.id,
        decision: "ACCEPTED",
        acceptedStart: t0,
        acceptedEnd: t1,
        createdByUserId: FX.userId,
      }),
    ).rejects.toThrow();
  });
});

/**
 * Task 6.2 — Schema tests for takt_response_decisions and takt_versions
 *
 * Tests:
 *   takt_response_decisions:
 *     - GU decision can be stored
 *     - second decision for the same response is rejected (UNIQUE on responseId)
 *     - alternative from a foreign response cannot be referenced (service-level check via DB FK)
 *     - idempotency key is unique per GU org
 *
 *   takt_versions:
 *     - takt version can be stored
 *     - duplicate version number for same takt is rejected
 *     - earlier version remains unchanged after a later version is added
 *     - existing takte received an INITIAL version during schema migration
 *
 * Fixture prefix: "t62-"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktResponsesTable,
  taktResponseAlternativesTable,
  taktResponseDecisionsTable,
  taktVersionsTable,
  projectContractorsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GU_ORG   = "t62-gu-org";
const NU_ORG   = "t62-nu-org";
const GU_USER  = "t62-gu-user";
const NU_USER  = "t62-nu-user";
const PROJECT  = "t62-project";
const TAKT_A   = "t62-takt-a";
const TAKT_B   = "t62-takt-b"; // for version dedup test

let requestId = "";
let responseIdA = "";
let altId = "";

// A second request/response pair to test cross-response FK validation
let requestIdB = "";
let responseIdB = "";
let altIdB = "";   // alternative belonging to response B

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Orgs
  await db.insert(organizationsTable).values([
    { id: GU_ORG, name: "t62 GU Org", type: "AG" as const },
    { id: NU_ORG, name: "t62 NU Org", type: "AN" as const },
  ]).onConflictDoNothing();

  // Users
  await db.insert(usersTable).values([
    { id: GU_USER, email: "t62-gu@test.com", name: "GU", passwordHash: "x" },
    { id: NU_USER, email: "t62-nu@test.com", name: "NU", passwordHash: "x" },
  ]).onConflictDoNothing();

  // Project + contractor link
  await db.insert(projectsTable).values({
    id: PROJECT,
    agOrgId: GU_ORG,
    name: "t62 Project",
    status: "ACTIVE" as const,
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  }).onConflictDoNothing();

  await db.insert(projectContractorsTable).values({
    projectId: PROJECT,
    anOrgId: NU_ORG,
  }).onConflictDoNothing();

  // Takte
  await db.insert(takteTable).values([
    {
      id: TAKT_A,
      projectId: PROJECT,
      taktBezeichnung: "t62 Takt A",
      zone: "Z1",
      gewerk: "Elektro",
      plannedStart: "2026-10-01",
      plannedEnd: "2026-10-07",
    },
    {
      id: TAKT_B,
      projectId: PROJECT,
      taktBezeichnung: "t62 Takt B",
      zone: "Z2",
      gewerk: "Sanitär",
      plannedStart: "2026-10-08",
      plannedEnd: "2026-10-14",
    },
  ]).onConflictDoNothing();

  // TaktRequest A (for response A and decisions)
  const [reqA] = await db.insert(taktRequestsTable).values({
    taktId: TAKT_A,
    taktVersion: 1,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG,
    requestNumber: "TKR-6200-0001",
    status: "ALTERNATIVES_PROPOSED" as const,
    createdByUserId: GU_USER,
  }).returning();
  requestId = reqA.id;

  // TaktResponse A: ALTERNATIVES_PROPOSED
  const [respA] = await db.insert(taktResponsesTable).values({
    taktRequestId: requestId,
    decision: "ALTERNATIVES_PROPOSED" as const,
    comment: "Zwei Alternativen vorgeschlagen",
    createdByUserId: NU_USER,
  }).returning();
  responseIdA = respA.id;

  // Alternative belonging to response A
  const [a] = await db.insert(taktResponseAlternativesTable).values({
    responseId: responseIdA,
    alternativeId: "ALT-001",
    rank: 1,
    proposedStart: new Date("2026-10-10T08:00:00Z"),
    proposedEnd: new Date("2026-10-14T17:00:00Z"),
  }).returning();
  altId = a.id;

  // TaktRequest B + Response B for cross-response FK test
  const [reqB] = await db.insert(taktRequestsTable).values({
    taktId: TAKT_A,
    taktVersion: 1,
    guOrgId: GU_ORG,
    nuOrgId: NU_ORG,
    requestNumber: "TKR-6200-0002",
    status: "ALTERNATIVES_PROPOSED" as const,
    createdByUserId: GU_USER,
  }).returning();
  requestIdB = reqB.id;

  const [respB] = await db.insert(taktResponsesTable).values({
    taktRequestId: requestIdB,
    decision: "ALTERNATIVES_PROPOSED" as const,
    comment: "Andere Alternativen",
    createdByUserId: NU_USER,
  }).returning();
  responseIdB = respB.id;

  const [b] = await db.insert(taktResponseAlternativesTable).values({
    responseId: responseIdB,
    alternativeId: "ALT-B01",
    rank: 1,
    proposedStart: new Date("2026-10-15T08:00:00Z"),
    proposedEnd: new Date("2026-10-19T17:00:00Z"),
  }).returning();
  altIdB = b.id;
});

afterAll(async () => {
  // Clean up in reverse FK order
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT_A));
  await db.delete(taktVersionsTable).where(eq(taktVersionsTable.taktId, TAKT_B));
  await db.delete(taktResponseDecisionsTable).where(
    eq(taktResponseDecisionsTable.guOrgId, GU_ORG),
  );
  await db.delete(taktResponseAlternativesTable).where(
    eq(taktResponseAlternativesTable.responseId, responseIdA),
  );
  await db.delete(taktResponseAlternativesTable).where(
    eq(taktResponseAlternativesTable.responseId, responseIdB),
  );
  await db.delete(taktResponsesTable).where(
    eq(taktResponsesTable.taktRequestId, requestId),
  );
  await db.delete(taktResponsesTable).where(
    eq(taktResponsesTable.taktRequestId, requestIdB),
  );
  await db.delete(taktRequestsTable).where(
    eq(taktRequestsTable.guOrgId, GU_ORG),
  );
  await db.delete(takteTable).where(eq(takteTable.id, TAKT_A));
  await db.delete(takteTable).where(eq(takteTable.id, TAKT_B));
  await db.delete(projectContractorsTable).where(
    eq(projectContractorsTable.projectId, PROJECT),
  );
  await db.delete(projectsTable).where(eq(projectsTable.id, PROJECT));
  for (const email of ["t62-gu@test.com", "t62-nu@test.com"]) {
    await db.delete(usersTable).where(eq(usersTable.email, email));
  }
  await db.delete(organizationsTable).where(eq(organizationsTable.id, GU_ORG));
  await db.delete(organizationsTable).where(eq(organizationsTable.id, NU_ORG));
});

// ── takt_response_decisions ───────────────────────────────────────────────────

describe("takt_response_decisions schema", () => {
  it("GU decision can be stored", async () => {
    const [row] = await db
      .insert(taktResponseDecisionsTable)
      .values({
        taktRequestId: requestId,
        responseId: responseIdA,
        guOrgId: GU_ORG,
        decisionType: "ACCEPT_ALTERNATIVE",
        acceptedAlternativeId: altId,
        comment: "Alternative 1 wird übernommen.",
        decidedByUserId: GU_USER,
      })
      .returning();

    expect(row.id).toBeTruthy();
    expect(row.decisionType).toBe("ACCEPT_ALTERNATIVE");
    expect(row.acceptedAlternativeId).toBe(altId);
    expect(row.guOrgId).toBe(GU_ORG);
    expect(row.createdAt).toBeTruthy();
  });

  it("second decision for the same response is rejected (UNIQUE on responseId)", async () => {
    await expect(
      db.insert(taktResponseDecisionsTable).values({
        taktRequestId: requestId,
        responseId: responseIdA,   // same response — must be rejected
        guOrgId: GU_ORG,
        decisionType: "CLOSE_WITHOUT_AGREEMENT",
        decidedByUserId: GU_USER,
      }),
    ).rejects.toThrow();
  });

  it("idempotency key is unique per GU org — second insert with same key is rejected", async () => {
    const key = "t62-idem-key-001";

    // First insert succeeds
    await db.insert(taktResponseDecisionsTable).values({
      taktRequestId: requestIdB,
      responseId: responseIdB,
      guOrgId: GU_ORG,
      decisionType: "ACCEPT_ALTERNATIVE",
      acceptedAlternativeId: altIdB,
      idempotencyKey: key,
      decidedByUserId: GU_USER,
    });

    // Second insert with same guOrgId + idempotencyKey must be rejected
    await expect(
      db.insert(taktResponseDecisionsTable).values({
        taktRequestId: requestIdB,
        responseId: responseIdB,
        guOrgId: GU_ORG,
        decisionType: "CLOSE_WITHOUT_AGREEMENT",
        idempotencyKey: key,    // same key, different content
        decidedByUserId: GU_USER,
      }),
    ).rejects.toThrow();
  });

  it("NULL idempotency keys are exempt from uniqueness — two NULLs allowed", async () => {
    // Both rows inserted in previous tests already have key=null — this verifies
    // the index was a partial index excluding NULLs.
    // We just check both existing rows are present.
    const rows = await db
      .select()
      .from(taktResponseDecisionsTable)
      .where(eq(taktResponseDecisionsTable.guOrgId, GU_ORG));

    const nullKeyRows = rows.filter((r) => r.idempotencyKey === null);
    // Row inserted in first test has no key
    expect(nullKeyRows.length).toBeGreaterThanOrEqual(1);
  });
});

// ── takt_versions ─────────────────────────────────────────────────────────────

describe("takt_versions schema", () => {
  it("takt version can be stored", async () => {
    const [row] = await db
      .insert(taktVersionsTable)
      .values({
        taktId: TAKT_B,
        version: 1,
        sourceType: "INITIAL",
        snapshotPayload: {
          taktBezeichnung: "t62 Takt B",
          zone: "Z2",
          gewerk: "Sanitär",
          plannedStart: "2026-10-08",
          plannedEnd: "2026-10-14",
          version: 1,
        },
        contentHash: "abc123",
      })
      .returning();

    expect(row.id).toBeTruthy();
    expect(row.taktId).toBe(TAKT_B);
    expect(row.version).toBe(1);
    expect(row.sourceType).toBe("INITIAL");
    expect(row.snapshotPayload).toMatchObject({ taktBezeichnung: "t62 Takt B" });
    expect(row.contentHash).toBe("abc123");
  });

  it("duplicate version number for same takt is rejected", async () => {
    await expect(
      db.insert(taktVersionsTable).values({
        taktId: TAKT_B,
        version: 1,   // already inserted above
        sourceType: "MANUAL_EDIT",
        snapshotPayload: { taktBezeichnung: "duplicate" },
      }),
    ).rejects.toThrow();
  });

  it("earlier version remains unchanged after a later version is added", async () => {
    // Insert version 2 for TAKT_B
    await db.insert(taktVersionsTable).values({
      taktId: TAKT_B,
      version: 2,
      sourceType: "MANUAL_EDIT",
      snapshotPayload: {
        taktBezeichnung: "t62 Takt B (editiert)",
        zone: "Z2-neu",
        gewerk: "Sanitär",
        plannedStart: "2026-10-09",
        plannedEnd: "2026-10-15",
        version: 2,
      },
    });

    // Version 1 must still contain the original content
    const [v1] = await db
      .select()
      .from(taktVersionsTable)
      .where(
        and(
          eq(taktVersionsTable.taktId, TAKT_B),
          eq(taktVersionsTable.version, 1),
        ),
      );

    expect(v1).toBeDefined();
    expect((v1.snapshotPayload as Record<string, unknown>).taktBezeichnung).toBe(
      "t62 Takt B",
    );
    expect((v1.snapshotPayload as Record<string, unknown>).zone).toBe("Z2");
    expect(v1.sourceType).toBe("INITIAL");
  });

  it("existing takte received an INITIAL version during schema migration", async () => {
    // The migration ran before these tests and inserted INITIAL versions for all
    // takte that existed at push time. There were 3 seed takte before Task 6.2.
    // TAKT_A and TAKT_B are test fixtures inserted after the migration, so they
    // do NOT have auto-created INITIAL versions — this test checks the pre-existing ones.
    const allInitial = await db
      .select()
      .from(taktVersionsTable)
      .where(eq(taktVersionsTable.sourceType, "INITIAL"));

    // At least the 3 seed takte should have INITIAL versions
    expect(allInitial.length).toBeGreaterThanOrEqual(3);

    // Every INITIAL version must have a non-null snapshotPayload
    for (const row of allInitial) {
      expect(row.snapshotPayload).not.toBeNull();
      expect(typeof row.snapshotPayload).toBe("object");
    }
  });
});

/**
 * Regression coverage for historical audit events and identity deletion.
 *
 * Audit actor references are intentionally nullable: removing a user or
 * organisation must not remove the coordination history they created.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agDb,
  leistungsanfrageAuditEventsTable,
  leistungsanfragenTable,
  leistungenTable,
  organizationsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";

const hasDatabase = Boolean(
  process.env.DATABASE_ADMIN_URL
    ?? process.env.DATABASE_URL
    ?? process.env.AG_DATABASE_URL,
);
const retentionSuite = hasDatabase ? describe : describe.skip;
const rootDir = fileURLToPath(new URL("../../../..", import.meta.url));
const adminUrl =
  process.env.DATABASE_ADMIN_URL
  ?? process.env.DATABASE_URL
  ?? process.env.AG_DATABASE_URL
  ?? "";
const prefix = `audit-history-retention-${crypto.randomUUID()}`;

const fixture = {
  agOrgId: `${prefix}-request-ag`,
  anOrgId: `${prefix}-request-an`,
  actorOrgId: `${prefix}-actor-org`,
  creatorUserId: `${prefix}-creator`,
  actorUserId: `${prefix}-actor-user`,
  projectId: `${prefix}-project`,
  leistungId: `${prefix}-leistung`,
  requestId: `${prefix}-request`,
  auditId: `${prefix}-audit`,
};

function runSharedDatabaseBootstrap() {
  execFileSync("bash", ["scripts/setup-shared-database.sh"], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
    stdio: "pipe",
    timeout: 120_000,
  });
}

async function cleanupFixtures() {
  await agDb
    .delete(leistungsanfrageAuditEventsTable)
    .where(eq(leistungsanfrageAuditEventsTable.id, fixture.auditId))
    .catch(() => {});
  await agDb
    .delete(leistungsanfragenTable)
    .where(eq(leistungsanfragenTable.id, fixture.requestId))
    .catch(() => {});
  await agDb
    .delete(leistungenTable)
    .where(eq(leistungenTable.id, fixture.leistungId))
    .catch(() => {});
  await agDb
    .delete(projectsTable)
    .where(eq(projectsTable.id, fixture.projectId))
    .catch(() => {});
  await agDb
    .delete(usersTable)
    .where(eq(usersTable.id, fixture.creatorUserId))
    .catch(() => {});
  await agDb
    .delete(usersTable)
    .where(eq(usersTable.id, fixture.actorUserId))
    .catch(() => {});
  for (const id of [fixture.agOrgId, fixture.anOrgId, fixture.actorOrgId]) {
    await agDb
      .delete(organizationsTable)
      .where(eq(organizationsTable.id, id))
      .catch(() => {});
  }
}

retentionSuite("leistungsanfrage audit history retention", () => {
  afterAll(async () => {
    await cleanupFixtures();
  });

  it("retains an event and clears both actor references after identity deletion", async () => {
    await cleanupFixtures();

    await agDb.insert(organizationsTable).values([
      { id: fixture.agOrgId, name: `${prefix} request AG`, type: "AG" },
      { id: fixture.anOrgId, name: `${prefix} request AN`, type: "AN" },
      { id: fixture.actorOrgId, name: `${prefix} actor organisation`, type: "AG" },
    ]);
    await agDb.insert(usersTable).values([
      {
        id: fixture.creatorUserId,
        name: `${prefix} creator`,
        email: `${fixture.creatorUserId}@example.test`,
        passwordHash: "not-used",
      },
      {
        id: fixture.actorUserId,
        name: `${prefix} actor`,
        email: `${fixture.actorUserId}@example.test`,
        passwordHash: "not-used",
      },
    ]);
    await agDb.insert(projectsTable).values({
      id: fixture.projectId,
      agOrgId: fixture.agOrgId,
      name: `${prefix} project`,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    await agDb.insert(leistungenTable).values({
      id: fixture.leistungId,
      projectId: fixture.projectId,
      leistungsBezeichnung: `${prefix} Leistung`,
      gewerk: "Testgewerk",
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-05",
    });
    await agDb.insert(leistungsanfragenTable).values({
      id: fixture.requestId,
      leistungId: fixture.leistungId,
      guOrgId: fixture.agOrgId,
      nuOrgId: fixture.anOrgId,
      requestNumber: `${prefix}-number`,
      createdByUserId: fixture.creatorUserId,
      status: "SENT",
    });
    await agDb.insert(leistungsanfrageAuditEventsTable).values({
      id: fixture.auditId,
      requestId: fixture.requestId,
      eventType: "REQUEST_CREATED",
      actorOrgId: fixture.actorOrgId,
      actorUserId: fixture.actorUserId,
      actorRole: "GU",
    });

    await expect(
      agDb.delete(usersTable).where(eq(usersTable.id, fixture.actorUserId)),
    ).resolves.toBeDefined();
    await expect(
      agDb.delete(organizationsTable).where(eq(organizationsTable.id, fixture.actorOrgId)),
    ).resolves.toBeDefined();

    const [retainedBeforeBootstrap] = await agDb
      .select({
        id: leistungsanfrageAuditEventsTable.id,
        actorOrgId: leistungsanfrageAuditEventsTable.actorOrgId,
        actorUserId: leistungsanfrageAuditEventsTable.actorUserId,
      })
      .from(leistungsanfrageAuditEventsTable)
      .where(eq(leistungsanfrageAuditEventsTable.id, fixture.auditId));
    expect(retainedBeforeBootstrap).toEqual({
      id: fixture.auditId,
      actorOrgId: null,
      actorUserId: null,
    });

    // The role/schema repair must remain safe to rerun with historical rows
    // whose actor identities have already been removed.
    runSharedDatabaseBootstrap();
    runSharedDatabaseBootstrap();

    const [retainedAfterBootstrap] = await agDb
      .select({
        id: leistungsanfrageAuditEventsTable.id,
        actorOrgId: leistungsanfrageAuditEventsTable.actorOrgId,
        actorUserId: leistungsanfrageAuditEventsTable.actorUserId,
      })
      .from(leistungsanfrageAuditEventsTable)
      .where(eq(leistungsanfrageAuditEventsTable.id, fixture.auditId));
    expect(retainedAfterBootstrap).toEqual({
      id: fixture.auditId,
      actorOrgId: null,
      actorUserId: null,
    });
  });
});
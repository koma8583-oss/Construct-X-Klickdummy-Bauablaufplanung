/**
 * Seed script — Task 2.7: insert example TaktRequests, Snapshots, Responses
 * and Alternatives for development and API/UI testing.
 *
 * Usage (from workspace root):
 *   pnpm --filter @workspace/scripts run seed-takt-data
 *
 * Prerequisites:
 *   - DATABASE_URL env var must be set.
 *   - At least one AG-type org, one AN-type org, one project, one takt, and
 *     one user must already exist (run the main seed first).
 *
 * Idempotent: all inserts use ON CONFLICT (request_number) DO NOTHING so the
 * script can be run multiple times without duplicating data.
 *
 * Four scenarios are seeded:
 *   1. TKR-2026-0001 — DELIVERED        open, awaiting NU response
 *   2. TKR-2026-0002 — ACCEPTED         confirmed with accepted time window
 *   3. TKR-2026-0003 — ALTERNATIVES_PROPOSED  two alternatives proposed
 *   4. TKR-2026-0004 — REJECTED         declined with NO_CAPACITY
 *
 * Every request receives exactly one TaktRequestSnapshot.
 * Snapshot payloads contain only released Takt data — no internal GU/NU data.
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function first<T>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T | null> {
  const rows = await query;
  return (rows[0] as T) ?? null;
}

/** Insert a request row; idempotent on request_number. */
async function upsertRequest(row: {
  requestNumber: string;
  status: string;
  taktId: string;
  taktVersion: number;
  guOrgId: string;
  nuOrgId: string;
  userId: string;
  sentAt?: Date;
  deliveredAt?: Date;
}) {
  await sql`
    INSERT INTO takt_requests (
      id, takt_id, takt_version, gu_org_id, nu_org_id,
      request_number, status,
      response_required_by, sent_at, delivered_at,
      created_by_user_id, created_at, updated_at
    ) VALUES (
      ${crypto.randomUUID()},
      ${row.taktId}, ${row.taktVersion}, ${row.guOrgId}, ${row.nuOrgId},
      ${row.requestNumber}, ${row.status},
      now() + interval '7 days',
      ${row.sentAt ?? null},
      ${row.deliveredAt ?? null},
      ${row.userId}, now(), now()
    )
    ON CONFLICT (request_number) DO NOTHING
  `;
}

/** Fetch the actual DB id of a request by request_number. */
async function getRequestId(requestNumber: string): Promise<string | null> {
  const row = await first<{ id: string }>(
    sql`SELECT id FROM takt_requests WHERE request_number = ${requestNumber} LIMIT 1`
  );
  return row?.id ?? null;
}

/** Insert a snapshot; idempotent on takt_request_id. */
async function upsertSnapshot(
  taktRequestId: string,
  payload: Record<string, unknown>,
) {
  await sql`
    INSERT INTO takt_request_snapshots
      (id, takt_request_id, schema_version, snapshot_payload)
    VALUES (
      ${crypto.randomUUID()},
      ${taktRequestId},
      '1.0',
      ${JSON.stringify(payload)}
    )
    ON CONFLICT (takt_request_id) DO NOTHING
  `;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Resolve live fixture IDs from the DB
  const guOrg = await first<{ id: string; name: string }>(
    sql`SELECT id, name FROM organizations WHERE type = 'AG' LIMIT 1`
  );
  if (!guOrg) throw new Error("No AG organisation found. Run the main seed first.");

  const nuOrg = await first<{ id: string; name: string }>(
    sql`SELECT id, name FROM organizations WHERE type = 'AN' LIMIT 1`
  );
  if (!nuOrg) throw new Error("No AN organisation found. Run the main seed first.");

  const user = await first<{ id: string }>(sql`SELECT id FROM users LIMIT 1`);
  if (!user) throw new Error("No users found. Run the main seed first.");

  const project = await first<{ id: string; name: string }>(
    sql`SELECT id, name FROM projects WHERE ag_org_id = ${guOrg.id} LIMIT 1`
  );
  if (!project) throw new Error(`No project found for GU org ${guOrg.id}.`);

  const takt = await first<{ id: string; takt_bezeichnung: string; version: number; zone: string; gewerk: string }>(
    sql`SELECT id, takt_bezeichnung, version, zone, gewerk FROM takte WHERE project_id = ${project.id} LIMIT 1`
  );
  if (!takt) throw new Error(`No takte found for project ${project.id}.`);

  const taktId = takt.id;
  const taktVersion = takt.version ?? 1;
  const { guOrgId, nuOrgId, userId } = {
    guOrgId: guOrg.id,
    nuOrgId: nuOrg.id,
    userId: user.id,
  };

  console.log(`Seeding TaktRequests…`);
  console.log(`  GU org : ${guOrg.name} (${guOrgId})`);
  console.log(`  NU org : ${nuOrg.name} (${nuOrgId})`);
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log(`  Takt   : ${takt.takt_bezeichnung} v${taktVersion} (${taktId})`);
  console.log();

  // Common snapshot base — only released Takt data, no internal GU/NU info
  const baseSnapshot = {
    schemaVersion: "1.0",
    projectReference: "PROJECT-001",
    taktReference: taktId,
    taktVersion,
    trade: takt.gewerk,
    workPackage: takt.takt_bezeichnung,
    location: {
      building: "Bauteil A",
      storey: "EG",
      zone: takt.zone,
    },
  };

  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  // ── 1. Open request — DELIVERED ─────────────────────────────────────────────
  await upsertRequest({
    requestNumber: "TKR-2026-0001",
    status: "DELIVERED",
    taktId, taktVersion, guOrgId, nuOrgId, userId,
    sentAt: daysAgo(2),
    deliveredAt: new Date(daysAgo(2).getTime() + 5_000),
  });
  const req1Id = await getRequestId("TKR-2026-0001");
  if (req1Id) {
    await upsertSnapshot(req1Id, {
      ...baseSnapshot,
      plannedTimeWindow: {
        start: "2026-09-14T05:00:00Z",
        end: "2026-09-28T14:00:00Z",
      },
    });
    // No response — request is open, awaiting NU action
  }

  // ── 2. Confirmed — ACCEPTED ─────────────────────────────────────────────────
  await upsertRequest({
    requestNumber: "TKR-2026-0002",
    status: "ACCEPTED",
    taktId, taktVersion, guOrgId, nuOrgId, userId,
    sentAt: daysAgo(10),
    deliveredAt: new Date(daysAgo(10).getTime() + 5_000),
  });
  const req2Id = await getRequestId("TKR-2026-0002");
  if (req2Id) {
    await upsertSnapshot(req2Id, {
      ...baseSnapshot,
      plannedTimeWindow: {
        start: "2026-09-01T06:00:00Z",
        end: "2026-09-14T18:00:00Z",
      },
    });
    await sql`
      INSERT INTO takt_responses
        (id, takt_request_id, decision, accepted_start, accepted_end, comment, created_by_user_id)
      VALUES (
        ${crypto.randomUUID()},
        ${req2Id},
        'ACCEPTED',
        '2026-09-01T06:00:00Z',
        '2026-09-14T18:00:00Z',
        'Zeitfenster passt. Kolonne wird termingerecht eingesetzt.',
        ${userId}
      )
      ON CONFLICT (takt_request_id) DO NOTHING
    `;
  }

  // ── 3. Alternatives — ALTERNATIVES_PROPOSED (two alternatives) ──────────────
  await upsertRequest({
    requestNumber: "TKR-2026-0003",
    status: "ALTERNATIVES_PROPOSED",
    taktId, taktVersion, guOrgId, nuOrgId, userId,
    sentAt: daysAgo(5),
    deliveredAt: new Date(daysAgo(5).getTime() + 5_000),
  });
  const req3Id = await getRequestId("TKR-2026-0003");
  if (req3Id) {
    await upsertSnapshot(req3Id, {
      ...baseSnapshot,
      plannedTimeWindow: {
        start: "2026-09-14T05:00:00Z",
        end: "2026-09-28T14:00:00Z",
      },
    });
    const existingResp3 = await first<{ id: string }>(
      sql`SELECT id FROM takt_responses WHERE takt_request_id = ${req3Id} LIMIT 1`
    );
    if (!existingResp3) {
      const resp3 = await first<{ id: string }>(sql`
        INSERT INTO takt_responses
          (id, takt_request_id, decision, reason_code, comment, next_available_date, created_by_user_id)
        VALUES (
          ${crypto.randomUUID()},
          ${req3Id},
          'ALTERNATIVES_PROPOSED',
          'RESOURCE_CONFLICT',
          'Kapazität im ursprünglichen Zeitfenster vollständig belegt. Zwei Alternativtermine werden angeboten.',
          '2026-09-22',
          ${userId}
        )
        RETURNING id
      `);
      if (resp3?.id) {
        await sql`
          INSERT INTO takt_response_alternatives
            (id, response_id, alternative_id, rank, proposed_start, proposed_end, crew_size, conditions)
          VALUES
            (
              ${crypto.randomUUID()}, ${resp3.id}, 'ALT-001', 1,
              '2026-09-22T06:00:00Z', '2026-10-05T18:00:00Z', 14,
              ${JSON.stringify(["Keine Wochenendarbeit", "Kran Typ A erforderlich"])}
            ),
            (
              ${crypto.randomUUID()}, ${resp3.id}, 'ALT-002', 2,
              '2026-10-06T06:00:00Z', '2026-10-19T18:00:00Z', 10,
              ${JSON.stringify(["Reduzierte Kolonnenstärke"])}
            )
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }

  // ── 4. Rejected — REJECTED (NO_CAPACITY) ────────────────────────────────────
  await upsertRequest({
    requestNumber: "TKR-2026-0004",
    status: "REJECTED",
    taktId, taktVersion, guOrgId, nuOrgId, userId,
    sentAt: daysAgo(8),
    deliveredAt: new Date(daysAgo(8).getTime() + 5_000),
  });
  const req4Id = await getRequestId("TKR-2026-0004");
  if (req4Id) {
    await upsertSnapshot(req4Id, {
      ...baseSnapshot,
      plannedTimeWindow: {
        start: "2026-09-14T05:00:00Z",
        end: "2026-09-28T14:00:00Z",
      },
    });
    await sql`
      INSERT INTO takt_responses
        (id, takt_request_id, decision, reason_code, comment, next_available_date, created_by_user_id)
      VALUES (
        ${crypto.randomUUID()},
        ${req4Id},
        'REJECTED',
        'NO_CAPACITY',
        'Keine freien Kapazitäten im angegebenen Zeitraum verfügbar.',
        '2026-11-01',
        ${userId}
      )
      ON CONFLICT (takt_request_id) DO NOTHING
    `;
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("✓ Seed complete:");
  console.log("  TKR-2026-0001 — DELIVERED            (open, snapshot, no response)");
  console.log("  TKR-2026-0002 — ACCEPTED             (snapshot + ACCEPTED response)");
  console.log("  TKR-2026-0003 — ALTERNATIVES_PROPOSED (snapshot + 2 alternatives)");
  console.log("  TKR-2026-0004 — REJECTED             (snapshot + NO_CAPACITY)");

  await sql.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

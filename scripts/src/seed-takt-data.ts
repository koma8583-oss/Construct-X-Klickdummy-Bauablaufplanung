/**
 * Seed script — Task 2.7: insert example TaktRequests and related rows.
 *
 * Usage (from workspace root):
 *   pnpm --filter @workspace/scripts run seed-takt-data
 *
 * Prerequisites:
 *   - DATABASE_URL env var must be set.
 *   - At least one project, two organizations (one GU, one NU), and one user
 *     must already exist in the database (run the main seed first).
 *
 * This script inserts 4 example TaktRequests covering the most important status paths:
 *   1. Open / DELIVERED   — request sent and received by NU, awaiting response
 *   2. Confirmed / ACCEPTED — GU accepted the NU's acceptance
 *   3. Alternatives / ALTERNATIVES_PROPOSED — NU proposed three time windows
 *   4. Rejected / REJECTED — NU declined with reason code
 *
 * All inserts are idempotent by request_number (ON CONFLICT DO NOTHING).
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function getFirstRecord<T>(
  table: string,
  extraWhere = "",
): Promise<T | null> {
  const rows = await sql.unsafe(
    `SELECT * FROM ${table} ${extraWhere} LIMIT 1`,
  );
  return (rows[0] as T) ?? null;
}

async function main() {
  // ── Resolve existing IDs ────────────────────────────────────────────────────
  const project = await getFirstRecord<{ id: string }>("projects");
  if (!project) {
    throw new Error("No projects found. Run the main seed script first.");
  }

  const firstTakt = await getFirstRecord<{ id: string; version: number }>(
    "takte",
    `WHERE project_id = '${project.id}'`,
  );
  if (!firstTakt) {
    throw new Error("No takte found. Run the main seed script first.");
  }

  const guOrg = await getFirstRecord<{ id: string }>("organizations");
  if (!guOrg) throw new Error("No organizations found.");

  // For the NU org reuse the same org if there's only one (PoC tolerance)
  const nuOrg = await getFirstRecord<{ id: string }>("organizations");
  if (!nuOrg) throw new Error("No organizations found for NU.");

  const user = await getFirstRecord<{ id: string }>("users");
  if (!user) throw new Error("No users found.");

  console.log(
    `Seeding TaktRequests for project ${project.id}, takt ${firstTakt.id} …`,
  );

  const taktId = firstTakt.id;
  const taktVersion = firstTakt.version ?? 1;
  const guOrgId = guOrg.id;
  const nuOrgId = nuOrg.id;
  const userId = user.id;

  // ── Helper: idempotent insert ───────────────────────────────────────────────
  async function insertRequest(row: {
    id: string;
    requestNumber: string;
    status: string;
    sentAt?: string;
    deliveredAt?: string;
  }) {
    await sql`
      INSERT INTO takt_requests (
        id, takt_id, takt_version, gu_org_id, nu_org_id,
        request_number, status,
        response_required_by, sent_at, delivered_at,
        created_by_user_id, created_at, updated_at
      ) VALUES (
        ${row.id}, ${taktId}, ${taktVersion}, ${guOrgId}, ${nuOrgId},
        ${row.requestNumber}, ${row.status},
        now() + interval '7 days',
        ${row.sentAt ?? null},
        ${row.deliveredAt ?? null},
        ${userId}, now(), now()
      )
      ON CONFLICT (request_number) DO NOTHING
    `;
  }

  // ── 1. Open request — DELIVERED ─────────────────────────────────────────────
  const reqOpenId = crypto.randomUUID();
  await insertRequest({
    id: reqOpenId,
    requestNumber: "TKR-2026-0001",
    status: "DELIVERED",
    sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    deliveredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 5000).toISOString(),
  });

  // Snapshot for the open request
  const [snapshotRow] = await sql`
    SELECT id FROM takt_request_snapshots
    WHERE takt_request_id = (
      SELECT id FROM takt_requests WHERE request_number = 'TKR-2026-0001' LIMIT 1
    )
    LIMIT 1
  `;
  if (!snapshotRow) {
    const actualId = (
      await sql`SELECT id FROM takt_requests WHERE request_number = 'TKR-2026-0001' LIMIT 1`
    )[0]?.id;
    if (actualId) {
      await sql`
        INSERT INTO takt_request_snapshots (id, takt_request_id, schema_version, snapshot_payload)
        VALUES (
          ${crypto.randomUUID()},
          ${actualId},
          '1.0',
          ${JSON.stringify({
            taktId: taktId,
            taktVersion: taktVersion,
            taktBezeichnung: "T1 – Rohbau Nord",
            zone: "Nord",
            gewerk: "Rohbau",
            plannedStart: "2026-09-01",
            plannedEnd: "2026-09-14",
            requiredResources: "15 Monteure, Kran Typ A",
            releasedAt: new Date().toISOString(),
            releasedByGu: guOrgId,
          })}
        )
        ON CONFLICT (takt_request_id) DO NOTHING
      `;
    }
  }

  // ── 2. Confirmed — ACCEPTED ─────────────────────────────────────────────────
  const reqConfirmedId = crypto.randomUUID();
  await insertRequest({
    id: reqConfirmedId,
    requestNumber: "TKR-2026-0002",
    status: "ACCEPTED",
    sentAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    deliveredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 5000).toISOString(),
  });
  const actualConfirmedId = (
    await sql`SELECT id FROM takt_requests WHERE request_number = 'TKR-2026-0002' LIMIT 1`
  )[0]?.id;
  if (actualConfirmedId) {
    await sql`
      INSERT INTO takt_responses (id, takt_request_id, decision, accepted_start, accepted_end, created_by_user_id)
      VALUES (
        ${crypto.randomUUID()},
        ${actualConfirmedId},
        'ACCEPTED',
        '2026-09-01T06:00:00Z',
        '2026-09-14T18:00:00Z',
        ${userId}
      )
      ON CONFLICT (takt_request_id) DO NOTHING
    `;
  }

  // ── 3. Alternatives — ALTERNATIVES_PROPOSED ─────────────────────────────────
  const reqAltId = crypto.randomUUID();
  await insertRequest({
    id: reqAltId,
    requestNumber: "TKR-2026-0003",
    status: "ALTERNATIVES_PROPOSED",
    sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    deliveredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 5000).toISOString(),
  });
  const actualAltReqId = (
    await sql`SELECT id FROM takt_requests WHERE request_number = 'TKR-2026-0003' LIMIT 1`
  )[0]?.id;
  if (actualAltReqId) {
    const [altResponseConflict] = await sql`
      SELECT id FROM takt_responses WHERE takt_request_id = ${actualAltReqId} LIMIT 1
    `;
    if (!altResponseConflict) {
      const [altResponse] = await sql`
        INSERT INTO takt_responses (id, takt_request_id, decision, reason_code, comment, next_available_date, created_by_user_id)
        VALUES (
          ${crypto.randomUUID()},
          ${actualAltReqId},
          'ALTERNATIVES_PROPOSED',
          'RESOURCE_CONFLICT',
          'Kapazität in KW36 vollständig belegt. Drei Alternativtermine werden angeboten.',
          '2026-09-22',
          ${userId}
        )
        RETURNING id
      `;
      if (altResponse?.id) {
        await sql`
          INSERT INTO takt_response_alternatives
            (id, response_id, alternative_id, rank, proposed_start, proposed_end, crew_size)
          VALUES
            (${crypto.randomUUID()}, ${altResponse.id}, 'ALT-001', 1, '2026-09-22T06:00:00Z', '2026-10-05T18:00:00Z', 15),
            (${crypto.randomUUID()}, ${altResponse.id}, 'ALT-002', 2, '2026-10-06T06:00:00Z', '2026-10-19T18:00:00Z', 12),
            (${crypto.randomUUID()}, ${altResponse.id}, 'ALT-003', 3, '2026-10-20T06:00:00Z', '2026-11-02T18:00:00Z', 15)
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }

  // ── 4. Rejected — REJECTED ───────────────────────────────────────────────────
  const reqRejectedId = crypto.randomUUID();
  await insertRequest({
    id: reqRejectedId,
    requestNumber: "TKR-2026-0004",
    status: "REJECTED",
    sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    deliveredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000 + 5000).toISOString(),
  });
  const actualRejectedId = (
    await sql`SELECT id FROM takt_requests WHERE request_number = 'TKR-2026-0004' LIMIT 1`
  )[0]?.id;
  if (actualRejectedId) {
    await sql`
      INSERT INTO takt_responses (id, takt_request_id, decision, reason_code, comment, next_available_date, created_by_user_id)
      VALUES (
        ${crypto.randomUUID()},
        ${actualRejectedId},
        'REJECTED',
        'QUALIFICATION_MISSING',
        'Das erforderliche Gewerk liegt außerhalb unseres Leistungsbereichs.',
        '2027-01-01',
        ${userId}
      )
      ON CONFLICT (takt_request_id) DO NOTHING
    `;
  }

  console.log("✓ Seed complete:");
  console.log("  TKR-2026-0001 — DELIVERED   (open, awaiting NU response)");
  console.log("  TKR-2026-0002 — ACCEPTED    (confirmed, with accepted time window)");
  console.log("  TKR-2026-0003 — ALTERNATIVES_PROPOSED (3 alternatives)");
  console.log("  TKR-2026-0004 — REJECTED    (QUALIFICATION_MISSING)");

  await sql.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

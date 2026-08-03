#!/usr/bin/env tsx
/**
 * seed-demo-deadlines.ts — Task 7.8
 *
 * Creates 6 demo TaktRequest scenarios for deadline & reminder testing:
 *
 *  A) Fällig in 48h          — responseRequiredBy ~48h from now, no reminder yet
 *  B) Heute fällig            — responseRequiredBy ~4h from now
 *  C) Überfällig (Kulanzzeit) — responseRequiredBy past, expiresAt future (grace)
 *  D) Abgelaufen              — status=EXPIRED, expiredAt set
 *  E) GU-Entscheidung überfällig — ACCEPTED response, guDecisionRequiredBy in past
 *  F) Erinnerungs-Zustellung fehlgeschlagen — reminder row with FAILED outbox
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-demo-deadlines.ts
 *
 * Environment:
 *   DATABASE_URL  — PostgreSQL connection URL (from .env or env var)
 */

import { db } from '../lib/db/src';
import {
  organizationsTable,
  usersTable,
  projectsTable,
  takteTable,
  taktRequestsTable,
  taktRequestRemindersTable,
} from '../lib/db/src/schema';
import { eq, and } from 'drizzle-orm';

const NOW = new Date();
function addHours(n: number) { return new Date(NOW.getTime() + n * 60 * 60 * 1000); }
function subHours(n: number) { return new Date(NOW.getTime() - n * 60 * 60 * 1000); }

// ── Helper: find or create supporting records ─────────────────────────────────

async function findOrCreateOrg(name: string, type: 'AG' | 'AN') {
  const [existing] = await db.select().from(organizationsTable)
    .where(and(eq(organizationsTable.name, name), eq(organizationsTable.type, type)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(organizationsTable).values({ name, type }).returning();
  return created!;
}

async function findOrCreateUser(email: string, orgId: string, name: string) {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(usersTable).values({
    email,
    name,
    passwordHash: '$2b$10$demo-hash-not-usable',
    orgId,
    orgType: 'AG',
  }).returning();
  return created!;
}

async function findOrCreateProject(name: string, agOrgId: string) {
  const [existing] = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.name, name), eq(projectsTable.agOrgId, agOrgId)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(projectsTable).values({ name, agOrgId }).returning();
  return created!;
}

async function findOrCreateTakt(taktBezeichnung: string, projectId: string) {
  const [existing] = await db.select().from(takteTable)
    .where(and(eq(takteTable.taktBezeichnung, taktBezeichnung), eq(takteTable.projectId, projectId)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(takteTable).values({
    taktBezeichnung,
    projectId,
    gewerk: 'Demo',
    zone: 'Z1',
    plannedStart: '2026-09-01',
    plannedEnd: '2026-09-30',
    version: 1,
    lifecycleStatus: 'PLANNED',
  }).returning();
  return created!;
}

// ── Main seeder ───────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding deadline demo data...');

  const guOrg = await findOrCreateOrg('Demo AG GmbH', 'AG');
  const nuOrg = await findOrCreateOrg('Demo NU GmbH', 'AN');
  const user  = await findOrCreateUser('demo-ag@demo.local', guOrg.id, 'Demo AG User');
  const project = await findOrCreateProject('Demo-Deadline-Projekt', guOrg.id);

  // Shared base for all requests
  const base = {
    guOrgId:    guOrg.id,
    nuOrgId:    nuOrg.id,
    createdByUserId: user.id,
  };

  // ── Scenario A: Fällig in 48h ─────────────────────────────────────────────
  const taktA = await findOrCreateTakt('Takt-A Rohbau (48h)', project.id);
  const [reqA] = await db.insert(taktRequestsTable).values({
    ...base,
    taktId:            taktA.id,
    taktVersion:       1,
    requestNumber:     'DEMO-A-001',
    status:            'DELIVERED',
    responseRequiredBy: addHours(48),
    expiresAt:          addHours(96),
    reminderCount:      0,
    sentAt:             subHours(24),
  }).onConflictDoNothing().returning();
  console.log(`  A) Fällig in 48h  → ${reqA?.id ?? '(already exists)'}`);

  // ── Scenario B: Heute fällig ──────────────────────────────────────────────
  const taktB = await findOrCreateTakt('Takt-B Ausbau (4h)', project.id);
  const [reqB] = await db.insert(taktRequestsTable).values({
    ...base,
    taktId:            taktB.id,
    taktVersion:       1,
    requestNumber:     'DEMO-B-001',
    status:            'DELIVERED',
    responseRequiredBy: addHours(4),
    expiresAt:          addHours(52),
    lastReminderAt:     subHours(2),
    reminderCount:      1,
    sentAt:             subHours(72),
  }).onConflictDoNothing().returning();
  console.log(`  B) Heute fällig   → ${reqB?.id ?? '(already exists)'}`);

  // ── Scenario C: Überfällig in Kulanzzeit ──────────────────────────────────
  const taktC = await findOrCreateTakt('Takt-C Fassade (überfällig)', project.id);
  const [reqC] = await db.insert(taktRequestsTable).values({
    ...base,
    taktId:            taktC.id,
    taktVersion:       1,
    requestNumber:     'DEMO-C-001',
    status:            'DELIVERED',
    responseRequiredBy: subHours(12),
    expiresAt:          addHours(36),    // still within grace period
    lastReminderAt:     subHours(6),
    reminderCount:      2,
    sentAt:             subHours(96),
  }).onConflictDoNothing().returning();
  console.log(`  C) Überfällig     → ${reqC?.id ?? '(already exists)'}`);

  // ── Scenario D: Abgelaufen ────────────────────────────────────────────────
  const taktD = await findOrCreateTakt('Takt-D Dach (abgelaufen)', project.id);
  const [reqD] = await db.insert(taktRequestsTable).values({
    ...base,
    taktId:            taktD.id,
    taktVersion:       1,
    requestNumber:     'DEMO-D-001',
    status:            'EXPIRED',
    responseRequiredBy: subHours(72),
    expiresAt:          subHours(24),
    expiredAt:          subHours(24),
    lastReminderAt:     subHours(48),
    reminderCount:      3,
    sentAt:             subHours(200),
  }).onConflictDoNothing().returning();
  console.log(`  D) Abgelaufen     → ${reqD?.id ?? '(already exists)'}`);

  // ── Scenario E: GU-Entscheidung überfällig ────────────────────────────────
  const taktE = await findOrCreateTakt('Takt-E Haustechnik (GU-Entscheid)', project.id);
  const [reqE] = await db.insert(taktRequestsTable).values({
    ...base,
    taktId:            taktE.id,
    taktVersion:       1,
    requestNumber:     'DEMO-E-001',
    status:            'ACCEPTED',
    responseRequiredBy: subHours(120),
    expiresAt:          subHours(72),
    expiredAt:          null,           // not expired (accepted)
    guDecisionRequiredBy: subHours(6), // GU must decide — overdue
    reminderCount:      1,
    sentAt:             subHours(200),
  }).onConflictDoNothing().returning();
  console.log(`  E) GU-Entscheid   → ${reqE?.id ?? '(already exists)'}`);

  // ── Scenario F: Reminder-Zustellung fehlgeschlagen ────────────────────────
  const taktF = await findOrCreateTakt('Takt-F Elektro (Erinnerungsfehler)', project.id);
  const [reqF] = await db.insert(taktRequestsTable).values({
    ...base,
    taktId:            taktF.id,
    taktVersion:       1,
    requestNumber:     'DEMO-F-001',
    status:            'DELIVERED',
    responseRequiredBy: addHours(24),
    expiresAt:          addHours(72),
    lastReminderAt:     subHours(1),
    reminderCount:      1,
    sentAt:             subHours(120),
  }).onConflictDoNothing().returning();

  if (reqF?.id) {
    // Create a FAILED reminder row
    await db.insert(taktRequestRemindersTable).values({
      taktRequestId:   reqF.id,
      reminderType:    'RESPONSE_DUE_SOON',
      status:          'FAILED',
      deduplicationKey: `DEMO-F-001:RESPONSE_DUE_SOON:${NOW.toISOString().slice(0, 10)}`,
      scheduledFor:    subHours(2),
      sentAt:          subHours(1),
      failureReason:   'Demo: Webhook-Endpunkt nicht erreichbar',
      recipientOrgId:  nuOrg.id,
    }).onConflictDoNothing();
  }
  console.log(`  F) Erinnerungsfehler → ${reqF?.id ?? '(already exists)'}`);

  console.log('✅ Demo seed complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});

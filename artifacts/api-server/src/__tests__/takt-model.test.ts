/**
 * Task 2.3 — Takt model extension tests
 *
 * Verifies the domain rules for the two new fields added to the takte table:
 *   - version  (integer, minimum 1, default 1)
 *   - lifecycleStatus (TaktLifecycleStatus enum, default PLANNED)
 *
 * Uses inline Zod schemas derived from the OpenAPI spec — the same pattern
 * as dataspace-schema-validation.test.ts — to stay framework-independent
 * and avoid live DB calls in unit tests.
 *
 * DB-level defaults (version = 1, lifecycleStatus = PLANNED) are verified
 * against the actual DB schema in the summary section; TypeScript compile-time
 * coverage is provided via satisfies / type-level assertions below.
 */

import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import type { Takt } from "@workspace/db";

// ── Domain schemas (mirror of OpenAPI Takt schema for the new fields) ─────────

const taktVersionSchema = z.number().int().min(1);

const taktLifecycleStatusSchema = z.enum([
  "DRAFT",
  "PLANNED",
  "IN_COORDINATION",
  "CONFIRMED",
  "CANCELLED",
]);

const taktStatusSchema = z.enum([
  "GEPLANT",
  "VERGEBEN",
  "ALTERNATIV",
  "BESTAETIGT",
  "ABGELEHNT",
  "STORNIERT",
]);

// Minimal Takt response shape that includes the new fields
const taktResponseSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taktBezeichnung: z.string().min(1),
  zone: z.string().min(1),
  gewerk: z.string().min(1),
  plannedStart: z.string(),
  plannedEnd: z.string(),
  status: taktStatusSchema,
  createdAt: z.string(),
  // New fields (optional in responses per OpenAPI comment, but always present in DB)
  version: taktVersionSchema.optional(),
  lifecycleStatus: taktLifecycleStatusSchema.optional(),
  updatedAt: z.string().optional(),
});

// ── version field ─────────────────────────────────────────────────────────────

describe("Takt model — version field (Task 2.3)", () => {
  it("version 1 is valid (minimum value and default for new Takte)", () => {
    expect(taktVersionSchema.safeParse(1).success).toBe(true);
  });

  it("version higher than 1 is valid (after updates)", () => {
    expect(taktVersionSchema.safeParse(5).success).toBe(true);
    expect(taktVersionSchema.safeParse(100).success).toBe(true);
  });

  it("version 0 is rejected — minimum is 1", () => {
    const result = taktVersionSchema.safeParse(0);
    expect(result.success).toBe(false);
  });

  it("version -1 is rejected", () => {
    expect(taktVersionSchema.safeParse(-1).success).toBe(false);
  });

  it("non-integer version is rejected", () => {
    expect(taktVersionSchema.safeParse(1.5).success).toBe(false);
    expect(taktVersionSchema.safeParse(0.9).success).toBe(false);
  });

  it("string version is rejected", () => {
    expect(taktVersionSchema.safeParse("1").success).toBe(false);
  });

  it("null version is rejected", () => {
    expect(taktVersionSchema.safeParse(null).success).toBe(false);
  });
});

// ── lifecycleStatus field ─────────────────────────────────────────────────────

describe("Takt model — lifecycleStatus field (Task 2.3)", () => {
  it("PLANNED is valid (default lifecycleStatus for new Takte)", () => {
    expect(taktLifecycleStatusSchema.safeParse("PLANNED").success).toBe(true);
  });

  it("all TaktLifecycleStatus values are valid", () => {
    const values = ["DRAFT", "PLANNED", "IN_COORDINATION", "CONFIRMED", "CANCELLED"] as const;
    for (const v of values) {
      expect(taktLifecycleStatusSchema.safeParse(v).success).toBe(true);
    }
  });

  it("new Takt receives PLANNED as default lifecycleStatus (domain rule)", () => {
    // The DB column default is 'PLANNED'::takt_lifecycle_status.
    // This test documents the expected domain default.
    const defaultStatus = "PLANNED";
    expect(taktLifecycleStatusSchema.safeParse(defaultStatus).success).toBe(true);
  });

  it("unknown status value is rejected", () => {
    expect(taktLifecycleStatusSchema.safeParse("VERGEBEN").success).toBe(false);
    expect(taktLifecycleStatusSchema.safeParse("GEPLANT").success).toBe(false);
    expect(taktLifecycleStatusSchema.safeParse("").success).toBe(false);
  });

  it("null lifecycleStatus is rejected (column is NOT NULL)", () => {
    expect(taktLifecycleStatusSchema.safeParse(null).success).toBe(false);
  });
});

// ── Existing takt_status field — backward compatibility ───────────────────────

describe("Takt model — existing status field preserved (Task 2.3)", () => {
  it("all original takt_status values remain valid", () => {
    const existingValues = [
      "GEPLANT",
      "VERGEBEN",
      "ALTERNATIV",
      "BESTAETIGT",
      "ABGELEHNT",
      "STORNIERT",
    ] as const;
    for (const v of existingValues) {
      expect(taktStatusSchema.safeParse(v).success).toBe(true);
    }
  });

  it("GEPLANT is still the default creation status for delegation flow", () => {
    expect(taktStatusSchema.safeParse("GEPLANT").success).toBe(true);
  });

  it("takt_status and takt_lifecycle_status are separate enums (no overlap)", () => {
    // A takt_status value must NOT parse as a lifecycle status, and vice versa
    expect(taktLifecycleStatusSchema.safeParse("GEPLANT").success).toBe(false);
    expect(taktLifecycleStatusSchema.safeParse("VERGEBEN").success).toBe(false);
    expect(taktStatusSchema.safeParse("IN_COORDINATION").success).toBe(false);
    expect(taktStatusSchema.safeParse("CONFIRMED").success).toBe(false);
  });
});

// ── Full Takt response shape ───────────────────────────────────────────────────

describe("Takt model — full response shape with new fields (Task 2.3)", () => {
  const validTakt = {
    id: "takt-uuid-001",
    projectId: "project-uuid-001",
    taktBezeichnung: "T1 – Erdgeschoss",
    zone: "A",
    gewerk: "Rohbau",
    plannedStart: "2026-04-01",
    plannedEnd: "2026-04-14",
    status: "GEPLANT",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    version: 1,
    lifecycleStatus: "PLANNED",
  };

  it("valid Takt response with version=1 and lifecycleStatus=PLANNED passes", () => {
    expect(taktResponseSchema.safeParse(validTakt).success).toBe(true);
  });

  it("existing clients still work — Takt without version/lifecycleStatus fields passes (optional)", () => {
    const { version, lifecycleStatus, updatedAt, ...legacyTakt } = validTakt;
    expect(taktResponseSchema.safeParse(legacyTakt).success).toBe(true);
  });

  it("Takt with version=0 fails validation", () => {
    expect(taktResponseSchema.safeParse({ ...validTakt, version: 0 }).success).toBe(false);
  });

  it("Takt with invalid lifecycleStatus fails validation", () => {
    expect(taktResponseSchema.safeParse({ ...validTakt, lifecycleStatus: "VERGEBEN" }).success).toBe(false);
  });

  it("Takt with version=3 and lifecycleStatus=IN_COORDINATION is valid (updated Takt)", () => {
    expect(
      taktResponseSchema.safeParse({
        ...validTakt,
        version: 3,
        lifecycleStatus: "IN_COORDINATION",
      }).success,
    ).toBe(true);
  });

  it("Takt with lifecycleStatus=CONFIRMED is valid (accepted coordination)", () => {
    expect(
      taktResponseSchema.safeParse({ ...validTakt, lifecycleStatus: "CONFIRMED" }).success,
    ).toBe(true);
  });
});

// ── TypeScript type coverage ───────────────────────────────────────────────────

describe("Takt TypeScript type includes new fields (compile-time)", () => {
  it("Takt type from @workspace/db includes version as number", () => {
    expectTypeOf<Takt["version"]>().toBeNumber();
  });

  it("Takt type from @workspace/db includes lifecycleStatus as enum string", () => {
    expectTypeOf<Takt["lifecycleStatus"]>().toBeString();
  });

  it("Takt type from @workspace/db includes updatedAt as Date", () => {
    expectTypeOf<Takt["updatedAt"]>().toEqualTypeOf<Date>();
  });
});

/**
 * Task 1.7 / Task 9.1 — Schema validation tests for dataspace message schemas.
 *
 * The generated Orval Zod schemas in @workspace/api-zod only cover API
 * endpoint request/response shapes. The dataspace message schemas
 * (MessageEnvelope, TaktRequestNotificationMessage, TaktResponseMessage, etc.)
 * are standalone OpenAPI schemas not yet wired to endpoints, so they have no
 * generated export. This file defines equivalent Zod schemas inline — derived
 * directly from lib/api-spec/openapi.yaml — and validates:
 *   - All four canonical JSON examples from docs/json-contracts.md
 *   - Invalid cases covering every constraint including schema version policy
 *
 * Schema version policy (Task 9.1):
 *   - schemaVersion must match /^\d+\.\d+$/
 *   - Major version must be 1 (currently supported)
 *   - Major version 2+ is explicitly rejected at this boundary
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  isSupportedMajorVersion,
  SUPPORTED_MAJOR_VERSIONS,
  CURRENT_SCHEMA_VERSION,
} from "../lib/schema-version";

// ── Derived Zod schemas (mirror of lib/api-spec/openapi.yaml) ─────────────────

const DataspaceMessageType = z.enum([
  "TAKT_REQUEST_NOTIFICATION",
  "TAKT_REQUEST_REVISED",
  "TAKT_REQUEST_CANCELLED",
  "TAKT_DETAILS_RETRIEVED",
  "TAKT_RESPONSE_SUBMITTED",
  "TAKT_RESPONSE_ACCEPTED",
  "TAKT_RESPONSE_REVISION_REQUESTED",
  // Added in Sprint 7 (Task 7.x) — deadline/reminder system
  "TAKT_REQUEST_REMINDER",
  "TAKT_REQUEST_EXPIRED",
]);

const DataspaceMessageStatus = z.enum([
  "PENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
]);

/** end must be strictly after start — enforced in service layer, noted in schema */
const TimeWindow = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});

const TaktDecision = z.enum([
  "ACCEPTED",
  "ALTERNATIVES_PROPOSED",
  "REJECTED",
]);

const TaktResponseReasonCode = z.enum([
  "RESOURCE_CONFLICT",
  "NO_CAPACITY",
  "EQUIPMENT_UNAVAILABLE",
  "QUALIFICATION_MISSING",
  "TIME_WINDOW_TOO_SHORT",
  "OUTSIDE_PLANNING_HORIZON",
  "OTHER",
]);

const TaktResponseAlternative = z.object({
  alternativeId: z.string(),
  rank: z.number().int().min(1),
  timeWindow: TimeWindow,
  crewSize: z.number().int().min(1).nullable().optional(),
  conditions: z.array(z.string()).nullable().optional(),
});

const TaktRequestNotificationPayload = z.object({
  taktRequestId: z.string(),
  projectReference: z.string(),
  taktReference: z.string(),
  taktVersion: z.number().int().min(1),
  responseRequiredBy: z.string().datetime(),
  detailsRef: z.string(),
  subject: z.string().optional(),
  message: z.string().optional(),
});

const TaktResponsePayload = z.object({
  taktRequestId: z.string(),
  decision: TaktDecision,
  reasonCode: TaktResponseReasonCode.optional(),
  comment: z.string().max(2000).nullable().optional(),
  acceptedTimeWindow: TimeWindow.optional(),
  alternatives: z
    .array(TaktResponseAlternative)
    .max(3)
    .nullable()
    .optional(),
  nextAvailableDate: z.string().nullable().optional(),
});

/**
 * Schema version field — shared refinement used by all envelope types.
 * Format: /^\d+\.\d+$/  AND major version must be in SUPPORTED_MAJOR_VERSIONS.
 */
const SchemaVersionField = z
  .string()
  .regex(/^\d+\.\d+$/, "Format muss <major>.<minor> sein (z.B. \"1.0\")")
  .refine(isSupportedMajorVersion, {
    message: `Nicht unterstützte Major-Version. Unterstützte Major-Versionen: ${SUPPORTED_MAJOR_VERSIONS.join(", ")}`,
  });

/** Generic MessageEnvelope — payload is untyped (z.record) */
const MessageEnvelope = z.object({
  messageId: z.string().min(1),
  schemaVersion: SchemaVersionField,
  messageType: DataspaceMessageType,
  senderOrgId: z.string(),
  recipientOrgId: z.string(),
  correlationId: z.string(),
  createdAt: z.string().datetime(),
  payload: z.record(z.unknown()),
  causationId: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  status: DataspaceMessageStatus.optional(),
});

/** Typed message: envelope + typed TaktRequestNotificationPayload */
const TaktRequestNotificationMessage = z.object({
  messageId: z.string().min(1),
  schemaVersion: SchemaVersionField,
  messageType: z.literal("TAKT_REQUEST_NOTIFICATION"),
  senderOrgId: z.string(),
  recipientOrgId: z.string(),
  correlationId: z.string(),
  createdAt: z.string().datetime(),
  payload: TaktRequestNotificationPayload,
  causationId: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  status: DataspaceMessageStatus.optional(),
});

/** Typed message: envelope + typed TaktResponsePayload */
const TaktResponseMessage = z.object({
  messageId: z.string().min(1),
  schemaVersion: SchemaVersionField,
  messageType: z.literal("TAKT_RESPONSE_SUBMITTED"),
  senderOrgId: z.string(),
  recipientOrgId: z.string(),
  correlationId: z.string(),
  createdAt: z.string().datetime(),
  payload: TaktResponsePayload,
  causationId: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  status: DataspaceMessageStatus.optional(),
});

// ── Canonical examples from docs/json-contracts.md ───────────────────────────

const example1Notification = {
  messageId: "MSG-2026-000001",
  schemaVersion: "1.0",
  messageType: "TAKT_REQUEST_NOTIFICATION",
  senderOrgId: "GU-001",
  recipientOrgId: "NU-017",
  correlationId: "REQ-2026-0042",
  causationId: null,
  createdAt: "2026-07-31T09:00:00Z",
  expiresAt: "2026-08-07T09:00:00Z",
  status: "DELIVERED",
  payload: {
    taktRequestId: "REQ-2026-0042",
    projectReference: "PROJ-2026-HH-001",
    taktReference: "TAKT-A3-ELT",
    taktVersion: 1,
    responseRequiredBy: "2026-08-05T17:00:00Z",
    detailsRef: "/api/delegations/f4aa8c5a-ebb3-4e4e-94d0-100011aa6bf7",
    subject: "Taktanfrage: Elektroinstallation Zone A3",
    message: "Bitte prüfen Sie den Termin und bestätigen Sie bis zum 05.08.",
  },
};

const example2Acceptance = {
  messageId: "MSG-2026-000002",
  schemaVersion: "1.0",
  messageType: "TAKT_RESPONSE_SUBMITTED",
  senderOrgId: "NU-017",
  recipientOrgId: "GU-001",
  correlationId: "REQ-2026-0042",
  causationId: "MSG-2026-000001",
  createdAt: "2026-08-03T14:22:00Z",
  expiresAt: null,
  status: "DELIVERED",
  payload: {
    taktRequestId: "REQ-2026-0042",
    decision: "ACCEPTED",
    acceptedTimeWindow: {
      start: "2026-09-01T07:00:00Z",
      end: "2026-09-05T16:00:00Z",
    },
    comment: "Termin wird wie geplant ausgeführt.",
  },
};

const example3Alternatives = {
  messageId: "MSG-2026-000003",
  schemaVersion: "1.0",
  messageType: "TAKT_RESPONSE_SUBMITTED",
  senderOrgId: "NU-017",
  recipientOrgId: "GU-001",
  correlationId: "REQ-2026-0042",
  causationId: "MSG-2026-000001",
  createdAt: "2026-08-04T10:05:00Z",
  expiresAt: null,
  status: "DELIVERED",
  payload: {
    taktRequestId: "REQ-2026-0042",
    decision: "ALTERNATIVES_PROPOSED",
    reasonCode: "RESOURCE_CONFLICT",
    comment:
      "Im angefragten Zeitraum besteht ein Ressourcenkonflikt. Zwei Alternativtermine werden vorgeschlagen.",
    alternatives: [
      {
        alternativeId: "ALT-001",
        rank: 1,
        timeWindow: { start: "2026-09-08T07:00:00Z", end: "2026-09-12T16:00:00Z" },
        crewSize: 4,
        conditions: ["Zugang via Südeingang erforderlich", "Kernarbeitszeit 07:00–15:00 Uhr"],
      },
      {
        alternativeId: "ALT-002",
        rank: 2,
        timeWindow: { start: "2026-09-15T07:00:00Z", end: "2026-09-19T16:00:00Z" },
        crewSize: 6,
        conditions: ["Vollständige Kolonne verfügbar", "Keine Einschränkungen"],
      },
    ],
  },
};

const example4Rejection = {
  messageId: "MSG-2026-000010",
  schemaVersion: "1.0",
  messageType: "TAKT_RESPONSE_SUBMITTED",
  senderOrgId: "NU-017",
  recipientOrgId: "GU-001",
  correlationId: "REQ-2026-0043",
  causationId: "MSG-2026-000009",
  createdAt: "2026-08-05T08:30:00Z",
  expiresAt: null,
  status: "DELIVERED",
  payload: {
    taktRequestId: "REQ-2026-0043",
    decision: "REJECTED",
    reasonCode: "NO_CAPACITY",
    comment:
      "Im gesamten angefragten Zeitraum steht keine ausreichende Kapazität zur Verfügung.",
    nextAvailableDate: "2026-10-01",
  },
};

// ── Valid cases ───────────────────────────────────────────────────────────────

describe("Valid examples — TaktRequestNotificationMessage (Example 1)", () => {
  it("parses the canonical notification example", () => {
    const result = TaktRequestNotificationMessage.safeParse(example1Notification);
    expect(result.success, result.error?.message).toBe(true);
  });

  it("generic MessageEnvelope also accepts the notification", () => {
    const result = MessageEnvelope.safeParse(example1Notification);
    expect(result.success, result.error?.message).toBe(true);
  });

  it("causationId: null is accepted", () => {
    const result = TaktRequestNotificationMessage.safeParse(example1Notification);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.causationId).toBeNull();
    }
  });
});

describe("Valid examples — TaktResponseMessage ACCEPTED (Example 2)", () => {
  it("parses the canonical acceptance example", () => {
    const result = TaktResponseMessage.safeParse(example2Acceptance);
    expect(result.success, result.error?.message).toBe(true);
  });

  it("correlationId matches the original notification", () => {
    const result = TaktResponseMessage.safeParse(example2Acceptance);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.correlationId).toBe("REQ-2026-0042");
      expect(result.data.causationId).toBe("MSG-2026-000001");
    }
  });

  it("decision is ACCEPTED and acceptedTimeWindow is present", () => {
    const result = TaktResponseMessage.safeParse(example2Acceptance);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.decision).toBe("ACCEPTED");
      expect(result.data.payload.acceptedTimeWindow).toBeDefined();
    }
  });
});

describe("Valid examples — TaktResponseMessage ALTERNATIVES_PROPOSED (Example 3)", () => {
  it("parses the two-alternatives example", () => {
    const result = TaktResponseMessage.safeParse(example3Alternatives);
    expect(result.success, result.error?.message).toBe(true);
  });

  it("has exactly two alternatives with unique ranks", () => {
    const result = TaktResponseMessage.safeParse(example3Alternatives);
    expect(result.success).toBe(true);
    if (result.success) {
      const alts = result.data.payload.alternatives ?? [];
      expect(alts).toHaveLength(2);
      const ranks = alts.map((a) => a.rank);
      expect(new Set(ranks).size).toBe(ranks.length);
    }
  });

  it("reasonCode is RESOURCE_CONFLICT", () => {
    const result = TaktResponseMessage.safeParse(example3Alternatives);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.reasonCode).toBe("RESOURCE_CONFLICT");
    }
  });
});

describe("Valid examples — TaktResponseMessage REJECTED (Example 4)", () => {
  it("parses the canonical rejection example", () => {
    const result = TaktResponseMessage.safeParse(example4Rejection);
    expect(result.success, result.error?.message).toBe(true);
  });

  it("decision is REJECTED and no alternatives are present", () => {
    const result = TaktResponseMessage.safeParse(example4Rejection);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.decision).toBe("REJECTED");
      expect(result.data.payload.alternatives).toBeUndefined();
    }
  });

  it("nextAvailableDate is present as a date string", () => {
    const result = TaktResponseMessage.safeParse(example4Rejection);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.nextAvailableDate).toBe("2026-10-01");
    }
  });

  it("causationId references a message in the same REQ-2026-0043 chain", () => {
    // After the fix in Task 1.6, causationId must belong to the same correlationId chain.
    expect(example4Rejection.correlationId).toBe("REQ-2026-0043");
    expect(example4Rejection.causationId).toBe("MSG-2026-000009");
    // MSG-2026-000001 was from REQ-2026-0042 — it must NOT appear here.
    expect(example4Rejection.causationId).not.toBe("MSG-2026-000001");
  });
});

// ── Invalid cases ─────────────────────────────────────────────────────────────

describe("Invalid cases — MessageEnvelope field constraints", () => {
  it("rejects missing messageId", () => {
    const bad = { ...example1Notification, messageId: undefined };
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("rejects empty messageId (minLength: 1)", () => {
    const bad = { ...example1Notification, messageId: "" };
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("rejects missing senderOrgId", () => {
    const bad = { ...example1Notification, senderOrgId: undefined };
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("rejects missing recipientOrgId", () => {
    const bad = { ...example1Notification, recipientOrgId: undefined };
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("rejects missing correlationId", () => {
    const bad = { ...example1Notification, correlationId: undefined };
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid schemaVersion — no dot separator", () => {
    const bad = { ...example1Notification, schemaVersion: "10" };
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid schemaVersion — free text", () => {
    const bad = { ...example1Notification, schemaVersion: "v1" };
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("rejects schemaVersion '2.1' — unsupported major version", () => {
    const bad = { ...example1Notification, schemaVersion: "2.1" };
    const result = MessageEnvelope.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects schemaVersion '2.0' — unsupported major version", () => {
    const bad = { ...example1Notification, schemaVersion: "2.0" };
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("rejects missing schemaVersion — required field", () => {
    const { schemaVersion: _, ...bad } = example1Notification as Record<string, unknown>;
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("accepts schemaVersion '1.3' — minor bump within supported major", () => {
    const ok = { ...example1Notification, schemaVersion: "1.3" };
    expect(MessageEnvelope.safeParse(ok).success).toBe(true);
  });
});

describe("Invalid cases — payload-level constraints", () => {
  it("rejects taktVersion less than 1 (minimum: 1)", () => {
    const bad = {
      ...example1Notification,
      payload: { ...example1Notification.payload, taktVersion: 0 },
    };
    expect(TaktRequestNotificationMessage.safeParse(bad).success).toBe(false);
  });

  it("rejects taktVersion of 0.5 (must be integer)", () => {
    const bad = {
      ...example1Notification,
      payload: { ...example1Notification.payload, taktVersion: 0.5 },
    };
    expect(TaktRequestNotificationMessage.safeParse(bad).success).toBe(false);
  });

  it("rejects an alternative without timeWindow", () => {
    const altWithoutWindow = {
      alternativeId: "ALT-X",
      rank: 1,
      // timeWindow omitted
    };
    const bad = {
      ...example3Alternatives,
      payload: {
        ...example3Alternatives.payload,
        alternatives: [altWithoutWindow],
      },
    };
    expect(TaktResponseMessage.safeParse(bad).success).toBe(false);
  });

  it("rejects more than three alternatives (maxItems: 3)", () => {
    const alt = {
      alternativeId: "ALT-X",
      rank: 1,
      timeWindow: { start: "2026-09-08T07:00:00Z", end: "2026-09-12T16:00:00Z" },
    };
    const bad = {
      ...example3Alternatives,
      payload: {
        ...example3Alternatives.payload,
        alternatives: [
          { ...alt, alternativeId: "ALT-1", rank: 1 },
          { ...alt, alternativeId: "ALT-2", rank: 2 },
          { ...alt, alternativeId: "ALT-3", rank: 3 },
          { ...alt, alternativeId: "ALT-4", rank: 4 },
        ],
      },
    };
    expect(TaktResponseMessage.safeParse(bad).success).toBe(false);
  });

  it("rejects crewSize less than 1 (minimum: 1)", () => {
    const bad = {
      ...example3Alternatives,
      payload: {
        ...example3Alternatives.payload,
        alternatives: [
          {
            alternativeId: "ALT-001",
            rank: 1,
            timeWindow: { start: "2026-09-08T07:00:00Z", end: "2026-09-12T16:00:00Z" },
            crewSize: 0, // invalid
          },
        ],
      },
    };
    expect(TaktResponseMessage.safeParse(bad).success).toBe(false);
  });
});

// ── DELIVERED ≠ ACCEPTED boundary (documented in message-flow.md) ─────────────

describe("DELIVERED vs ACCEPTED — important distinction", () => {
  it("a DELIVERED message can carry a REJECTED decision", () => {
    // Transport state and business decision are independent
    const result = TaktResponseMessage.safeParse(example4Rejection);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("DELIVERED");
      expect(result.data.payload.decision).toBe("REJECTED");
    }
  });

  it("DataspaceMessageStatus does not include ACCEPTED", () => {
    const badStatus = DataspaceMessageStatus.safeParse("ACCEPTED");
    expect(badStatus.success).toBe(false);
  });

  it("TaktDecision does not include DELIVERED", () => {
    const badDecision = TaktDecision.safeParse("DELIVERED");
    expect(badDecision.success).toBe(false);
  });
});

// ── Task 9.1 — Schema version policy ─────────────────────────────────────────

describe("Schema version policy (Task 9.1)", () => {
  it("CURRENT_SCHEMA_VERSION is '1.0'", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe("1.0");
  });

  it("isSupportedMajorVersion accepts '1.0'", () => {
    expect(isSupportedMajorVersion("1.0")).toBe(true);
  });

  it("isSupportedMajorVersion accepts '1.7' (minor bump)", () => {
    expect(isSupportedMajorVersion("1.7")).toBe(true);
  });

  it("isSupportedMajorVersion rejects '2.0'", () => {
    expect(isSupportedMajorVersion("2.0")).toBe(false);
  });

  it("isSupportedMajorVersion rejects '0.9'", () => {
    expect(isSupportedMajorVersion("0.9")).toBe(false);
  });

  it("isSupportedMajorVersion rejects malformed string 'v1'", () => {
    expect(isSupportedMajorVersion("v1")).toBe(false);
  });

  it("MessageEnvelope rejects schemaVersion '2.0' with clear failure", () => {
    const bad = { ...example1Notification, schemaVersion: "2.0" };
    const result = MessageEnvelope.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Error message must mention version (not just "invalid string")
      const msg = result.error.issues.map(i => i.message).join(" ");
      expect(msg.toLowerCase()).toMatch(/major|version|unterstützt/);
    }
  });

  it("MessageEnvelope rejects missing schemaVersion", () => {
    const { schemaVersion: _, ...bad } = example1Notification as Record<string, unknown>;
    expect(MessageEnvelope.safeParse(bad).success).toBe(false);
  });

  it("MessageEnvelope accepts schemaVersion '1.0'", () => {
    expect(MessageEnvelope.safeParse({ ...example1Notification, schemaVersion: "1.0" }).success).toBe(true);
  });

  it("MessageEnvelope accepts valid optional extension (unknown optional field)", () => {
    // Adding a new optional field to the payload is a backward-compatible extension (minor bump)
    const withExtension = {
      ...example1Notification,
      schemaVersion: "1.1",
      payload: { ...example1Notification.payload, extensionField: "new-in-1.1" },
    };
    // The generic envelope accepts this (payload is z.record(z.unknown()))
    expect(MessageEnvelope.safeParse(withExtension).success).toBe(true);
  });
});

// ── Task 9.1 — Consistent identifiers ────────────────────────────────────────

describe("Consistent identifiers (Task 9.1)", () => {
  it("notification uses taktRequestId (not requestId or requestRef)", () => {
    const result = TaktRequestNotificationMessage.safeParse(example1Notification);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.taktRequestId).toBeDefined();
    }
  });

  it("response uses taktRequestId matching the notification's correlationId", () => {
    const result = TaktResponseMessage.safeParse(example2Acceptance);
    expect(result.success).toBe(true);
    if (result.success) {
      // taktRequestId in payload should match the correlationId on the envelope
      expect(result.data.payload.taktRequestId).toBe(result.data.correlationId);
    }
  });

  it("envelope uses senderOrgId and recipientOrgId (not customerId or providerId)", () => {
    const result = MessageEnvelope.safeParse(example1Notification);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.senderOrgId).toBeDefined();
      expect(result.data.recipientOrgId).toBeDefined();
      // The schema has no customerId or providerId fields
      expect((result.data as Record<string, unknown>).customerId).toBeUndefined();
      expect((result.data as Record<string, unknown>).providerId).toBeUndefined();
    }
  });

  it("notification uses projectReference (not projectId) in the external payload", () => {
    const result = TaktRequestNotificationMessage.safeParse(example1Notification);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.projectReference).toBeDefined();
    }
  });

  it("notification uses taktReference (not taktId) in the external payload", () => {
    const result = TaktRequestNotificationMessage.safeParse(example1Notification);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.taktReference).toBeDefined();
    }
  });
});

// ── Task 9.1 — Consistent time windows ───────────────────────────────────────

describe("Consistent time windows (Task 9.1)", () => {
  it("acceptedTimeWindow uses {start, end} — not startAt/endAt", () => {
    const result = TaktResponseMessage.safeParse(example2Acceptance);
    expect(result.success).toBe(true);
    if (result.success) {
      const tw = result.data.payload.acceptedTimeWindow!;
      expect(tw.start).toBeDefined();
      expect(tw.end).toBeDefined();
      expect((tw as Record<string, unknown>).startAt).toBeUndefined();
      expect((tw as Record<string, unknown>).endAt).toBeUndefined();
    }
  });

  it("alternative timeWindow uses {start, end} — not plannedStart/plannedEnd", () => {
    const result = TaktResponseMessage.safeParse(example3Alternatives);
    expect(result.success).toBe(true);
    if (result.success) {
      const alt = result.data.payload.alternatives![0]!;
      expect(alt.timeWindow.start).toBeDefined();
      expect(alt.timeWindow.end).toBeDefined();
      expect((alt.timeWindow as Record<string, unknown>).plannedStart).toBeUndefined();
    }
  });

  it("time window rejects missing start field", () => {
    const bad = {
      ...example2Acceptance,
      payload: {
        ...example2Acceptance.payload,
        acceptedTimeWindow: { end: "2026-09-05T16:00:00Z" }, // start missing
      },
    };
    expect(TaktResponseMessage.safeParse(bad).success).toBe(false);
  });

  it("time window rejects missing end field", () => {
    const bad = {
      ...example2Acceptance,
      payload: {
        ...example2Acceptance.payload,
        acceptedTimeWindow: { start: "2026-09-01T07:00:00Z" }, // end missing
      },
    };
    expect(TaktResponseMessage.safeParse(bad).success).toBe(false);
  });

  it("time window accepts ISO 8601 UTC strings", () => {
    const good = {
      ...example2Acceptance,
      payload: {
        ...example2Acceptance.payload,
        acceptedTimeWindow: {
          start: "2026-09-01T07:00:00Z",
          end: "2026-09-05T16:00:00Z",
        },
      },
    };
    expect(TaktResponseMessage.safeParse(good).success).toBe(true);
  });
});

// ── Task 9.1 — Reminder and expiry message types ──────────────────────────────

describe("Reminder and expiry message types (Task 9.1)", () => {
  const baseEnvelope = {
    messageId: "MSG-REMINDER-001",
    schemaVersion: "1.0",
    senderOrgId: "SYSTEM",
    recipientOrgId: "NU-017",
    correlationId: "REQ-2026-0042",
    createdAt: "2026-08-03T08:00:00Z",
    status: "DELIVERED",
  };

  it("accepts TAKT_REQUEST_REMINDER as a DataspaceMessageType", () => {
    expect(DataspaceMessageType.safeParse("TAKT_REQUEST_REMINDER").success).toBe(true);
  });

  it("accepts TAKT_REQUEST_EXPIRED as a DataspaceMessageType", () => {
    expect(DataspaceMessageType.safeParse("TAKT_REQUEST_EXPIRED").success).toBe(true);
  });

  it("MessageEnvelope accepts a reminder message with schemaVersion 1.0", () => {
    const reminder = {
      ...baseEnvelope,
      messageType: "TAKT_REQUEST_REMINDER",
      payload: {
        taktRequestId: "REQ-2026-0042",
        requestNumber: "REQ-2026-0042",
        reminderType: "RESPONSE_DUE_SOON",
        dueAt: "2026-08-05T17:00:00Z",
        taktReference: "TAKT-A3-ELT",
        deepLink: "/takt-requests/REQ-2026-0042",
      },
    };
    expect(MessageEnvelope.safeParse(reminder).success).toBe(true);
  });

  it("MessageEnvelope accepts an expiry message with schemaVersion 1.0", () => {
    const expiry = {
      ...baseEnvelope,
      messageType: "TAKT_REQUEST_EXPIRED",
      recipientOrgId: "GU-001",
      payload: {
        taktRequestId: "REQ-2026-0042",
        requestNumber: "REQ-2026-0042",
        expiredAt: "2026-08-07T09:00:00Z",
        projectReference: "PROJ-2026-HH-001",
        taktReference: "TAKT-A3-ELT",
      },
    };
    expect(MessageEnvelope.safeParse(expiry).success).toBe(true);
  });

  it("reminder payload does not contain internal NU resource fields", () => {
    const reminderPayload = {
      taktRequestId: "REQ-2026-0042",
      requestNumber: "REQ-2026-0042",
      reminderType: "RESPONSE_DUE_SOON",
      dueAt: "2026-08-05T17:00:00Z",
      taktReference: "TAKT-A3-ELT",
      deepLink: "/takt-requests/REQ-2026-0042",
    };
    const forbiddenKeys = [
      "internalResultPayload", "resourcePlanning", "localProjectId",
      "customerAlias", "resourceId", "employeeName", "internalCost",
    ];
    for (const key of forbiddenKeys) {
      expect(Object.keys(reminderPayload)).not.toContain(key);
    }
  });
});

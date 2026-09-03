import { z } from "zod";

/**
 * Public, immutable Takt data released to the addressed AN.
 *
 * Keep this contract limited to coordination data. It must not grow to
 * include internal planning, cost, employee, resource-assignment, or status
 * fields from the AG database.
 */
const scopedFields = z.object({
  schemaVersion: z.literal("1.0"),
  projectReference: z.string(),
  projectLocation: z.string().nullable(),
  projectDescription: z.string().nullable(),
  taktReference: z.string(),
  taktVersion: z.number().int().min(1),
  trade: z.string(),
  workPackage: z.string(),
  kurzbezeichnung: z.string(),
  location: z.object({
    building: z.string().nullable(),
    storey: z.string().nullable(),
    zone: z.string().nullable(),
  }),
  plannedTimeWindow: z.object({
    start: z.string(),
    end: z.string(),
  }),
  bufferTimeWindow: z.object({
    earliestStart: z.string().nullable(),
    latestEnd: z.string().nullable(),
  }).nullable(),
  requiredOutput: z.string().nullable(),
  resourceRequirements: z.array(z.object({
    resourceType: z.enum(["CREW", "EQUIPMENT", "OTHER"]),
    notes: z.string(),
  })),
  constraints: z.array(z.string()),
  predecessors: z.array(z.object({
    taktId: z.string(),
    dependencyType: z.string(),
    lagDays: z.number(),
  })),
  successors: z.array(z.object({
    taktId: z.string(),
    dependencyType: z.string(),
    lagDays: z.number(),
  })),
  documentReferences: z.object({
    lvReference: z.string().nullable(),
    bimReference: z.string().nullable(),
  }),
}).strict();

/** A child release contains the technical project reference and planned window,
 * plus only the purpose-whitelisted child fields. Project profile fields are
 * deliberately absent when they are already covered by the parent agreement. */
export const TaktRequestSnapshotPayloadSchema = scopedFields.partial().extend({
  schemaVersion: z.literal("1.0"),
  projectReference: z.string(),
  plannedTimeWindow: z.object({ start: z.string(), end: z.string() }),
}).strict();

/** Full builder shape. A scoped child snapshot is validated by the schema
 * above, while producers still construct this complete canonical shape before
 * purpose filtering. */
export type TaktRequestSnapshotPayload = z.infer<typeof scopedFields>;

/**
 * The only top-level fields permitted in the base public snapshot.
 *
 * This is exported for regression tests and other whitelist checks so a
 * newly-added payload field cannot silently become undocumented.
 */
export const TAKT_REQUEST_SNAPSHOT_PUBLIC_FIELDS = [
  "schemaVersion",
  "projectReference",
  "projectLocation",
  "projectDescription",
  "taktReference",
  "taktVersion",
  "trade",
  "workPackage",
  "kurzbezeichnung",
  "location",
  "plannedTimeWindow",
  "bufferTimeWindow",
  "requiredOutput",
  "resourceRequirements",
  "constraints",
  "predecessors",
  "successors",
  "documentReferences",
] as const satisfies readonly (keyof TaktRequestSnapshotPayload)[];
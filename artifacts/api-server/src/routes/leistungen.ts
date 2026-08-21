/**
 * Canonical German Leistung endpoints — Task #196
 *
 * These routes expose the same business logic as the existing Takt routes
 * under canonical German URIs and field names:
 *
 *   /projects/:projectId/leistungen        ↔  /projects/:projectId/takte
 *   /projects/:projectId/leistungsabhaengigkeiten  ↔  /projects/:projectId/takt-dependencies
 *   /leistungsanfragen                     ↔  /takt-requests  (+ nested sub-resources)
 *
 * Field-name contract:
 *   - All request bodies accept BOTH the canonical German field name and the
 *     legacy English name.  When both are supplied, the canonical (German) form
 *     takes precedence.
 *   - All response bodies contain BOTH names so that clients migrating
 *     incrementally receive a stable transition surface.
 *
 * Canonical ↔ legacy field-name mapping
 *   leistungBezeichnung  ↔  taktBezeichnung
 *   leistungId           ↔  taktId
 *   leistungVersion      ↔  taktVersion
 *   leistungsanfrageId   ↔  taktRequestId
 *
 * Auth/validation:  identical to the corresponding Takt endpoints — the same
 *   requireJwt / requireRole middleware is applied.
 *
 * ⚠ Do NOT hand-edit generated client artifacts; only this source file and
 *   the OpenAPI spec are authoritative.
 */

import { Router, Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  takteTable,
  leistungenTable,
  projectsTable,
  taktDependenciesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { requireRole } from "../middlewares/requireRole";
import { rescheduleTakte, wouldCreateCycle } from "../lib/reschedule";
import {
  computePlannedEnd,
  toCalendarConfig,
  DEFAULT_CALENDAR,
} from "../lib/working-days";
import { projectCalendarsTable } from "@workspace/db";
import { z } from "zod";

// ── imports shared with takt-requests.ts ─────────────────────────────────────
import {
  createTaktRequestWithSnapshot,
  TaktNotFoundError,
  UnauthorizedSnapshotError,
  NuNotContractorError,
  InvalidTaktForSnapshotError,
} from "../lib/takt-request-snapshot-service";
import {
  getTaktRequestById,
  getTaktRequestWithSnapshot,
  getTaktRequestDetailForGu,
  listTaktRequestsForGuEnriched,
  listTaktRequestsForNuEnriched,
  updateTaktRequestStatus,
  transitionToDetailsRetrievedAtomic,
  TaktRequestTransitionError,
  type TaktRequestStatus,
} from "../lib/takt-request-repository";
import {
  getTaktResponseWithAlternatives,
  TaktResponseValidationError,
} from "../lib/takt-response-repository";
import {
  processNuResponse,
  ResponseConflictError,
  ResponseStatusError,
} from "../services/nu-response-service";
import {
  runAvailabilityCheck,
  getLatestAvailabilityCheck,
  AvailabilityCheckError,
} from "../services/availability-check-service";
import {
  createGuDecision,
  GuDecisionError,
  GuDecisionIdempotencyConflict,
  VersionConflictError,
} from "../services/gu-decision-service";
import { createRevision, RevisionError } from "../services/revision-service";
import { writeAuditEvent, getAuditTrail } from "../lib/takt-request-audit-service";
import type { MessageEnvelope, TransportResult } from "../lib/transport/message-transport";
import { createDataspaceExchange } from "../services/dataspace/dataspace-exchange-factory";
import {
  toExternalTaktRequestFromEnvelope,
  toExternalTaktResponseFromEnvelope,
} from "../services/dataspace/external-mappers";
import {
  IdempotencyConflictError,
} from "../lib/transport/transport-errors";
import {
  MalformedSchemaVersionError,
  UnsupportedSchemaVersionError,
} from "../lib/schema-version";
import { DataspaceMessageType } from "@workspace/api-zod";
import {
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  policyTemplatesTable,
  messageOutboxTable,
  hubMessagesTable,
  taktRequestResourceRequirementsTable,
  leistungsanfrageResourceRequirementsTable,
  resourceTypesTable,
} from "@workspace/db";
import { desc } from "drizzle-orm";
import type { TaktCoordinationDecisionType } from "@workspace/db";
import { validateResourceTypeForOrg } from "../services/resource-domain-service";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const dataspaceExchange = createDataspaceExchange();

/**
 * Wrap transport.send() — identical to safeSend in takt-requests.ts.
 */
async function safeSend(
  envelope: MessageEnvelope,
  res: Response,
): Promise<TransportResult | null> {
  try {
    const reference = envelope.messageType === DataspaceMessageType.TAKT_RESPONSE_SUBMITTED
      ? await dataspaceExchange.publishTaktResponse(toExternalTaktResponseFromEnvelope(envelope))
      : await dataspaceExchange.publishTaktRequest(toExternalTaktRequestFromEnvelope(envelope));
    return {
      messageId: reference.exchangeId,
      status: reference.status ?? "DELIVERED",
      sentAt: reference.sentAt ?? new Date(),
      deliveredAt: reference.deliveredAt ?? new Date(),
      attemptCount: reference.attemptCount ?? 1,
    };
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      res.status(409).json({ error: (err as any).message, conflictingFields: (err as any).conflictingFields });
      return null;
    }
    if (err instanceof UnsupportedSchemaVersionError) {
      res.status(422).json({ error: (err as any).message });
      return null;
    }
    if (err instanceof MalformedSchemaVersionError) {
      res.status(400).json({ error: (err as any).message });
      return null;
    }
    throw err;
  }
}

function notificationMessageId(requestId: string): string {
  return `taktrequest-notification-${requestId}`;
}

/** Formats a check row for NU-facing API responses. */
function formatCheckResponse(check: import("@workspace/db").AvailabilityCheck) {
  return {
    checkId: check.id,
    status: check.status,
    result: check.result,
    runNumber: check.runNumber,
    internalResult: check.internalResultPayload,
    publicResult: check.publicResultPayload,
    checkedAt: check.checkedAt?.toISOString() ?? null,
    createdAt: check.createdAt.toISOString(),
  };
}

/**
 * Enrich a Leistung row with canonical German API field aliases.
 *
 * DB column mapping:
 *   leistungsBezeichnung (DB) → exposed as both leistungBezeichnung (canonical API)
 *   and taktBezeichnung (legacy API alias) for backward compatibility.
 */
function enrichLeistung(
  row: Record<string, unknown>,
): Record<string, unknown> {
  // DB uses leistungsBezeichnung; expose canonical API name leistungBezeichnung
  // AND legacy alias taktBezeichnung for backward-compatible clients.
  const bezeichnung = row.leistungsBezeichnung ?? row.taktBezeichnung ?? null;
  return {
    ...row,
    // canonical API fields
    leistungId: row.id,
    leistungBezeichnung: bezeichnung,
    leistungVersion: row.version ?? null,
    // legacy alias (backward compat — same value)
    taktBezeichnung: bezeichnung,
  };
}

/**
 * Normalise a request body that may use canonical German field names,
 * legacy names, or both.  Canonical takes precedence.
 *
 * Mapping:
 *   leistungBezeichnung → taktBezeichnung
 *   leistungId          → taktId
 *   leistungVersion     → taktVersion
 */
function normaliseLeistungInput(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  if (out.leistungBezeichnung !== undefined) {
    out.taktBezeichnung = out.leistungBezeichnung;
    delete out.leistungBezeichnung;
  }
  if (out.leistungId !== undefined) {
    out.taktId = out.leistungId;
    delete out.leistungId;
  }
  if (out.leistungVersion !== undefined) {
    out.taktVersion = out.leistungVersion;
    delete out.leistungVersion;
  }
  return out;
}

/**
 * Enrich a Leistungsanfrage (TaktRequest) response object with canonical
 * German field aliases and legacy aliases.
 *
 * DB field mapping (canonical → legacy):
 *   leistungId (DB) ↔ taktId (legacy)
 *   leistungVersion (DB) ↔ taktVersion (legacy)
 */
function enrichLeistungsanfrage(obj: Record<string, unknown>): Record<string, unknown> {
  // Prefer canonical DB fields, fall back to legacy names
  const leistungId    = obj.leistungId    ?? obj.taktId      ?? null;
  const leistungVersion = obj.leistungVersion ?? obj.taktVersion ?? null;
  return {
    ...obj,
    // canonical API fields
    leistungsanfrageId: obj.id ?? obj.leistungsanfrageId ?? obj.taktRequestId ?? null,
    leistungId,
    leistungVersion,
    // legacy aliases for backward compat
    taktId:      leistungId,
    taktVersion: leistungVersion,
    // taktRequestId legacy alias
    taktRequestId: obj.id ?? obj.taktRequestId ?? obj.leistungsanfrageId ?? null,
  };
}

const EDITABLE_STATUSES = ["GEPLANT", "ABGELEHNT", "STORNIERT"] as const;

function isTaktEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

function redactInternalFields(
  takt: Record<string, unknown>,
  orgType: "AG" | "AN" | null | undefined,
): Record<string, unknown> {
  if (orgType === "AG") return takt;
  const {
    internalNote,
    costEstimate,
    procurementPriority,
    riskClassification,
    ...rest
  } = takt as {
    internalNote: unknown;
    costEstimate: unknown;
    procurementPriority: unknown;
    riskClassification: unknown;
    [k: string]: unknown;
  };
  void internalNote;
  void costEstimate;
  void procurementPriority;
  void riskClassification;
  return rest;
}

async function requireProjectOwner(
  req: Request,
  res: Response,
  projectId: string,
): Promise<{ id: string; agOrgId: string } | null> {
  const caller = req.user!;

  if (caller.orgType !== "AG" || !caller.orgId) {
    res.status(403).json({ error: "Forbidden: only AG organisations may access Leistung data" });
    return null;
  }

  const [project] = await db
    .select({ id: projectsTable.id, agOrgId: projectsTable.agOrgId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }

  if (project.agOrgId !== caller.orgId) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }

  return project;
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// Leistungen  (canonical aliases for /projects/:projectId/takte)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /projects/:projectId/leistungen ───────────────────────────────────────
router.get(
  "/projects/:projectId/leistungen",
  requireJwt,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const projectId = req.params.projectId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    const takte = await db
      .select()
      .from(leistungenTable)
      .where(eq(leistungenTable.projectId, projectId))
      .orderBy(leistungenTable.leistungsBezeichnung);

    res.json(
      takte.map((t) =>
        enrichLeistung(
          redactInternalFields(t as Record<string, unknown>, caller.orgType),
        ),
      ),
    );
  },
);

// ── POST /projects/:projectId/leistungen ──────────────────────────────────────
router.post(
  "/projects/:projectId/leistungen",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    // Normalise canonical input names before validation
    const normalisedBody = normaliseLeistungInput(req.body as Record<string, unknown>);

    const schema = z.object({
      taktBezeichnung: z.string().min(1),
      zone: z.string().min(1),
      gewerk: z.string().min(1),
      description: z.string().optional(),
      plannedStart: z.string(),
      plannedEnd: z.string().optional(),
      durationDays: z.number().min(0.5).optional(),
      earliestStart: z.string().optional(),
      latestEnd: z.string().optional(),
      lvReference: z.string().optional(),
      bimReference: z.string().optional(),
      requiredResources: z.string().optional(),
      internalNote: z.string().optional(),
      costEstimate: z.string().optional(),
      procurementPriority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
      riskClassification: z.enum(["A", "B", "C"]).optional(),
    });

    const parsed = schema.safeParse(normalisedBody);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    let plannedEnd = parsed.data.plannedEnd;
    const { durationDays, taktBezeichnung, ...restData } = parsed.data;
    if (durationDays != null) {
      const [calRow] = await db
        .select()
        .from(projectCalendarsTable)
        .where(eq(projectCalendarsTable.projectId, projectId))
        .limit(1);
      const cal = calRow ? toCalendarConfig(calRow) : DEFAULT_CALENDAR;
      plannedEnd = computePlannedEnd(parsed.data.plannedStart, durationDays, cal);
    }
    if (!plannedEnd) {
      res.status(400).json({ error: "plannedEnd or durationDays required" });
      return;
    }

    const [takt] = await db
      .insert(leistungenTable)
      .values({
        ...restData,
        leistungsBezeichnung: taktBezeichnung,
        plannedEnd,
        durationDays: durationDays != null ? String(durationDays) : null,
        projectId,
        status: "GEPLANT",
      })
      .returning();

    res.status(201).json(enrichLeistung(takt as unknown as Record<string, unknown>));
  },
);

// ── GET /projects/:projectId/leistungen/:leistungId ───────────────────────────
router.get(
  "/projects/:projectId/leistungen/:leistungId",
  requireJwt,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const projectId = req.params.projectId as string;
    const leistungId = req.params.leistungId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    const [takt] = await db
      .select()
      .from(leistungenTable)
      .where(
        and(
          eq(leistungenTable.id, leistungId),
          eq(leistungenTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!takt) {
      res.status(404).json({ error: "Leistung not found" });
      return;
    }

    res.json(
      enrichLeistung(
        redactInternalFields(takt as unknown as Record<string, unknown>, caller.orgType),
      ),
    );
  },
);

// ── PATCH /projects/:projectId/leistungen/:leistungId ─────────────────────────
router.patch(
  "/projects/:projectId/leistungen/:leistungId",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;
    const leistungId = req.params.leistungId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    const [existing] = await db
      .select()
      .from(leistungenTable)
      .where(
        and(
          eq(leistungenTable.id, leistungId),
          eq(leistungenTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Leistung not found" });
      return;
    }

    if (!isTaktEditable(existing.status)) {
      res.status(409).json({
        error: "Leistung cannot be edited in its current status",
        status: existing.status,
      });
      return;
    }

    const normalisedBody = normaliseLeistungInput(req.body as Record<string, unknown>);

    const schema = z.object({
      taktBezeichnung: z.string().min(1).optional(),
      zone: z.string().min(1).optional(),
      gewerk: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      plannedStart: z.string().optional(),
      plannedEnd: z.string().optional(),
      durationDays: z.number().min(0.5).optional().nullable(),
      earliestStart: z.string().optional().nullable(),
      latestEnd: z.string().optional().nullable(),
      lvReference: z.string().optional().nullable(),
      bimReference: z.string().optional().nullable(),
      requiredResources: z.string().optional().nullable(),
      internalNote: z.string().optional().nullable(),
      costEstimate: z.string().optional().nullable(),
      procurementPriority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().nullable(),
      riskClassification: z.enum(["A", "B", "C"]).optional().nullable(),
    });

    const parsed = schema.safeParse(normalisedBody);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { durationDays, taktBezeichnung: patchTaktBezeichnung, ...restPatchData } = parsed.data;
    let patchData: Record<string, unknown> = { ...restPatchData };
    // Map canonical API field back to canonical DB column name
    if (patchTaktBezeichnung !== undefined) {
      patchData.leistungsBezeichnung = patchTaktBezeichnung;
    }
    if (durationDays != null) {
      const startForCalc = parsed.data.plannedStart ?? existing.plannedStart;
      const [calRow] = await db
        .select()
        .from(projectCalendarsTable)
        .where(eq(projectCalendarsTable.projectId, projectId))
        .limit(1);
      const cal = calRow ? toCalendarConfig(calRow) : DEFAULT_CALENDAR;
      patchData.plannedEnd = computePlannedEnd(startForCalc, durationDays, cal);
      patchData.durationDays = String(durationDays);
    } else if (durationDays === null) {
      patchData.durationDays = null;
    }

    const result = await db.transaction(async (tx) => {
      const [takt] = await tx
        .update(leistungenTable)
        .set(patchData as any)
        .where(
          and(
            eq(leistungenTable.id, leistungId),
            eq(leistungenTable.projectId, projectId),
          ),
        )
        .returning();

      const { moved, conflicts } = await rescheduleTakte(projectId, tx);
      return { takt, moved, conflicts };
    });

    res.json({
      takt: enrichLeistung(result.takt as unknown as Record<string, unknown>),
      moved: result.moved.map((t) => enrichLeistung(t as unknown as Record<string, unknown>)),
      conflicts: result.conflicts.map((c) => ({
        ...c,
        takt: enrichLeistung(c.takt as unknown as Record<string, unknown>),
      })),
    });
  },
);

// ── DELETE /projects/:projectId/leistungen/:leistungId ────────────────────────
router.delete(
  "/projects/:projectId/leistungen/:leistungId",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;
    const leistungId = req.params.leistungId as string;

    const project = await requireProjectOwner(req, res, projectId);
    if (!project) return;

    const [existing] = await db
      .select()
      .from(leistungenTable)
      .where(
        and(
          eq(leistungenTable.id, leistungId),
          eq(leistungenTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Leistung not found" });
      return;
    }

    if (!isTaktEditable(existing.status)) {
      res.status(409).json({
        error: "Leistung cannot be deleted in its current status. Cancel the delegation first.",
        status: existing.status,
      });
      return;
    }

    await db
      .delete(leistungenTable)
      .where(
        and(
          eq(leistungenTable.id, leistungId),
          eq(leistungenTable.projectId, projectId),
        ),
      );
    res.status(204).send();
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// Leistungsabhaengigkeiten  (canonical aliases for /projects/:projectId/takt-dependencies)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /projects/:projectId/leistungsabhaengigkeiten ─────────────────────────
router.get(
  "/projects/:projectId/leistungsabhaengigkeiten",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.agOrgId !== req.user!.orgId!) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const rows = await db
      .select({
        dep: taktDependenciesTable,
        predecessor: leistungenTable,
      })
      .from(taktDependenciesTable)
      .innerJoin(leistungenTable, eq(taktDependenciesTable.predecessorId, leistungenTable.id))
      .where(eq(taktDependenciesTable.projectId, projectId));

    const allTakte = await db
      .select()
      .from(leistungenTable)
      .where(eq(leistungenTable.projectId, projectId));

    const taktMap = new Map(allTakte.map((t) => [t.id, t]));

    res.json(
      rows.map(({ dep, predecessor }) => ({
        ...dep,
        predecessor: enrichLeistung(predecessor as unknown as Record<string, unknown>),
        successor: taktMap.get(dep.successorId)
          ? enrichLeistung(taktMap.get(dep.successorId) as unknown as Record<string, unknown>)
          : null,
      })),
    );
  },
);

// ── POST /projects/:projectId/leistungsabhaengigkeiten ────────────────────────
router.post(
  "/projects/:projectId/leistungsabhaengigkeiten",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;

    const normalisedBody = normaliseLeistungInput(req.body as Record<string, unknown>);

    const schema = z.object({
      predecessorId: z.string(),
      successorId: z.string(),
      type: z.enum(["EA", "AA", "EE"]).default("EA"),
      lagDays: z.number().int().min(0).default(0),
    });

    const parsed = schema.safeParse(normalisedBody);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { predecessorId, successorId, type, lagDays } = parsed.data;

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.agOrgId !== req.user!.orgId!) {
      res.status(403).json({ error: "Only the AG organisation may manage dependencies" });
      return;
    }

    const [pred] = await db
      .select()
      .from(leistungenTable)
      .where(and(eq(leistungenTable.id, predecessorId), eq(leistungenTable.projectId, projectId)))
      .limit(1);

    const [succ] = await db
      .select()
      .from(leistungenTable)
      .where(and(eq(leistungenTable.id, successorId), eq(leistungenTable.projectId, projectId)))
      .limit(1);

    if (!pred || !succ) {
      res.status(404).json({ error: "One or both Leistungen not found in this project" });
      return;
    }

    const existing = await db
      .select({
        predecessorId: taktDependenciesTable.predecessorId,
        successorId: taktDependenciesTable.successorId,
      })
      .from(taktDependenciesTable)
      .where(eq(taktDependenciesTable.projectId, projectId));

    if (wouldCreateCycle(existing, predecessorId, successorId)) {
      res.status(409).json({ error: "Diese Abhängigkeit würde einen Zirkel erzeugen" });
      return;
    }

    const skipReschedule = req.query.skipReschedule === "true";

    const result = await db.transaction(async (tx) => {
      const [dep] = await tx
        .insert(taktDependenciesTable)
        .values({ projectId, predecessorId, successorId, type, lagDays })
        .returning();

      if (skipReschedule) {
        return {
          dependency: {
            ...dep,
            predecessor: enrichLeistung(pred as unknown as Record<string, unknown>),
            successor: enrichLeistung(succ as unknown as Record<string, unknown>),
          },
          moved: [],
          conflicts: [],
        };
      }
      const { moved, conflicts } = await rescheduleTakte(projectId, tx);
      return {
        dependency: {
          ...dep,
          predecessor: enrichLeistung(pred as unknown as Record<string, unknown>),
          successor: enrichLeistung(succ as unknown as Record<string, unknown>),
        },
        moved: moved.map((t) => enrichLeistung(t as unknown as Record<string, unknown>)),
        conflicts: conflicts.map((c) => ({
          ...c,
          takt: enrichLeistung(c.takt as unknown as Record<string, unknown>),
        })),
      };
    });

    res.status(201).json(result);
  },
);

// ── DELETE /projects/:projectId/leistungsabhaengigkeiten/:depId ───────────────
router.delete(
  "/projects/:projectId/leistungsabhaengigkeiten/:depId",
  requireJwt,
  async (req, res): Promise<void> => {
    const projectId = req.params.projectId as string;
    const depId = req.params.depId as string;

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project || project.agOrgId !== req.user!.orgId!) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [existing] = await db
      .select()
      .from(taktDependenciesTable)
      .where(
        and(
          eq(taktDependenciesTable.id, depId),
          eq(taktDependenciesTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Dependency not found" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      await tx.delete(taktDependenciesTable).where(eq(taktDependenciesTable.id, depId));
      const { moved, conflicts } = await rescheduleTakte(projectId, tx);
      return { moved, conflicts };
    });

    res.json(result);
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// Leistungsanfragen  (canonical aliases for /takt-requests)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /leistungsanfragen ────────────────────────────────────────────────────
router.get(
  "/leistungsanfragen",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;
    const { role, status, leistungId, taktId, nuOrgId } = req.query as Record<string, string>;

    const validStatuses: TaktRequestStatus[] = [
      "DRAFT", "SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW",
      "ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED", "REVISION_REQUIRED",
      "CANCELLED", "EXPIRED", "SUPERSEDED",
    ];

    const statusFilter =
      status && (validStatuses as string[]).includes(status)
        ? (status as TaktRequestStatus)
        : undefined;

    // canonical leistungId takes precedence over legacy taktId
    const taktIdFilter = leistungId ?? taktId ?? undefined;

    if (role === "nu") {
      const requests = await listTaktRequestsForNuEnriched(orgId, { status: statusFilter });
      res.json(requests.map((r) => enrichLeistungsanfrage(r as unknown as Record<string, unknown>)));
      return;
    }

    const requests = await listTaktRequestsForGuEnriched(orgId, {
      status: statusFilter,
      taktId: taktIdFilter,
      nuOrgId: nuOrgId ?? undefined,
    });
    res.json(requests.map((r) => enrichLeistungsanfrage(r as unknown as Record<string, unknown>)));
  },
);

// ── POST /projects/:projectId/leistungsanfragen ───────────────────────────────
// Legacy-path alias under project context — delegates to createTaktRequestWithSnapshot.
router.post(
  "/projects/:projectId/leistungsanfragen",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const userId = req.user!.userId!;

    const normalisedBody = normaliseLeistungInput(req.body as Record<string, unknown>);

    const schema = z.object({
      taktId:             z.string().min(1),
      nuOrgId:            z.string().min(1),
      requestNumber:      z.string().min(1).optional(),
      responseRequiredBy: z.string().datetime({ offset: true }).optional(),
      dataPublicationId:  z.string().min(1).optional(),
    });

    const parsed = schema.safeParse(normalisedBody);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { taktId, nuOrgId, responseRequiredBy } = parsed.data;
    const requestNumber =
      parsed.data.requestNumber ?? `TKR-${Date.now().toString(36).toUpperCase()}`;

    if (responseRequiredBy) {
      const deadline = new Date(responseRequiredBy);
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      if (deadline < oneHourFromNow) {
        res
          .status(400)
          .json({ error: "Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen." });
        return;
      }
    }

    let result;
    try {
      result = await createTaktRequestWithSnapshot({
        taktId,
        guOrgId,
        nuOrgId,
        requestNumber,
        responseRequiredBy: responseRequiredBy ? new Date(responseRequiredBy) : undefined,
        createdByUserId: userId,
        dataPublicationId: parsed.data.dataPublicationId,
      });
    } catch (err) {
      if (err instanceof TaktNotFoundError) {
        res.status(404).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof UnauthorizedSnapshotError) {
        res.status(403).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof NuNotContractorError) {
        res.status(403).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof InvalidTaktForSnapshotError) {
        res.status(422).json({ error: (err as Error).message });
        return;
      }
      throw err;
    }

    await writeAuditEvent({
      requestId: result.request.id,
      eventType: "REQUEST_CREATED",
      actorOrgId: guOrgId,
      actorUserId: userId,
      actorRole: "GU",
      metadata: {
        requestNumber: result.request.requestNumber,
        nuOrgId: parsed.data.nuOrgId,
        leistungId: parsed.data.taktId,
      },
    });
    await writeAuditEvent({
      requestId: result.request.id,
      eventType: "SNAPSHOT_CREATED",
      actorOrgId: guOrgId,
      actorUserId: userId,
      actorRole: "GU",
      metadata: { snapshotId: result.snapshot.id, leistungVersion: result.request.taktVersion },
    });

    res.status(201).json(
      enrichLeistungsanfrage({
        id:                 result.request.id,
        // taktId / taktVersion are the declared field names from the service return type
        // enrichLeistungsanfrage will also add leistungId / leistungVersion aliases
        taktId:             result.request.taktId,
        taktVersion:        result.request.taktVersion,
        guOrgId:            result.request.guOrgId,
        nuOrgId:            result.request.nuOrgId,
        requestNumber:      result.request.requestNumber,
        status:             result.request.status,
        responseRequiredBy: result.request.responseRequiredBy ?? null,
        snapshotId:         result.snapshot.id,
        createdAt:          result.request.createdAt,
      }),
    );
  },
);

// ── POST /leistungsanfragen ───────────────────────────────────────────────────
// Canonical GU creates a Leistungsanfrage DRAFT with snapshot.
router.post(
  "/leistungsanfragen",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const userId = req.user!.userId!;

    const normalisedBody = normaliseLeistungInput(req.body as Record<string, unknown>);

    const bodySchema = z.object({
      taktId:             z.string().min(1),
      nuOrgId:            z.string().min(1),
      responseRequiredBy: z.string().datetime({ offset: true }).optional(),
      subject:            z.string().max(255).optional(),
      message:            z.string().max(2000).optional(),
      dataPublicationId:  z.string().min(1).optional(),
    });

    const parsed = bodySchema.safeParse(normalisedBody);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { taktId, nuOrgId, responseRequiredBy, subject, message } = parsed.data;

    if (responseRequiredBy) {
      const deadline = new Date(responseRequiredBy);
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      if (deadline < oneHourFromNow) {
        res
          .status(400)
          .json({ error: "Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen." });
        return;
      }
    }

    const requestNumber = `TKR-${Date.now().toString(36).toUpperCase()}`;

    let result;
    try {
      result = await createTaktRequestWithSnapshot({
        taktId,
        guOrgId,
        nuOrgId,
        requestNumber,
        responseRequiredBy: responseRequiredBy ? new Date(responseRequiredBy) : undefined,
        createdByUserId: userId,
        subject,
        message,
        dataPublicationId: parsed.data.dataPublicationId,
      });
    } catch (err) {
      if (err instanceof TaktNotFoundError) {
        res.status(404).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof UnauthorizedSnapshotError) {
        res.status(403).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof NuNotContractorError) {
        res.status(403).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof InvalidTaktForSnapshotError) {
        res.status(422).json({ error: (err as Error).message });
        return;
      }
      throw err;
    }

    await writeAuditEvent({
      requestId: result.request.id,
      eventType: "REQUEST_CREATED",
      actorOrgId: guOrgId,
      actorUserId: userId,
      actorRole: "GU",
      metadata: { requestNumber: result.request.requestNumber, nuOrgId, leistungId: taktId },
    });
    await writeAuditEvent({
      requestId: result.request.id,
      eventType: "SNAPSHOT_CREATED",
      actorOrgId: guOrgId,
      actorUserId: userId,
      actorRole: "GU",
      metadata: { snapshotId: result.snapshot.id, leistungVersion: result.request.taktVersion },
    });

    res.status(201).json(
      enrichLeistungsanfrage({
        id:                 result.request.id,
        // taktId / taktVersion are the declared field names from the service return type
        // enrichLeistungsanfrage will also add leistungId / leistungVersion aliases
        taktId:             result.request.taktId,
        taktVersion:        result.request.taktVersion,
        guOrgId:            result.request.guOrgId,
        nuOrgId:            result.request.nuOrgId,
        requestNumber:      result.request.requestNumber,
        status:             result.request.status,
        responseRequiredBy: result.request.responseRequiredBy ?? null,
        snapshotId:         result.snapshot.id,
        createdAt:          result.request.createdAt,
      }),
    );
  },
);

// ── GET /leistungsanfragen/:id ────────────────────────────────────────────────
router.get(
  "/leistungsanfragen/:id",
  requireJwt,
  async (req, res): Promise<void> => {
    const callerOrgId = req.user!.orgId;
    const isHubAdmin = req.user!.hubAdmin;
    const id = req.params.id as string;

    if (isHubAdmin || !callerOrgId) {
      res.status(403).json({ error: "Hub admins may not access Leistungsanfrage detail views." });
      return;
    }

    const detail = await getTaktRequestDetailForGu(id, callerOrgId);

    if (!detail) {
      res.status(404).json({ error: "Leistungsanfrage not found." });
      return;
    }

    res.json(enrichLeistungsanfrage(detail as unknown as Record<string, unknown>));
  },
);

// ── POST /leistungsanfragen/:id/send ─────────────────────────────────────────
// Re-uses the exact same logic as POST /takt-requests/:id/send.
router.post(
  "/leistungsanfragen/:id/send",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const id = req.params.id as string;

    const existing = await getTaktRequestById(id);
    if (!existing) {
      res.status(404).json({ error: "Leistungsanfrage not found" });
      return;
    }
    if (existing.guOrgId !== guOrgId) {
      res.status(403).json({ error: "Only the GU organisation may send this request" });
      return;
    }

    if (existing.status === "DELIVERED") {
      const taktRow = await db
        .select()
        .from(leistungenTable)
        .where(eq(leistungenTable.id, existing.taktId))
        .limit(1)
        .then((r) => r[0]);

      res.status(200).json(
        enrichLeistungsanfrage({
          requestId: existing.id,
          leistungsanfrageId: existing.id,
          status: existing.status,
          sentAt: existing.sentAt ?? null,
          deliveredAt: existing.deliveredAt ?? null,
          messageId: notificationMessageId(id),
          taktLifecycleStatus: taktRow?.lifecycleStatus ?? null,
        }),
      );
      return;
    }

    if (existing.status !== "DRAFT") {
      res.status(409).json({
        error: `Cannot send a Leistungsanfrage with status "${existing.status}". Only DRAFT requests may be sent.`,
      });
      return;
    }

    const snapResult = await getTaktRequestWithSnapshot(id);
    if (!snapResult?.snapshot) {
      res.status(422).json({
        error:
          "Cannot send Leistungsanfrage: no snapshot exists. " +
          "Create the request via POST /leistungsanfragen which creates a snapshot atomically at creation time.",
      });
      return;
    }

    let pubPolicyCode: string | null = null;

    if (existing.dataPublicationId) {
      const [pub] = await db
        .select()
        .from(dataPublicationsTable)
        .where(eq(dataPublicationsTable.id, existing.dataPublicationId))
        .limit(1);

      if (!pub) {
        res.status(409).json({ error: "DATA_PUBLICATION_NOT_FOUND" });
        return;
      }
      if (pub.dataProductType !== "TAKT_INFORMATION_PACKAGE") {
        res.status(409).json({
          error: "DATA_PUBLICATION_WRONG_TYPE",
          message: "Die verknüpfte Veröffentlichung muss vom Typ TAKT_INFORMATION_PACKAGE sein.",
        });
        return;
      }
      if (pub.status !== "PUBLISHED") {
        res.status(409).json({
          error: "DATA_PUBLICATION_NOT_PUBLISHED",
          message: "Die verknüpfte Veröffentlichung muss den Status PUBLISHED haben.",
          publicationStatus: pub.status,
        });
        return;
      }
      const [taktForPub] = await db
        .select({ projectId: leistungenTable.projectId })
        .from(leistungenTable)
        .where(eq(leistungenTable.id, existing.taktId))
        .limit(1);
      if (!taktForPub || pub.projectId !== taktForPub.projectId) {
        res.status(409).json({
          error: "DATA_PUBLICATION_WRONG_PROJECT",
          message: "Die Veröffentlichung gehört nicht zum Projekt dieses Takts.",
        });
        return;
      }
      if (pub.selectedTaktIds && !pub.selectedTaktIds.includes(existing.taktId)) {
        res.status(409).json({
          error: "DATA_PUBLICATION_TAKT_NOT_INCLUDED",
          message: "Der Takt ist nicht in der Veröffentlichung enthalten.",
        });
        return;
      }
      const [pubRecipient] = await db
        .select({ id: dataPublicationRecipientsTable.id })
        .from(dataPublicationRecipientsTable)
        .where(
          and(
            eq(dataPublicationRecipientsTable.publicationId, pub.id),
            eq(dataPublicationRecipientsTable.anOrgId, existing.nuOrgId),
          ),
        )
        .limit(1);
      if (!pubRecipient) {
        res.status(409).json({
          error: "DATA_PUBLICATION_AN_NOT_RECIPIENT",
          message: "Der adressierte AN ist kein Empfänger der Veröffentlichung.",
        });
        return;
      }
      const [loadedPolicy] = await db
        .select({ code: policyTemplatesTable.code })
        .from(policyTemplatesTable)
        .where(eq(policyTemplatesTable.id, pub.policyTemplateId))
        .limit(1);
      pubPolicyCode = loadedPolicy?.code ?? null;
    }

    const currentSnap = snapResult?.snapshot;
    const snapPayload = (currentSnap?.snapshotPayload as Record<string, unknown> | null) ?? {};
    const coordCtx =
      (snapPayload.coordinationContext as Record<string, unknown> | undefined) ?? {};

    const notificationPayload = {
      leistungsanfrageId: id,
      taktRequestId: id,   // legacy alias
      projectReference: snapPayload.projectReference ?? existing.taktId,
      leistungReference: existing.taktId,
      taktReference: existing.taktId,    // legacy alias
      leistungVersion: existing.taktVersion,
      taktVersion: existing.taktVersion, // legacy alias
      responseRequiredBy: existing.responseRequiredBy?.toISOString() ?? null,
      detailsRef: `/leistungsanfragen/${id}/details`,
      subject: (coordCtx.subject as string | undefined) ?? null,
      message: (coordCtx.message as string | undefined) ?? null,
      dataPublicationId: existing.dataPublicationId ?? null,
      policyCode: pubPolicyCode,
      dataOfferRef: existing.dataPublicationId
        ? `/an/data-offers/${existing.dataPublicationId}`
        : null,
    };

    const envelope = {
      messageId: notificationMessageId(id),
      schemaVersion: "1.0",
      messageType: DataspaceMessageType.TAKT_REQUEST_NOTIFICATION,
      senderOrgId: guOrgId,
      recipientOrgId: existing.nuOrgId,
      correlationId: id,
      createdAt: new Date(),
      causationId: null,
      payload: notificationPayload,
    };

    const transportResult = await safeSend(envelope, res);
    if (!transportResult) return;

    const now = new Date();
    let finalRequest;

    if (transportResult.status === "DELIVERED") {
      try {
        await updateTaktRequestStatus(id, "SENT", { sentAt: transportResult.sentAt ?? now });
        finalRequest = await updateTaktRequestStatus(id, "DELIVERED", {
          deliveredAt: transportResult.deliveredAt ?? now,
        });
      } catch (err) {
        if (err instanceof TaktRequestTransitionError) {
          finalRequest = await getTaktRequestById(id);
        } else {
          throw err;
        }
      }

      await db
        .update(leistungenTable)
        .set({ lifecycleStatus: "IN_COORDINATION" })
        .where(eq(leistungenTable.id, existing.taktId));

      await db.insert(hubMessagesTable).values({
        type: "TAKT_REQUEST_SENT",
        senderOrgId: guOrgId,
        recipientOrgId: existing.nuOrgId,
        correlationId: id,
        payload: { leistungsanfrageId: id, leistungId: existing.taktId },
      });

      await writeAuditEvent({
        requestId: id,
        eventType: "NOTIFICATION_SENT",
        actorOrgId: guOrgId,
        actorUserId: req.user!.userId,
        actorRole: "GU",
        metadata: { transportMessageId: transportResult.messageId },
      });
      await writeAuditEvent({
        requestId: id,
        eventType: "NOTIFICATION_DELIVERED",
        actorOrgId: guOrgId,
        actorUserId: req.user!.userId,
        actorRole: "GU",
        metadata: {
          transportMessageId: transportResult.messageId,
          deliveredAt: (transportResult.deliveredAt ?? new Date()).toISOString(),
        },
      });

      const [taktAfter] = await db
        .select()
        .from(leistungenTable)
        .where(eq(leistungenTable.id, existing.taktId))
        .limit(1);

      res.status(200).json(
        enrichLeistungsanfrage({
          requestId: id,
          status: finalRequest?.status ?? "DELIVERED",
          sentAt: finalRequest?.sentAt ?? transportResult.sentAt,
          deliveredAt: finalRequest?.deliveredAt ?? transportResult.deliveredAt,
          messageId: transportResult.messageId,
          taktLifecycleStatus: taktAfter?.lifecycleStatus ?? "IN_COORDINATION",
        }),
      );
    } else {
      try {
        finalRequest = await updateTaktRequestStatus(id, "SENT", { sentAt: now });
      } catch (transitionErr) {
        if (!(transitionErr instanceof TaktRequestTransitionError)) throw transitionErr;
        finalRequest = existing;
      }

      res.status(502).json({
        error: `Transport delivery failed: ${transportResult.error?.message ?? "unknown error"}`,
        requestId: id,
        status: finalRequest?.status ?? "SENT",
        messageId: transportResult.messageId,
      });
    }
  },
);

// ── GET /leistungsanfragen/:id/details ───────────────────────────────────────
router.get(
  "/leistungsanfragen/:id/details",
  requireJwt,
  async (req, res): Promise<void> => {
    const callerOrgId = req.user!.orgId;
    const isHubAdmin = req.user!.hubAdmin;
    const id = req.params.id as string;

    const result = await getTaktRequestWithSnapshot(id);
    if (!result) {
      res.status(404).json({ error: "Leistungsanfrage not found" });
      return;
    }
    const { request, snapshot } = result;

    const isAddressedNu = callerOrgId === request.nuOrgId;
    const isOwnerGu = callerOrgId === request.guOrgId;

    if (isHubAdmin || (!isAddressedNu && !isOwnerGu)) {
      res.status(403).json({
        error:
          "Access denied. Only the addressed NU or the creating GU organisation may retrieve these details.",
      });
      return;
    }

    if (!snapshot) {
      res.status(404).json({ error: "Snapshot is not yet available for this Leistungsanfrage." });
      return;
    }

    const RETRIEVABLE_STATUSES = new Set<string>([
      "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW",
      "ALTERNATIVES_PROPOSED", "ACCEPTED", "REJECTED", "REVISION_REQUIRED",
    ]);

    if (isAddressedNu && !RETRIEVABLE_STATUSES.has(request.status)) {
      res.status(409).json({
        error:
          `Leistungsanfrage cannot be retrieved in status "${request.status}". ` +
          `Details are available once the request is DELIVERED.`,
        currentStatus: request.status,
      });
      return;
    }

    if (isAddressedNu && !request.dataPublicationId) {
      res.status(403).json({
        error: "LEGACY_NO_PUBLICATION",
        message:
          "Diese Leistungsanfrage wurde ohne Datenraum-Veröffentlichung erstellt.",
      });
      return;
    }

    if (isAddressedNu && request.dataPublicationId) {
      const [gatePub] = await db
        .select({ status: dataPublicationsTable.status })
        .from(dataPublicationsTable)
        .where(eq(dataPublicationsTable.id, request.dataPublicationId))
        .limit(1);

      if (
        !gatePub ||
        gatePub.status === "SUSPENDED" ||
        gatePub.status === "WITHDRAWN" ||
        gatePub.status === "EXPIRED"
      ) {
        res.status(403).json({
          error: "DATA_PUBLICATION_INACTIVE",
          message: "Die zugehörige Datenveröffentlichung ist nicht mehr aktiv.",
          publicationStatus: gatePub?.status ?? "NOT_FOUND",
          dataPublicationId: request.dataPublicationId,
          dataOfferRef: `/an/data-offers/${request.dataPublicationId}`,
        });
        return;
      }

      const [gateRecipient] = await db
        .select({
          status: dataPublicationRecipientsTable.status,
          policyAcceptedAt: dataPublicationRecipientsTable.policyAcceptedAt,
        })
        .from(dataPublicationRecipientsTable)
        .where(
          and(
            eq(dataPublicationRecipientsTable.publicationId, request.dataPublicationId),
            eq(dataPublicationRecipientsTable.anOrgId, callerOrgId!),
          ),
        )
        .limit(1);

      if (
        !gateRecipient ||
        gateRecipient.status !== "ACCEPTED" ||
        !gateRecipient.policyAcceptedAt
      ) {
        res.status(403).json({
          error: "POLICY_ACCEPTANCE_REQUIRED",
          message: "Bitte akzeptieren Sie zunächst die Nutzungs-Policy.",
          dataPublicationId: request.dataPublicationId,
          dataOfferRef: `/an/data-offers/${request.dataPublicationId}`,
          recipientStatus: gateRecipient?.status ?? "OFFERED",
        });
        return;
      }
    }

    let updatedRequest = request;
    let firstAccessTransitionSucceeded = false;
    if (isAddressedNu && request.status === "DELIVERED") {
      const transitioned = await transitionToDetailsRetrievedAtomic(id, new Date());
      if (transitioned) {
        updatedRequest = transitioned;
        firstAccessTransitionSucceeded = true;
      } else {
        updatedRequest = (await getTaktRequestWithSnapshot(id))?.request ?? request;
      }
    }

    if (firstAccessTransitionSucceeded) {
      await writeAuditEvent({
        requestId: id,
        eventType: "DETAILS_RETRIEVED",
        actorOrgId: callerOrgId ?? null,
        actorUserId: req.user!.userId,
        actorRole: "NU",
        metadata: {
          firstAccess: true,
          requestStatusBefore: "DELIVERED",
          requestStatusAfter: updatedRequest.status,
        },
      });
    }

    res.json(
      enrichLeistungsanfrage({
        id,
        leistungsanfrageId: id,
        taktRequestId:      id,   // legacy alias
        requestNumber:      updatedRequest.requestNumber,
        schemaVersion:      snapshot.schemaVersion,
        leistungVersion:    updatedRequest.taktVersion,
        taktVersion:        updatedRequest.taktVersion, // legacy alias
        status:             updatedRequest.status,
        guOrgId:            updatedRequest.guOrgId,
        nuOrgId:            updatedRequest.nuOrgId,
        responseRequiredBy: updatedRequest.responseRequiredBy?.toISOString() ?? null,
        detailsRetrievedAt: updatedRequest.detailsRetrievedAt?.toISOString() ?? null,
        snapshotPayload:    snapshot.snapshotPayload,
        createdAt:          snapshot.createdAt.toISOString(),
      }),
    );
  },
);

// ── POST /leistungsanfragen/:id/availability-checks ───────────────────────────
router.post(
  "/leistungsanfragen/:id/availability-checks",
  requireJwt,
  requireRole("AN_ADMIN", "AN_DISPATCHER"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const id = req.params.id as string;

    if (!user.orgId || user.orgType !== "AN" || user.hubAdmin) {
      res
        .status(403)
        .json({ error: "Only NU (AN) organisations may run availability checks" });
      return;
    }
    const nuOrgId = user.orgId;
    const userId = user.userId!;

    try {
      const check = await runAvailabilityCheck(id, nuOrgId, userId);
      res.status(201).json(formatCheckResponse(check));
    } catch (err) {
      if (err instanceof AvailabilityCheckError) {
        const status =
          (err as any).code === "REQUEST_NOT_FOUND"  ? 404 :
          (err as any).code === "SNAPSHOT_MISSING"   ? 404 :
          (err as any).code === "WRONG_NU_ORG"       ? 403 :
          (err as any).code === "INVALID_STATUS"     ? 409 :
          (err as any).code === "INVALID_TIME_WINDOW"? 422 : 400;
        res.status(status).json({ error: (err as Error).message, code: (err as any).code });
        return;
      }
      throw err;
    }
  },
);

// ── GET /leistungsanfragen/:id/availability-checks/latest ─────────────────────
router.get(
  "/leistungsanfragen/:id/availability-checks/latest",
  requireJwt,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const id = req.params.id as string;

    if (!user.orgId || user.orgType !== "AN" || user.hubAdmin) {
      res
        .status(403)
        .json({ error: "Only NU (AN) organisations may access availability checks" });
      return;
    }
    const nuOrgId = user.orgId;

    const request = await getTaktRequestById(id);
    if (!request) {
      res.status(404).json({ error: "Leistungsanfrage not found" });
      return;
    }
    if (request.nuOrgId !== nuOrgId) {
      res
        .status(403)
        .json({ error: "Only the addressed NU organisation may access these checks" });
      return;
    }

    const check = await getLatestAvailabilityCheck(id, nuOrgId);
    if (!check) {
      res.status(404).json({ error: "No availability checks found for this Leistungsanfrage" });
      return;
    }

    res.json(formatCheckResponse(check));
  },
);

// ── POST /leistungsanfragen/:id/responses ─────────────────────────────────────
// NU submits a business response.
router.post(
  "/leistungsanfragen/:id/responses",
  requireJwt,
  requireRole("AN_ADMIN", "AN_DISPATCHER"),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const id = req.params.id as string;

    if (!user.orgId || user.orgType !== "AN" || user.hubAdmin) {
      res
        .status(403)
        .json({ error: "Only NU (AN) organisations may submit a Leistungsanfrage response" });
      return;
    }
    const nuOrgId = user.orgId;
    const userId = user.userId!;

    const alternativeSchema = z.object({
      alternativeId: z.string().min(1),
      rank:          z.number().int().min(1),
      timeWindow:    z.object({ start: z.string().min(1), end: z.string().min(1) }),
      crewSize:      z.number().int().min(1).optional(),
      conditions:    z.array(z.string()).optional(),
    });

    const bodySchema = z.object({
      decision:           z.enum(["ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED"]),
      acceptedTimeWindow: z.object({ start: z.string().min(1), end: z.string().min(1) }).optional(),
      reasonCode:         z.enum([
        "RESOURCE_CONFLICT", "NO_CAPACITY", "EQUIPMENT_UNAVAILABLE",
        "QUALIFICATION_MISSING", "TIME_WINDOW_TOO_SHORT",
        "OUTSIDE_PLANNING_HORIZON", "OTHER",
      ]).optional(),
      comment:            z.string().max(2000).optional(),
      alternatives:       z.array(alternativeSchema).max(3).optional(),
      nextAvailableDate:  z.string().optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const request = await getTaktRequestById(id);
    if (!request) {
      res.status(404).json({ error: "Leistungsanfrage not found" });
      return;
    }
    if (request.nuOrgId !== nuOrgId) {
      res
        .status(403)
        .json({ error: "Only the addressed NU organisation may respond" });
      return;
    }

    const { decision, acceptedTimeWindow, reasonCode, comment, alternatives, nextAvailableDate } =
      parsed.data;

    const ANSWERABLE_STATUSES = new Set(["UNDER_REVIEW", "DETAILS_RETRIEVED", "REVISION_REQUIRED"]);
    const msgId = `taktresponse-${id}`;

    let result;
    try {
      result = await processNuResponse({
        taktRequestId:        id,
        nuOrgId,
        userId,
        decision,
        acceptedTimeWindow,
        reasonCode,
        comment,
        alternatives,
        nextAvailableDate,
        answerableStatuses:   ANSWERABLE_STATUSES,
        currentRequestStatus: request.status,
        messageId:            msgId,
      });
    } catch (err) {
      if (err instanceof TaktResponseValidationError) {
        res.status(422).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof ResponseConflictError) {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof ResponseStatusError) {
        res.status(409).json({ error: (err as Error).message, currentStatus: request.status });
        return;
      }
      throw err;
    }

    const guPayload = {
      taktRequestId: id,
      decision,
      reasonCode:         reasonCode         ?? null,
      comment:            comment            ?? null,
      acceptedTimeWindow: acceptedTimeWindow ?? null,
      alternatives: alternatives?.map((a) => ({
        alternativeId: a.alternativeId,
        rank:          a.rank,
        timeWindow:    a.timeWindow,
        crewSize:      a.crewSize   ?? null,
        conditions:    a.conditions ?? null,
      })) ?? null,
      nextAvailableDate: nextAvailableDate ?? null,
    };

    if (result.idempotent) {
      const [existingOutbox] = await db
        .select()
        .from(messageOutboxTable)
        .where(eq(messageOutboxTable.messageId, msgId))
        .limit(1);

      res.status(200).json(
        enrichLeistungsanfrage({
          responseId:         result.response.id,
          taktRequestId:      id,
          decision:           result.response.decision,
          reasonCode:         result.response.reasonCode ?? null,
          comment:            result.response.comment    ?? null,
          acceptedTimeWindow: result.response.acceptedStart
            ? {
                start: result.response.acceptedStart.toISOString(),
                end:   result.response.acceptedEnd!.toISOString(),
              }
            : null,
          alternatives: result.alternatives.map((a) => ({
            alternativeId: a.alternativeId,
            rank:          a.rank,
            timeWindow:    { start: a.proposedStart.toISOString(), end: a.proposedEnd.toISOString() },
            crewSize:      a.crewSize   ?? null,
            conditions:    a.conditions ?? null,
          })),
          nextAvailableDate:  result.response.nextAvailableDate ?? null,
          transportStatus:    existingOutbox?.status ?? "UNKNOWN",
          transportMessageId: existingOutbox?.messageId ?? msgId,
          requestStatus:      result.newStatus,
          createdAt:          result.response.createdAt.toISOString(),
        }),
      );
      return;
    }

    const envelope = {
      messageId:      msgId,
      schemaVersion:  "1.0",
      messageType:    DataspaceMessageType.TAKT_RESPONSE_SUBMITTED,
      senderOrgId:    nuOrgId,
      recipientOrgId: request.guOrgId,
      correlationId:  id,
      createdAt:      new Date(),
      causationId:    null,
      payload:        guPayload,
    };

    const transportResult = await safeSend(envelope, res);
    if (!transportResult) return;

    await writeAuditEvent({
      requestId: id, eventType: "RESPONSE_SUBMITTED",
      actorOrgId: nuOrgId, actorUserId: userId, actorRole: "NU",
      metadata: {
        decision,
        reasonCode: reasonCode ?? null,
        transportMessageId: transportResult.messageId,
        transportStatus: transportResult.status,
      },
    });
    if (transportResult.status === "DELIVERED") {
      await writeAuditEvent({
        requestId: id, eventType: "RESPONSE_DELIVERED",
        actorOrgId: nuOrgId, actorUserId: userId, actorRole: "NU",
        metadata: { transportMessageId: transportResult.messageId },
      });
    }

    res.status(201).json(
      enrichLeistungsanfrage({
        responseId:         result.response.id,
        taktRequestId:      id,
        decision:           result.response.decision,
        reasonCode:         result.response.reasonCode ?? null,
        comment:            result.response.comment    ?? null,
        acceptedTimeWindow: result.response.acceptedStart
          ? {
              start: result.response.acceptedStart.toISOString(),
              end:   result.response.acceptedEnd!.toISOString(),
            }
          : null,
        alternatives: result.alternatives.map((a) => ({
          alternativeId: a.alternativeId,
          rank:          a.rank,
          timeWindow:    { start: a.proposedStart.toISOString(), end: a.proposedEnd.toISOString() },
          crewSize:      a.crewSize   ?? null,
          conditions:    a.conditions ?? null,
        })),
        nextAvailableDate:  result.response.nextAvailableDate ?? null,
        transportStatus:    transportResult.status,
        transportMessageId: transportResult.messageId,
        requestStatus:      result.newStatus,
        createdAt:          result.response.createdAt.toISOString(),
      }),
    );
  },
);

// ── POST /leistungsanfragen/:id/gu-decisions ──────────────────────────────────
router.post(
  "/leistungsanfragen/:id/gu-decisions",
  requireJwt,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const id = req.params.id as string;

    if (user.hubAdmin || !user.orgId) {
      res.status(403).json({ error: "Hub admins may not create GU decisions" });
      return;
    }
    if (user.orgType !== "AG") {
      res.status(403).json({ error: "Only GU (AG) organisations may create GU decisions" });
      return;
    }

    const guOrgId = user.orgId;
    const userId = user.userId!;

    const bodySchema = z.object({
      decisionType: z.enum([
        "CONFIRM_ACCEPTED",
        "ACCEPT_ALTERNATIVE",
        "REQUEST_REVISION",
        "CLOSE_WITHOUT_AGREEMENT",
      ]),
      acceptedAlternativeId: z.string().min(1).optional(),
      comment:               z.string().max(2000).optional(),
      idempotencyKey:        z.string().min(1).max(255).optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { decisionType, acceptedAlternativeId, comment, idempotencyKey } = parsed.data;
    const idempotencyKeyFinal =
      idempotencyKey ??
      (req.headers["idempotency-key"] as string | undefined) ??
      null;

    try {
      const result = await createGuDecision({
        taktRequestId:         id,
        guOrgId,
        userId,
        decisionType:          decisionType as TaktCoordinationDecisionType,
        acceptedAlternativeId: acceptedAlternativeId ?? null,
        comment:               comment ?? null,
        idempotencyKey:        idempotencyKeyFinal,
      });

      const { decision, updatedRequest, newTaktVersion, idempotent } = result;

      if (!idempotent) {
        const guDecisionHubType =
          decisionType === "CONFIRM_ACCEPTED"          ? "TAKT_REQUEST_CONFIRMED"
          : decisionType === "ACCEPT_ALTERNATIVE"      ? "TAKT_REQUEST_ALT_ACCEPTED"
          : decisionType === "CLOSE_WITHOUT_AGREEMENT" ? "TAKT_REQUEST_CLOSED"
          : decisionType === "REQUEST_REVISION"        ? "TAKT_REQUEST_REVISION_REQUESTED"
          : null;

        if (guDecisionHubType) {
          const taktReq = await getTaktRequestById(id);
          if (taktReq) {
            await db.insert(hubMessagesTable).values({
              type: guDecisionHubType as any,
              senderOrgId: guOrgId,
              recipientOrgId: taktReq.nuOrgId,
              correlationId: id,
              payload: { taktRequestId: id, decisionType, comment: comment ?? null },
            });
          }
        }

        await writeAuditEvent({
          requestId: id,
          eventType: "GU_DECISION_MADE",
          actorOrgId: guOrgId,
          actorUserId: userId,
          actorRole: "GU",
          metadata: {
            decisionType,
            acceptedAlternativeId: acceptedAlternativeId ?? null,
            updatedRequestStatus: updatedRequest.status,
          },
        });
      }

      res.status(idempotent ? 200 : 201).json({
        decisionId:            decision.id,
        leistungsanfrageId:    decision.taktRequestId,
        taktRequestId:         decision.taktRequestId,  // legacy alias
        responseId:            decision.responseId,
        decisionType:          decision.decisionType,
        acceptedAlternativeId: decision.acceptedAlternativeId ?? null,
        comment:               decision.comment ?? null,
        decidedAt:             decision.decidedAt,
        createdAt:             decision.createdAt,
        updatedRequestStatus:  updatedRequest.status,
        newTaktVersion:        newTaktVersion?.version ?? null,
        newTaktVersionId:      newTaktVersion?.id      ?? null,
        idempotent,
      });
    } catch (err) {
      if (err instanceof GuDecisionError) {
        res.status((err as any).statusCode).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof GuDecisionIdempotencyConflict) {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof VersionConflictError) {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof TaktRequestTransitionError) {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      throw err;
    }
  },
);

// ── POST /leistungsanfragen/:id/revisions ─────────────────────────────────────
router.post(
  "/leistungsanfragen/:id/revisions",
  requireJwt,
  async (req, res): Promise<void> => {
    const guOrgId = req.user!.orgId!;
    const userId = req.user!.userId!;
    const id = req.params.id as string;

    const normalisedBody = normaliseLeistungInput(req.body as Record<string, unknown>);

    const bodySchema = z.object({
      plannedTimeWindow: z.object({
        start: z.string().min(1),
        end:   z.string().min(1),
      }),
      responseRequiredBy: z.string().optional().nullable(),
      subject:            z.string().optional().nullable(),
      message:            z.string().optional().nullable(),
      sendImmediately:    z.boolean().optional().default(false),
      idempotencyKey:     z.string().optional().nullable(),
      taktUpdates: z
        .object({
          taktBezeichnung:   z.string().optional(),
          zone:              z.string().optional(),
          gewerk:            z.string().optional(),
          description:       z.string().optional(),
          earliestStart:     z.string().optional(),
          latestEnd:         z.string().optional(),
          lvReference:       z.string().optional(),
          bimReference:      z.string().optional(),
          requiredResources: z.string().optional(),
        })
        .optional(),
    });

    const parsed = bodySchema.safeParse(normalisedBody);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const {
      plannedTimeWindow,
      responseRequiredBy,
      subject,
      message,
      sendImmediately,
      idempotencyKey,
      taktUpdates,
    } = parsed.data;

    try {
      const result = await createRevision({
        oldRequestId:       id,
        guOrgId,
        userId,
        plannedTimeWindow,
        responseRequiredBy: responseRequiredBy ? new Date(responseRequiredBy) : undefined,
        subject:            subject ?? null,
        message:            message ?? null,
        sendImmediately,
        idempotencyKey:     idempotencyKey ?? null,
        taktUpdates,
      });

      await writeAuditEvent({
        requestId: id,
        eventType: "REVISION_CREATED",
        actorOrgId: guOrgId,
        actorUserId: userId,
        actorRole: "GU",
        metadata: {
          newRequestId:   result.newRequest.id,
          newTaktVersion: result.newTaktVersion.version,
          sent:           result.sent,
        },
      });

      await writeAuditEvent({
        requestId: result.newRequest.id,
        eventType: "REQUEST_CREATED",
        actorOrgId: guOrgId,
        actorUserId: userId,
        actorRole: "GU",
        metadata: {
          supersededRequestId: id,
          requestNumber:       result.newRequest.requestNumber,
          newTaktVersion:      result.newTaktVersion.version,
        },
      });

      if (result.sent) {
        await writeAuditEvent({
          requestId: result.newRequest.id,
          eventType: "NOTIFICATION_SENT",
          actorOrgId: guOrgId,
          actorUserId: userId,
          actorRole: "GU",
          metadata: {
            supersededRequestId: id,
            requestNumber: result.newRequest.requestNumber,
          },
        });
      }

      res.status(201).json({
        oldRequestId:        result.oldRequest.id,
        oldRequestStatus:    "SUPERSEDED",
        newRequestId:        result.newRequest.id,
        newLeistungsanfrageId: result.newRequest.id,
        newRequestNumber:    result.newRequest.requestNumber,
        newRequestStatus:    result.newRequest.status,
        newTaktVersion:      result.newTaktVersion.version,
        newLeistungVersion:  result.newTaktVersion.version,
        newTaktVersionId:    result.newTaktVersion.id,
        snapshotId:          result.newSnapshot.id,
        sent:                result.sent,
        createdAt:           result.newRequest.createdAt,
      });
    } catch (err) {
      if (err instanceof RevisionError) {
        res.status((err as any).statusCode).json({ error: (err as Error).message });
        return;
      }
      if (err instanceof VersionConflictError) {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      throw err;
    }
  },
);

// ── GET /leistungsanfragen/:id/audit-trail ────────────────────────────────────
router.get(
  "/leistungsanfragen/:id/audit-trail",
  requireJwt,
  async (req, res): Promise<void> => {
    const callerOrgId = req.user!.orgId;
    const isHubAdmin = req.user!.hubAdmin;
    const id = req.params.id as string;

    const request = await getTaktRequestById(id);
    if (!request) {
      res.status(404).json({ error: "Leistungsanfrage not found" });
      return;
    }

    const isOwnerGu     = callerOrgId === request.guOrgId;
    const isAddressedNu = callerOrgId === request.nuOrgId;

    if (!isHubAdmin && !isOwnerGu && !isAddressedNu) {
      res.status(403).json({
        error:
          "Access denied. Only the creating GU, addressed NU, or a Hub admin may view this audit trail.",
      });
      return;
    }

    const callerRole = isHubAdmin ? "HUB_ADMIN" : isOwnerGu ? "GU" : "NU";
    const events = await getAuditTrail(id, callerRole);

    res.json({
      requestId:          id,
      leistungsanfrageId: id,
      callerRole,
      events: events.map((e) => ({
        id:          e.id,
        eventType:   e.eventType,
        actorOrgId:  e.actorOrgId,
        actorUserId: e.actorUserId,
        actorRole:   e.actorRole,
        metadata:    e.metadata,
        occurredAt:  e.occurredAt.toISOString(),
      })),
    });
  },
);

// ── GET /leistungsanfragen/:id/resource-requirements ─────────────────────────
router.get(
  "/leistungsanfragen/:id/resource-requirements",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const id = req.params.id as string;

    const request = await getTaktRequestById(id);
    if (!request || request.nuOrgId !== nuOrgId) {
      res.status(404).json({ error: "Leistungsanfrage not found" });
      return;
    }

    const rows = await db
      .select({
        req: leistungsanfrageResourceRequirementsTable,
        rt: {
          name:     resourceTypesTable.name,
          category: resourceTypesTable.category,
        },
      })
      .from(leistungsanfrageResourceRequirementsTable)
      .leftJoin(
        resourceTypesTable,
        eq(leistungsanfrageResourceRequirementsTable.resourceTypeId, resourceTypesTable.id),
      )
      .where(
        and(
          eq(leistungsanfrageResourceRequirementsTable.leistungsanfrageId, id),
          eq(leistungsanfrageResourceRequirementsTable.anOrgId, nuOrgId),
        ),
      )
      .orderBy(desc(leistungsanfrageResourceRequirementsTable.createdAt));

    res.json(
      rows.map(({ req: r, rt }) => ({
        id:                    r.id,
        leistungsanfrageId:    r.leistungsanfrageId,
        taktRequestId:         r.leistungsanfrageId,  // legacy alias
        anOrgId:               r.anOrgId,
        resourceTypeId:        r.resourceTypeId,
        resourceTypeName:      rt?.name     ?? null,
        resourceTypeCategory:  rt?.category ?? null,
        requiredCapacity:      r.requiredCapacity,
        utilizationPercent:    r.utilizationPercent,
        requiredQualification: r.requiredQualification,
        periodStart:           r.periodStart,
        periodEnd:             r.periodEnd,
        notes:                 r.notes,
        createdAt:             r.createdAt,
        updatedAt:             r.updatedAt,
      })),
    );
  },
);

// ── POST /leistungsanfragen/:id/resource-requirements ─────────────────────────
router.post(
  "/leistungsanfragen/:id/resource-requirements",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const id = req.params.id as string;

    const schema = z.object({
      resourceTypeId:        z.string().min(1),
      requiredCapacity:      z.number().positive(),
      utilizationPercent:    z.number().int().min(1).max(100).optional().default(100),
      requiredQualification: z.string().max(500).nullable().optional(),
      periodStart:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      periodEnd:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      notes:                 z.string().max(1000).nullable().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const request = await getTaktRequestById(id);
    if (!request || request.nuOrgId !== nuOrgId) {
      res.status(404).json({ error: "Leistungsanfrage not found" });
      return;
    }

    try {
      await validateResourceTypeForOrg(parsed.data.resourceTypeId, nuOrgId);
    } catch {
      res.status(422).json({ error: "RESOURCE_TYPE_NOT_OWNED" });
      return;
    }

    const snapshot = (await getTaktRequestWithSnapshot(id))?.snapshot?.snapshotPayload as
      | { plannedTimeWindow?: { start?: string; end?: string } }
      | undefined;
    const periodStart = parsed.data.periodStart ?? snapshot?.plannedTimeWindow?.start ?? null;
    const periodEnd = parsed.data.periodEnd ?? snapshot?.plannedTimeWindow?.end ?? null;
    if (!periodStart || !periodEnd || periodStart > periodEnd) {
      res.status(422).json({ error: "INVALID_REQUIREMENT_PERIOD" });
      return;
    }

    const [inserted] = await db
      .insert(leistungsanfrageResourceRequirementsTable)
      .values({
        leistungsanfrageId:   id,
        anOrgId:              nuOrgId,
        resourceTypeId:       parsed.data.resourceTypeId,
        requiredCapacity:     parsed.data.requiredCapacity.toString(),
        utilizationPercent:   parsed.data.utilizationPercent   ?? 100,
        requiredQualification: parsed.data.requiredQualification ?? null,
        periodStart,
        periodEnd,
        notes:                parsed.data.notes                ?? null,
      })
      .returning();

    res.status(201).json({
      ...inserted,
      leistungsanfrageId: inserted.leistungsanfrageId,
      taktRequestId:      inserted.leistungsanfrageId,  // legacy alias
    });
  },
);

// ── DELETE /leistungsanfragen/:id/resource-requirements/:reqId ────────────────
router.delete(
  "/leistungsanfragen/:id/resource-requirements/:reqId",
  requireJwt,
  async (req, res): Promise<void> => {
    const nuOrgId = req.user!.orgId!;
    const id      = req.params.id   as string;
    const reqId   = req.params.reqId as string;

    const [deleted] = await db
      .delete(leistungsanfrageResourceRequirementsTable)
      .where(
        and(
          eq(leistungsanfrageResourceRequirementsTable.id, reqId),
          eq(leistungsanfrageResourceRequirementsTable.leistungsanfrageId, id),
          eq(leistungsanfrageResourceRequirementsTable.anOrgId, nuOrgId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Resource requirement not found" });
      return;
    }

    res.status(204).end();
  },
);

export default router;

import { and, eq, inArray, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import {
  db,
  leistungenTable,
  leistungsanfragenTable,
  organizationsTable,
  projectsTable,
  serviceClarificationsTable,
  serviceConstraintsTable,
  leistungsabhaengigkeitenTable,
  serviceReadinessChecksTable,
} from "@workspace/db";
import { requireJwt } from "../middlewares/requireJwt";
import { partyForOrg } from "../services/service-change-proposal-service";
import { evaluateChangeImpact } from "../services/change-impact-service";
import { getProjectCoordinationBoard } from "../services/ag-coordination-board-service";

const router = Router();

router.get("/service-requests/:id/change-impact", requireJwt, async (req, res): Promise<void> => {
  const request = await requestForParty(req.params.id as string, req.user!.orgId!);
  if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
  if (request.guOrgId !== req.user!.orgId) { res.status(403).json({ error: "Change Impact ist nur für die AG-Organisation verfügbar" }); return; }
  const start = new Date(String(req.query.proposedStart));
  const end = new Date(String(req.query.proposedEnd));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    res.status(400).json({ error: "Bitte ein gültiges Zeitfenster angeben" }); return;
  }
  res.json(await evaluateChangeImpact({ serviceRequestId: request.id, proposedStart: start, proposedEnd: end }));
});

router.get("/ag/projects/:projectId/coordination-board", requireJwt, async (req, res): Promise<void> => {
  if (req.user!.orgType !== "AG") { res.status(403).json({ error: "Nur AGs können die Koordinationsübersicht öffnen" }); return; }
  res.json(await getProjectCoordinationBoard({ projectId: req.params.projectId as string, agOrgId: req.user!.orgId! }));
});

async function requestForParty(requestId: string, orgId: string) {
  const [request] = await db.select().from(leistungsanfragenTable)
    .where(eq(leistungsanfragenTable.id, requestId)).limit(1);
  return request && partyForOrg(request, orgId) ? request : null;
}

function fail(res: any, error: unknown, fallback: string) {
  const status = (error as { statusCode?: number }).statusCode ?? 500;
  res.status(status).json({ error: error instanceof Error ? error.message : fallback });
}

const constraintCreateSchema = z.object({
  constraintType: z.enum(["UPSTREAM_NOT_READY", "SITE_NOT_READY", "RESOURCE_CONFLICT", "MATERIAL_NOT_AVAILABLE", "INFORMATION_MISSING", "APPROVAL_MISSING", "ACCESS_RESTRICTED", "SAFETY_CLEARANCE_MISSING", "OTHER"]),
  description: z.string().trim().min(1).max(2000),
  responsibleOrgId: z.string().min(1),
});

router.post("/service-requests/:id/constraints", requireJwt, async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.orgId!;
    const request = await requestForParty(req.params.id as string, orgId);
    if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
    if (!request.agreedStart || !request.agreedEnd) { res.status(409).json({ error: "Ein Risiko kann erst bei bestehender Vereinbarung gemeldet werden" }); return; }
    const parsed = constraintCreateSchema.parse(req.body);
    if (![request.guOrgId, request.nuOrgId].includes(parsed.responsibleOrgId)) {
      res.status(400).json({ error: "Verantwortliche Organisation gehört nicht zur Leistungsanfrage" }); return;
    }
    const [row] = await db.insert(serviceConstraintsTable).values({
      serviceRequestId: request.id,
      reportedByOrgId: orgId,
      reportedByRole: request.guOrgId === orgId ? "AG" : "AN",
      constraintType: parsed.constraintType,
      description: parsed.description,
      responsibleOrgId: parsed.responsibleOrgId,
    }).returning();
    res.status(201).json(row);
  } catch (error) { fail(res, error, "Risiko konnte nicht erstellt werden"); }
});

router.get("/service-requests/:id/constraints", requireJwt, async (req, res): Promise<void> => {
  const request = await requestForParty(req.params.id as string, req.user!.orgId!);
  if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
  res.json(await db.select().from(serviceConstraintsTable)
    .where(eq(serviceConstraintsTable.serviceRequestId, request.id)));
});

async function resolveConstraint(req: any, res: any, status: "RESOLVED" | "CANCELLED") {
  try {
    const orgId = req.user!.orgId!;
    const constraintId = req.params.constraintId as string;
    const request = await requestForParty(req.params.id as string, orgId);
    if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }

    // For CANCEL: only the reporting org may cancel their own constraint.
    if (status === "CANCELLED") {
      const [constraint] = await db.select().from(serviceConstraintsTable).where(and(
        eq(serviceConstraintsTable.id, constraintId),
        eq(serviceConstraintsTable.serviceRequestId, request.id),
      )).limit(1);
      if (!constraint) { res.status(404).json({ error: "Risiko nicht gefunden" }); return; }
      if (constraint.reportedByOrgId !== orgId) {
        res.status(403).json({ error: "CONSTRAINT_CANCEL_NOT_ALLOWED" }); return;
      }
    } else {
      const [constraint] = await db.select().from(serviceConstraintsTable).where(and(
        eq(serviceConstraintsTable.id, constraintId),
        eq(serviceConstraintsTable.serviceRequestId, request.id),
      )).limit(1);
      if (!constraint) { res.status(404).json({ error: "Risiko nicht gefunden" }); return; }
      if (constraint.responsibleOrgId !== orgId) {
        res.status(403).json({ error: "CONSTRAINT_RESOLVE_NOT_ALLOWED" }); return;
      }
    }

    const [row] = await db.update(serviceConstraintsTable).set({
      status, resolvedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(serviceConstraintsTable.id, constraintId),
      eq(serviceConstraintsTable.serviceRequestId, request.id),
      eq(serviceConstraintsTable.status, "OPEN"),
    )).returning();
    if (!row) { res.status(409).json({ error: "CONSTRAINT_ALREADY_CLOSED" }); return; }
    res.json(row);
  } catch (error) { fail(res, error, "Risiko konnte nicht aktualisiert werden"); }
}
router.post("/service-requests/:id/constraints/:constraintId/resolve", requireJwt, (req, res) => resolveConstraint(req, res, "RESOLVED"));
router.post("/service-requests/:id/constraints/:constraintId/cancel", requireJwt, (req, res) => resolveConstraint(req, res, "CANCELLED"));

const clarificationCreateSchema = z.object({
  category: z.enum(["PLAN", "APPROVAL", "DIMENSION", "ACCESS", "INTERFACE_INFORMATION", "SCOPE", "OTHER"]),
  question: z.string().trim().min(1).max(2000),
});
router.post("/service-requests/:id/clarifications", requireJwt, async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.orgId!;
    const request = await requestForParty(req.params.id as string, orgId);
    if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
    const parsed = clarificationCreateSchema.parse(req.body);
    const [row] = await db.insert(serviceClarificationsTable).values({
      serviceRequestId: request.id,
      askedByOrgId: orgId,
      askedByRole: request.guOrgId === orgId ? "AG" : "AN",
      category: parsed.category,
      question: parsed.question,
    }).returning();
    res.status(201).json(row);
  } catch (error) { fail(res, error, "Klärungsfrage konnte nicht erstellt werden"); }
});
router.get("/service-requests/:id/clarifications", requireJwt, async (req, res): Promise<void> => {
  const request = await requestForParty(req.params.id as string, req.user!.orgId!);
  if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
  res.json(await db.select().from(serviceClarificationsTable)
    .where(eq(serviceClarificationsTable.serviceRequestId, request.id)));
});
router.post("/service-requests/:id/clarifications/:clarificationId/answer", requireJwt, async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.orgId!;
    const request = await requestForParty(req.params.id as string, orgId);
    if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
    const parsed = z.object({ answer: z.string().trim().min(1).max(2000) }).parse(req.body);
    const [clarification] = await db.select().from(serviceClarificationsTable).where(and(
      eq(serviceClarificationsTable.id, req.params.clarificationId as string),
      eq(serviceClarificationsTable.serviceRequestId, request.id),
    )).limit(1);
     if (!clarification) { res.status(404).json({ error: "Klärungsfrage nicht gefunden" }); return; }
    if (clarification.askedByOrgId === orgId) { res.status(403).json({ error: "Nur die Gegenseite darf diese Frage beantworten" }); return; }
     if (clarification.status !== "OPEN") { res.status(409).json({ error: "CLARIFICATION_ALREADY_RESOLVED" }); return; }
    const [row] = await db.update(serviceClarificationsTable).set({
      answer: parsed.answer, answeredByOrgId: orgId, answeredAt: new Date(), status: "RESOLVED", updatedAt: new Date(),
    }).where(and(eq(serviceClarificationsTable.id, clarification.id), eq(serviceClarificationsTable.status, "OPEN"))).returning();
    if (!row) { res.status(409).json({ error: "Klärungsfrage wurde bereits beantwortet (parallele Anfrage)" }); return; }
    res.json(row);
  } catch (error) { fail(res, error, "Klärungsfrage konnte nicht beantwortet werden"); }
});
router.post("/service-requests/:id/clarifications/:clarificationId/cancel", requireJwt, async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.orgId!;
    const request = await requestForParty(req.params.id as string, orgId);
    if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
    const [clarification] = await db.select().from(serviceClarificationsTable).where(and(
      eq(serviceClarificationsTable.id, req.params.clarificationId as string),
      eq(serviceClarificationsTable.serviceRequestId, request.id),
    )).limit(1);
    if (!clarification) { res.status(404).json({ error: "Klärungsfrage nicht gefunden" }); return; }
    if (clarification.askedByOrgId !== orgId) {
      res.status(403).json({ error: "CLARIFICATION_CANCEL_NOT_ALLOWED" }); return;
    }
    const [row] = await db.update(serviceClarificationsTable).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(
      eq(serviceClarificationsTable.id, req.params.clarificationId as string),
      eq(serviceClarificationsTable.serviceRequestId, request.id),
      eq(serviceClarificationsTable.status, "OPEN"),
    )).returning();
     if (!row) { res.status(409).json({ error: "CLARIFICATION_ALREADY_RESOLVED" }); return; }
    res.json(row);
  } catch (error) { fail(res, error, "Klärungsfrage konnte nicht storniert werden"); }
});

router.get("/service-requests/:id/readiness", requireJwt, async (req, res): Promise<void> => {
  const request = await requestForParty(req.params.id as string, req.user!.orgId!);
  if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
  let [row] = await db.select().from(serviceReadinessChecksTable).where(eq(serviceReadinessChecksTable.serviceRequestId, request.id)).limit(1);
  if (!row) {
    res.json({
      id: null,
      serviceRequestId: request.id,
      scheduleConfirmed: false,
      siteReady: false,
      informationComplete: false,
      agReady: false,
      anReady: false,
      updatedByOrgId: null,
      createdAt: null,
      updatedAt: null,
      status: "NOT_READY",
    });
    return;
  }
  res.json({ ...row, status: row.scheduleConfirmed && row.siteReady && row.informationComplete && row.agReady && row.anReady ? "READY" : "NOT_READY" });
});
router.patch("/service-requests/:id/readiness", requireJwt, async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.orgId!;
    const request = await requestForParty(req.params.id as string, orgId);
    if (!request) { res.status(404).json({ error: "Leistungsanfrage nicht gefunden" }); return; }
    const role = request.guOrgId === orgId ? "AG" : "AN";
    const allowed = role === "AG" ? ["scheduleConfirmed", "siteReady", "informationComplete", "agReady"] : ["anReady"];
    const body = req.body as Record<string, unknown>;
    const keys = Object.keys(body);
    if (keys.some((key) => !allowed.includes(key) || typeof body[key] !== "boolean")) {
      res.status(403).json({ error: "Diese Bereitschaftsfelder dürfen von Ihrer Organisation nicht geändert werden" }); return;
    }
    // Atomic upsert: INSERT with ON CONFLICT DO NOTHING, then unconditional UPDATE.
    // This avoids the SELECT→INSERT race condition.
    await db.insert(serviceReadinessChecksTable).values({ serviceRequestId: request.id, updatedByOrgId: orgId }).onConflictDoNothing();
    const [row] = await db.update(serviceReadinessChecksTable).set({ ...body, updatedByOrgId: orgId, updatedAt: new Date() }).where(eq(serviceReadinessChecksTable.serviceRequestId, request.id)).returning();
    res.json({ ...row, status: row.scheduleConfirmed && row.siteReady && row.informationComplete && row.agReady && row.anReady ? "READY" : "NOT_READY" });
  } catch (error) { fail(res, error, "Ausführungsbereitschaft konnte nicht gespeichert werden"); }
});

const dependencySchema = z.object({
  predecessorServiceRequestId: z.string().min(1),
  successorServiceRequestId: z.string().min(1),
  lagDays: z.number().int().min(0).default(0),
});
router.get("/projects/:projectId/service-dependencies", requireJwt, async (req, res): Promise<void> => {
  const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, req.params.projectId as string), eq(projectsTable.agOrgId, req.user!.orgId!))).limit(1);
  if (!project) { res.status(404).json({ error: "Projekt nicht gefunden" }); return; }
  const dependencies = await db.select().from(leistungsabhaengigkeitenTable)
    .where(eq(leistungsabhaengigkeitenTable.projectId, project.id));
  const projectRequests = await db.select().from(leistungsanfragenTable)
    .innerJoin(leistungenTable, eq(leistungsanfragenTable.leistungId, leistungenTable.id))
    .where(eq(leistungenTable.projectId, project.id));
  const requestByLeistung = new Map(projectRequests.map(({ leistungsanfragen }) => [leistungsanfragen.leistungId, leistungsanfragen.id]));
  res.json(dependencies.map((dependency) => ({
    ...dependency,
    predecessorServiceRequestId: requestByLeistung.get(dependency.predecessorId) ?? null,
    successorServiceRequestId: requestByLeistung.get(dependency.successorId) ?? null,
  })));
});
router.post("/projects/:projectId/service-dependencies", requireJwt, async (req, res): Promise<void> => {
  try {
    const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, req.params.projectId as string), eq(projectsTable.agOrgId, req.user!.orgId!))).limit(1);
    if (!project) { res.status(404).json({ error: "Projekt nicht gefunden" }); return; }
    const parsed = dependencySchema.parse(req.body);
    if (parsed.predecessorServiceRequestId === parsed.successorServiceRequestId) { res.status(400).json({ error: "Eine Leistung kann nicht von sich selbst abhängen" }); return; }
    const ids = [parsed.predecessorServiceRequestId, parsed.successorServiceRequestId];
    const rows = await db.select({ request: leistungsanfragenTable, service: leistungenTable }).from(leistungsanfragenTable)
      .innerJoin(leistungenTable, eq(leistungsanfragenTable.leistungId, leistungenTable.id)).where(inArray(leistungsanfragenTable.id, ids));
    if (rows.length !== 2 || rows.some(({ service }) => service.projectId !== project.id)) { res.status(400).json({ error: "Beide Leistungen müssen zum Projekt gehören" }); return; }
     const existing = await db.select().from(leistungsabhaengigkeitenTable).where(eq(leistungsabhaengigkeitenTable.projectId, project.id));
     const leistungByRequest = new Map(rows.map(({ request, service }) => [request.id, service.id]));
     const predecessorId = leistungByRequest.get(parsed.predecessorServiceRequestId);
     const successorId = leistungByRequest.get(parsed.successorServiceRequestId);
     if (!predecessorId || !successorId) { res.status(400).json({ error: "Leistungen konnten nicht zugeordnet werden" }); return; }
     const outgoing = new Map<string, string[]>();
    for (const dependency of existing) {
       outgoing.set(dependency.predecessorId, [
         ...(outgoing.get(dependency.predecessorId) ?? []),
         dependency.successorId,
      ]);
    }
     const queue = [successorId];
    const visited = new Set<string>();
    let reachesPredecessor = false;
    while (queue.length) {
      const current = queue.shift()!;
       if (current === predecessorId) { reachesPredecessor = true; break; }
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(outgoing.get(current) ?? []));
    }
    if (reachesPredecessor) {
      res.status(422).json({ error: "DEPENDENCY_CYCLE" }); return;
    }
     if (existing.some((d) => d.predecessorId === predecessorId && d.successorId === successorId)) {
      res.status(409).json({ error: "Diese Abhängigkeit existiert bereits" }); return;
    }
     const [row] = await db.insert(leistungsabhaengigkeitenTable).values({
       projectId: project.id,
       predecessorId,
       successorId,
       type: "EA",
       lagDays: parsed.lagDays,
     }).returning();
     res.status(201).json({ ...row, predecessorServiceRequestId: parsed.predecessorServiceRequestId, successorServiceRequestId: parsed.successorServiceRequestId });
  } catch (error) { fail(res, error, "Abhängigkeit konnte nicht erstellt werden"); }
});
router.delete("/projects/:projectId/service-dependencies/:id", requireJwt, async (req, res): Promise<void> => {
  const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, req.params.projectId as string), eq(projectsTable.agOrgId, req.user!.orgId!))).limit(1);
  if (!project) { res.status(404).json({ error: "Projekt nicht gefunden" }); return; }
   await db.delete(leistungsabhaengigkeitenTable).where(and(eq(leistungsabhaengigkeitenTable.id, req.params.id as string), eq(leistungsabhaengigkeitenTable.projectId, project.id)));
  res.status(204).send();
});

export default router;
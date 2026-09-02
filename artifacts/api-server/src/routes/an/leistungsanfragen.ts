import { Router } from "express";
import { z } from "zod";
import { createDataspaceExchange } from "../../services/dataspace/dataspace-exchange-factory";
import { deliverLocalServiceResponse } from "../../services/dataspace/local-dataspace-delivery";
import {
  createAnServiceResponse,
  ResponseConflictError,
  ResponseStatusError,
} from "../../services/nu-response-service";
import {
  formatAnAvailabilityCheck,
  getLatestAnAvailabilityCheck,
  getAnLeistungsanfrageDetail,
  listAnLeistungsanfragen,
  runAnAvailabilityCheck,
  updateAnResourceRequirement,
  getAnCoordination,
  createAnScheduleChangeProposal,
  resolveAnScheduleChangeProposal,
} from "../../services/an-leistungsanfrage-service";
import {
  InvalidRequirementPeriodError,
  ResourceRequirementNotFoundError,
  createResourceRequirement,
  deleteResourceRequirement,
  listResourceRequirements,
  requirementUpdateSchema,
  requirementCreateSchema,
} from "../../services/resource-requirements-service";
import { requireJwt } from "../../middlewares/requireJwt";
import { writeAuditEvent } from "../../lib/takt-request-audit-service";

const router = Router();

function requireAn(req: Parameters<typeof router.get>[1] extends never ? never : any, res: any): string | null {
  const user = req.user;
  if (!user?.orgId || user.orgType !== "AN" || user.hubAdmin) {
    res.status(403).json({ error: "Only AN organisations may access local Leistungsanfragen" });
    return null;
  }
  return user.orgId;
}

const responseSchema = z.object({
  decision: z.enum(["ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED"]),
  acceptedTimeWindow: z.object({ start: z.string().min(1), end: z.string().min(1) }).optional(),
  reasonCode: z.enum([
    "RESOURCE_CONFLICT", "NO_CAPACITY", "EQUIPMENT_UNAVAILABLE",
    "QUALIFICATION_MISSING", "TIME_WINDOW_TOO_SHORT", "OUTSIDE_PLANNING_HORIZON", "OTHER",
  ]).optional(),
  comment: z.string().max(2000).optional(),
  alternatives: z.array(z.object({
    alternativeId: z.string().min(1),
    rank: z.number().int().min(1),
    timeWindow: z.object({ start: z.string().min(1), end: z.string().min(1) }),
    crewSize: z.number().int().min(1).optional(),
    conditions: z.array(z.string()).optional(),
  })).max(3).optional(),
  nextAvailableDate: z.string().optional(),
});

const proposalSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  comment: z.string().max(2000).nullable().optional(),
});

async function list(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await listAnLeistungsanfragen(anOrgId, status));
}

async function details(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const result = await getAnLeistungsanfrageDetail(req.params.id as string, anOrgId);
  if (!result) {
    res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
    return;
  }
  if (result.detailsRetrievedNow) {
    await writeAuditEvent({
      requestId: req.params.id as string,
      eventType: "DETAILS_RETRIEVED",
      actorOrgId: anOrgId,
      actorUserId: req.user?.userId ?? null,
      actorRole: "NU",
      metadata: { firstAccess: true },
    });
  }
  const { detailsRetrievedNow: _detailsRetrievedNow, ...publicResult } = result;
  res.json(publicResult);
}

async function updateRequirement(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const parsed = requirementUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await updateAnResourceRequirement(
      req.params.id as string,
      req.params.reqId as string,
      anOrgId,
      parsed.data,
    );
    if (!result) {
      res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
      return;
    }
    res.json(result);
  } catch (error) {
    if (error instanceof ResourceRequirementNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof InvalidRequirementPeriodError) {
      res.status(422).json({ error: error.code });
      return;
    }
    throw error;
  }
}

async function respond(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const parsed = responseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const projection = await getAnLeistungsanfrageDetail(req.params.id as string, anOrgId);
  if (!projection) {
    res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
    return;
  }
  try {
    const result = await createAnServiceResponse({
      anLeistungsanfrageId: projection.localProjectionId,
      anOrgId,
      userId: req.user.userId,
      ...parsed.data,
    });
    const transport = await deliverLocalServiceResponse(result.payload, createDataspaceExchange());
    res.status(result.idempotent ? 200 : 201).json({
      responseId: result.response.id,
      taktRequestId: projection.taktRequestId,
      leistungsanfrageId: projection.leistungsanfrageId,
      decision: result.response.decision,
      acceptedTimeWindow: result.response.acceptedStart && result.response.acceptedEnd
        ? { start: result.response.acceptedStart.toISOString(), end: result.response.acceptedEnd.toISOString() }
        : null,
      alternatives: result.alternatives.map((alternative) => ({
        alternativeId: alternative.alternativeId,
        rank: alternative.rank,
        timeWindow: { start: alternative.proposedStart.toISOString(), end: alternative.proposedEnd.toISOString() },
      })),
      requestStatus: "RESPONDED",
      transportStatus: transport.status,
      transportMessageId: result.payload.metadata.messageId,
      createdAt: result.response.createdAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof ResponseConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof ResponseStatusError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
}

async function coordination(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const result = await getAnCoordination(req.params.id as string, anOrgId);
  if (!result) {
    res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
    return;
  }
  res.json(result);
}

async function propose(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const parsed = proposalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await createAnScheduleChangeProposal({
      requestId: req.params.id as string,
      anOrgId,
      userId: req.user.userId,
      start: parsed.data.start,
      end: parsed.data.end,
      comment: parsed.data.comment ?? undefined,
    });
    if (!result) {
      res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
      return;
    }
    res.status(201).json(result);
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode) {
      res.status(statusCode).json({ error: error instanceof Error ? error.message : "Coordination action failed" });
      return;
    }
    throw error;
  }
}

async function resolveProposal(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const action = req.params.action as string;
  if (action !== "accept" && action !== "reject" && action !== "counter") {
    res.status(404).json({ error: "Unknown coordination action" });
    return;
  }
  const parsed = proposalSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    if (action === "counter") {
      if (!parsed.data.start || !parsed.data.end) {
        res.status(400).json({ error: "Counter proposals require start and end" });
        return;
      }
      const result = await createAnScheduleChangeProposal({
        requestId: req.params.id as string,
        anOrgId,
        userId: req.user.userId,
        start: parsed.data.start,
        end: parsed.data.end,
        comment: parsed.data.comment ?? undefined,
        supersedesProposalId: req.params.proposalId as string,
      });
      if (!result) {
        res.status(404).json({ error: "Coordination proposal was not received in the AN context" });
        return;
      }
      res.status(201).json(result);
      return;
    }
    const result = await resolveAnScheduleChangeProposal({
      requestId: req.params.id as string,
      proposalId: req.params.proposalId as string,
      anOrgId,
      userId: req.user.userId,
      decision: action === "accept" ? "ACCEPTED" : "REJECTED",
      comment: parsed.data.comment ?? undefined,
    });
    if (!result) {
      res.status(404).json({ error: "Coordination proposal was not received in the AN context" });
      return;
    }
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof ResponseConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof ResponseStatusError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
}

function canRunAvailabilityCheck(req: any, res: any): boolean {
  if (!req.user?.roles?.some((role: string) => role === "AN_ADMIN" || role === "AN_DISPATCHER")) {
    res.status(403).json({ error: "AN_ADMIN or AN_DISPATCHER role required" });
    return false;
  }
  return true;
}

async function runAvailability(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId || !canRunAvailabilityCheck(req, res)) return;
  const check = await runAnAvailabilityCheck(req.params.id as string, anOrgId, req.user.userId);
  if (!check) {
    res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
    return;
  }
  res.status(201).json(formatAnAvailabilityCheck(check));
}

async function latestAvailability(req: any, res: any) {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const result = await getLatestAnAvailabilityCheck(req.params.id as string, anOrgId);
  if (!result.projectionFound || !result.check) {
    res.status(404).json({ error: "No local availability checks found for this Leistungsanfrage" });
    return;
  }
  res.json(formatAnAvailabilityCheck(result.check));
}

router.get("/takt-requests", requireJwt, list);
router.get("/leistungsanfragen", requireJwt, list);
router.get("/takt-requests/:id/snapshot", requireJwt, details);
router.get("/takt-requests/:id/details", requireJwt, details);
router.get("/leistungsanfragen/:id/details", requireJwt, details);
router.patch("/takt-requests/:id/resource-requirements/:reqId", requireJwt, updateRequirement);
router.patch("/leistungsanfragen/:id/resource-requirements/:reqId", requireJwt, updateRequirement);
router.get("/takt-requests/:id/resource-requirements", requireJwt, async (req: any, res: any) => {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const rows = await listResourceRequirements(req.params.id as string, anOrgId);
  if (rows === null) {
    res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
    return;
  }
  res.json(rows);
});
router.get("/leistungsanfragen/:id/resource-requirements", requireJwt, async (req: any, res: any) => {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const rows = await listResourceRequirements(req.params.id as string, anOrgId);
  if (rows === null) {
    res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
    return;
  }
  res.json(rows);
});
router.post("/takt-requests/:id/resource-requirements", requireJwt, async (req: any, res: any) => {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const parsed = requirementCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const row = await createResourceRequirement(req.params.id as string, anOrgId, parsed.data);
    if (row === null) {
      res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
      return;
    }
    res.status(201).json(row);
  } catch (error) {
    if (error instanceof InvalidRequirementPeriodError) {
      res.status(422).json({ error: error.code });
      return;
    }
    throw error;
  }
});
router.post("/leistungsanfragen/:id/resource-requirements", requireJwt, async (req: any, res: any) => {
  const anOrgId = requireAn(req, res);
  if (!anOrgId) return;
  const parsed = requirementCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const row = await createResourceRequirement(req.params.id as string, anOrgId, parsed.data);
    if (row === null) {
      res.status(404).json({ error: "Leistungsanfrage was not received in the AN context" });
      return;
    }
    res.status(201).json(row);
  } catch (error) {
    if (error instanceof InvalidRequirementPeriodError) {
      res.status(422).json({ error: error.code });
      return;
    }
    throw error;
  }
});
router.post("/takt-requests/:id/responses", requireJwt, respond);
router.post("/leistungsanfragen/:id/responses", requireJwt, respond);
router.get("/takt-requests/:id/coordination", requireJwt, coordination);
router.get("/leistungsanfragen/:id/coordination", requireJwt, coordination);
router.post("/takt-requests/:id/change-proposals", requireJwt, propose);
router.post("/leistungsanfragen/:id/change-proposals", requireJwt, propose);
router.post("/takt-requests/:id/change-proposals/:proposalId/:action", requireJwt, resolveProposal);
router.post("/leistungsanfragen/:id/change-proposals/:proposalId/:action", requireJwt, resolveProposal);
router.post("/takt-requests/:id/availability-checks", requireJwt, runAvailability);
router.post("/leistungsanfragen/:id/availability-checks", requireJwt, runAvailability);
router.get("/takt-requests/:id/availability-checks/latest", requireJwt, latestAvailability);
router.get("/leistungsanfragen/:id/availability-checks/latest", requireJwt, latestAvailability);

export default router;
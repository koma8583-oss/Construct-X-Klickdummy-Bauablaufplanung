import { Router } from "express";
import { db } from "@workspace/db";
import {
  delegationsTable,
  delegationResponsesTable,
  takteTable,
  organizationsTable,
} from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { dispatchWebhookEvent } from "../lib/webhookDispatcher";
import { z } from "zod";

const router = Router();

function isWithinBuffer(
  proposedStart: string | null | undefined,
  proposedEnd: string | null | undefined,
  earliestStart: string | null | undefined,
  latestEnd: string | null | undefined,
): boolean {
  if (!proposedStart || !proposedEnd) return false;
  if (!earliestStart || !latestEnd) return true; // no buffer defined = always ok
  return proposedStart >= earliestStart && proposedEnd <= latestEnd;
}

// GET /delegations
router.get("/delegations", requireAuth, async (req, res): Promise<void> => {
  const orgId = req.session!.orgId!;
  const { projectId, status, anOrgId } = req.query as Record<string, string>;

  const conditions: SQL[] = [];
  if (projectId) conditions.push(eq(delegationsTable.projectId, projectId));
  if (anOrgId) conditions.push(eq(delegationsTable.anOrgId, anOrgId));
  if (status) {
    const validStatus = status as
      | "PENDING"
      | "CONFIRMED"
      | "ALTERNATIVE_PROPOSED"
      | "REJECTED"
      | "CANCELLED";
    conditions.push(eq(delegationsTable.status, validStatus));
  }

  const delegations = await db
    .select({
      delegation: delegationsTable,
      takt: takteTable,
      anOrg: organizationsTable,
    })
    .from(delegationsTable)
    .innerJoin(takteTable, eq(delegationsTable.taktId, takteTable.id))
    .innerJoin(
      organizationsTable,
      eq(delegationsTable.anOrgId, organizationsTable.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Filter by org membership (AG or AN side)
  const filtered = delegations.filter(
    (d) => d.delegation.agOrgId === orgId || d.delegation.anOrgId === orgId,
  );

  // Collect unique AG org IDs and fetch them
  const agOrgIds = [...new Set(filtered.map((d) => d.delegation.agOrgId))];
  const agOrgMap = new Map<string, typeof organizationsTable.$inferSelect>();

  for (const agOrgId of agOrgIds) {
    const [agOrg] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, agOrgId))
      .limit(1);
    if (agOrg) agOrgMap.set(agOrgId, agOrg);
  }

  res.json(
    filtered.map(({ delegation, takt, anOrg }) => ({
      ...delegation,
      takt: { ...takt, delegationStatus: delegation.status },
      anOrganization: anOrg,
      agOrganization: agOrgMap.get(delegation.agOrgId),
    })),
  );
});

// POST /delegations
router.post("/delegations", requireAuth, async (req, res): Promise<void> => {
  const schema = z.object({
    taktId: z.string(),
    anOrgId: z.string(),
    requestedStart: z.string(),
    requestedEnd: z.string(),
    earliestStart: z.string().optional(),
    latestEnd: z.string().optional(),
    message: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [takt] = await db
    .select()
    .from(takteTable)
    .where(eq(takteTable.id, parsed.data.taktId))
    .limit(1);

  if (!takt) {
    res.status(404).json({ error: "Takt not found" });
    return;
  }

  const [delegation] = await db
    .insert(delegationsTable)
    .values({
      ...parsed.data,
      projectId: takt.projectId,
      agOrgId: req.session!.orgId!,
      status: "PENDING",
    })
    .returning();

  if (!delegation) {
    res.status(500).json({ error: "Failed to create delegation" });
    return;
  }

  // Dispatch webhook to AN
  await dispatchWebhookEvent(parsed.data.anOrgId, "delegation.created", {
    delegationId: delegation.id,
    taktId: takt.id,
    agOrgId: req.session!.orgId,
  });

  const [anOrg] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, parsed.data.anOrgId))
    .limit(1);

  res.status(201).json({
    ...delegation,
    takt: { ...takt, delegationStatus: "PENDING" },
    anOrganization: anOrg,
  });
});

// GET /delegations/:delegationId
router.get(
  "/delegations/:delegationId",
  requireAuth,
  async (req, res): Promise<void> => {
    const [row] = await db
      .select({
        delegation: delegationsTable,
        takt: takteTable,
        anOrg: organizationsTable,
      })
      .from(delegationsTable)
      .innerJoin(takteTable, eq(delegationsTable.taktId, takteTable.id))
      .innerJoin(
        organizationsTable,
        eq(delegationsTable.anOrgId, organizationsTable.id),
      )
      .where(eq(delegationsTable.id, (req.params.delegationId as string)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    res.json({
      ...row.delegation,
      takt: { ...row.takt, delegationStatus: row.delegation.status },
      anOrganization: row.anOrg,
    });
  },
);

// PATCH /delegations/:delegationId
router.patch(
  "/delegations/:delegationId",
  requireAuth,
  async (req, res): Promise<void> => {
    const schema = z.object({
      status: z.enum(["CANCELLED"]).optional(),
      message: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [delegation] = await db
      .update(delegationsTable)
      .set(parsed.data)
      .where(eq(delegationsTable.id, (req.params.delegationId as string)))
      .returning();

    if (!delegation) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    if (parsed.data.status === "CANCELLED") {
      await dispatchWebhookEvent(
        delegation.anOrgId,
        "delegation.cancelled",
        { delegationId: delegation.id },
      );
    }

    res.json(delegation);
  },
);

// DELETE /delegations/:delegationId
router.delete(
  "/delegations/:delegationId",
  requireAuth,
  async (req, res): Promise<void> => {
    await db
      .delete(delegationsTable)
      .where(eq(delegationsTable.id, (req.params.delegationId as string)));
    res.status(204).send();
  },
);

// GET /delegations/:delegationId/responses
router.get(
  "/delegations/:delegationId/responses",
  requireAuth,
  async (req, res): Promise<void> => {
    const responses = await db
      .select()
      .from(delegationResponsesTable)
      .where(
        eq(delegationResponsesTable.delegationId, (req.params.delegationId as string)),
      )
      .orderBy(delegationResponsesTable.createdAt);

    res.json(responses);
  },
);

// POST /delegations/:delegationId/responses
router.post(
  "/delegations/:delegationId/responses",
  requireAuth,
  async (req, res): Promise<void> => {
    const schema = z.object({
      type: z.enum(["CONFIRMED", "ALTERNATIVE", "REJECTED"]),
      proposedStart: z.string().optional(),
      proposedEnd: z.string().optional(),
      comment: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [delegation] = await db
      .select()
      .from(delegationsTable)
      .where(eq(delegationsTable.id, (req.params.delegationId as string)))
      .limit(1);

    if (!delegation) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    const withinBuffer = isWithinBuffer(
      parsed.data.proposedStart ?? delegation.requestedStart,
      parsed.data.proposedEnd ?? delegation.requestedEnd,
      delegation.earliestStart,
      delegation.latestEnd,
    );

    const [response] = await db
      .insert(delegationResponsesTable)
      .values({
        ...parsed.data,
        delegationId: (req.params.delegationId as string),
        isWithinBuffer: withinBuffer,
        agDecision: "PENDING",
      })
      .returning();

    // Update delegation status
    const newStatus =
      parsed.data.type === "CONFIRMED"
        ? "CONFIRMED"
        : parsed.data.type === "REJECTED"
          ? "REJECTED"
          : "ALTERNATIVE_PROPOSED";

    await db
      .update(delegationsTable)
      .set({ status: newStatus })
      .where(eq(delegationsTable.id, (req.params.delegationId as string)));

    // Notify AG
    const event =
      parsed.data.type === "CONFIRMED"
        ? "delegation.confirmed"
        : parsed.data.type === "REJECTED"
          ? "delegation.rejected"
          : "delegation.alternative_proposed";

    await dispatchWebhookEvent(delegation.agOrgId, event, {
      delegationId: delegation.id,
      responseId: response?.id,
      isWithinBuffer: withinBuffer,
    });

    res.status(201).json(response);
  },
);

// PATCH /delegations/:delegationId/responses/:responseId
router.patch(
  "/delegations/:delegationId/responses/:responseId",
  requireAuth,
  async (req, res): Promise<void> => {
    const schema = z.object({
      agDecision: z.enum(["ACCEPTED", "REJECTED"]),
      agComment: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [response] = await db
      .update(delegationResponsesTable)
      .set(parsed.data)
      .where(eq(delegationResponsesTable.id, (req.params.responseId as string)))
      .returning();

    if (!response) {
      res.status(404).json({ error: "Response not found" });
      return;
    }

    const [delegation] = await db
      .select()
      .from(delegationsTable)
      .where(eq(delegationsTable.id, (req.params.delegationId as string)))
      .limit(1);

    if (delegation) {
      const event =
        parsed.data.agDecision === "ACCEPTED"
          ? "response.accepted"
          : "response.rejected";

      await dispatchWebhookEvent(delegation.anOrgId, event, {
        delegationId: delegation.id,
        responseId: response.id,
        agDecision: parsed.data.agDecision,
      });

      if (parsed.data.agDecision === "ACCEPTED") {
        await db
          .update(delegationsTable)
          .set({ status: "CONFIRMED" })
          .where(eq(delegationsTable.id, (req.params.delegationId as string)));
      }
    }

    res.json(response);
  },
);

export default router;

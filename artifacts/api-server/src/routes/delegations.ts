import { Router } from "express";
import { db } from "@workspace/db";
import {
  delegationsTable,
  delegationResponsesTable,
  takteTable,
  organizationsTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { dispatchWebhookEvent } from "../lib/webhookDispatcher";
import { writeHubMessage } from "../lib/hubMessageWriter";
import { z } from "zod";

const router = Router();

function isWithinBuffer(
  proposedStart: string | null | undefined,
  proposedEnd: string | null | undefined,
  earliestStart: string | null | undefined,
  latestEnd: string | null | undefined,
): boolean {
  if (!proposedStart || !proposedEnd) return false;
  if (!earliestStart || !latestEnd) return true;
  return proposedStart >= earliestStart && proposedEnd <= latestEnd;
}

// GET /delegations
router.get("/delegations", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;
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
      project: projectsTable,
    })
    .from(delegationsTable)
    .innerJoin(takteTable, eq(delegationsTable.taktId, takteTable.id))
    .innerJoin(
      organizationsTable,
      eq(delegationsTable.anOrgId, organizationsTable.id),
    )
    .innerJoin(projectsTable, eq(delegationsTable.projectId, projectsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Only show delegations where the session org is either AG or AN side
  const filtered = delegations.filter(
    (d) => d.delegation.agOrgId === orgId || d.delegation.anOrgId === orgId,
  );

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
    filtered.map(({ delegation, takt, anOrg, project }) => ({
      ...delegation,
      takt,
      anOrganization: anOrg,
      agOrganization: agOrgMap.get(delegation.agOrgId),
      project,
    })),
  );
});

// POST /delegations
router.post("/delegations", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId!;

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

  // Authorization: only the AG org that owns the project may delegate
  const [project] = await db
    .select({ agOrgId: projectsTable.agOrgId })
    .from(projectsTable)
    .where(eq(projectsTable.id, takt.projectId))
    .limit(1);

  if (!project || project.agOrgId !== orgId) {
    res.status(403).json({ error: "Only the AG organization that owns this project may delegate Takte" });
    return;
  }

  // State guard: Takt must be in a delegatable state
  if (takt.status !== "GEPLANT" && takt.status !== "ABGELEHNT" && takt.status !== "STORNIERT") {
    res.status(409).json({ error: "Takt is not in a delegatable state", status: takt.status });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [delegation] = await tx
      .insert(delegationsTable)
      .values({
        ...parsed.data,
        projectId: takt.projectId,
        agOrgId: orgId,
        status: "PENDING",
      })
      .returning();

    const [updatedTakt] = await tx
      .update(takteTable)
      .set({ status: "VERGEBEN" })
      .where(eq(takteTable.id, takt.id))
      .returning();

    return { delegation, updatedTakt };
  });

  if (!result.delegation) {
    res.status(500).json({ error: "Failed to create delegation" });
    return;
  }

  await dispatchWebhookEvent(parsed.data.anOrgId, "delegation.created", {
    delegationId: result.delegation.id,
    taktId: takt.id,
    agOrgId: orgId,
  });

  await writeHubMessage(
    "DELEGATION_CREATED",
    orgId,
    parsed.data.anOrgId,
    result.delegation.id,
    { taktId: takt.id, requestedStart: parsed.data.requestedStart, requestedEnd: parsed.data.requestedEnd, message: parsed.data.message ?? null },
  );

  const [anOrg] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, parsed.data.anOrgId))
    .limit(1);

  res.status(201).json({
    ...result.delegation,
    takt: result.updatedTakt ?? takt,
    anOrganization: anOrg,
  });
});

// GET /delegations/:delegationId
router.get(
  "/delegations/:delegationId",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;

    const anOrgAlias = organizationsTable;

    const [row] = await db
      .select({
        delegation: delegationsTable,
        takt: takteTable,
        anOrg: organizationsTable,
        project: projectsTable,
      })
      .from(delegationsTable)
      .innerJoin(takteTable, eq(delegationsTable.taktId, takteTable.id))
      .innerJoin(
        anOrgAlias,
        eq(delegationsTable.anOrgId, organizationsTable.id),
      )
      .innerJoin(projectsTable, eq(delegationsTable.projectId, projectsTable.id))
      .where(eq(delegationsTable.id, req.params.delegationId as string))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    // Authorization: only AG or AN side may read
    if (row.delegation.agOrgId !== orgId && row.delegation.anOrgId !== orgId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Fetch AG org separately (can't alias the same table in one drizzle select)
    const [agOrg] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, row.delegation.agOrgId))
      .limit(1);

    res.json({
      ...row.delegation,
      takt: row.takt,
      anOrganization: row.anOrg,
      agOrganization: agOrg ?? null,
      project: row.project,
    });
  },
);

// PATCH /delegations/:delegationId  (AG cancels)
router.patch(
  "/delegations/:delegationId",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;

    const schema = z.object({
      status: z.enum(["CANCELLED"]).optional(),
      message: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(delegationsTable)
      .where(eq(delegationsTable.id, req.params.delegationId as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    // Authorization: only the AG org that created the delegation may cancel or update it
    if (existing.agOrgId !== orgId) {
      res.status(403).json({ error: "Only the AG organization that created this delegation may modify it" });
      return;
    }

    let delegation = existing;

    if (parsed.data.status === "CANCELLED") {
      // State guard: only cancellable from active states
      if (existing.status !== "PENDING" && existing.status !== "ALTERNATIVE_PROPOSED") {
        res.status(409).json({
          error: "Delegation cannot be cancelled in its current state",
          status: existing.status,
        });
        return;
      }

      // Atomic: cancel delegation + set takt to STORNIERT
      const result = await db.transaction(async (tx) => {
        const [updatedDelegation] = await tx
          .update(delegationsTable)
          .set({ status: "CANCELLED" })
          .where(
            and(
              eq(delegationsTable.id, req.params.delegationId as string),
              // Conditional write: only if still in the expected state (prevents races)
              eq(delegationsTable.status, existing.status),
            ),
          )
          .returning();

        if (!updatedDelegation) return null;

        const [updatedTakt] = await tx
          .update(takteTable)
          .set({ status: "STORNIERT" })
          .where(eq(takteTable.id, existing.taktId))
          .returning();

        return { delegation: updatedDelegation, takt: updatedTakt };
      });

      if (!result) {
        res.status(409).json({ error: "Delegation state changed concurrently, please retry" });
        return;
      }

      delegation = result.delegation;

      await dispatchWebhookEvent(existing.anOrgId, "delegation.cancelled", {
        delegationId: existing.id,
      });

      await writeHubMessage(
        "DELEGATION_CANCELLED",
        orgId,
        existing.anOrgId,
        existing.id,
        {},
      );

      res.json({ ...delegation, takt: result.takt });
      return;
    } else if (parsed.data.message !== undefined) {
      const [updated] = await db
        .update(delegationsTable)
        .set({ message: parsed.data.message })
        .where(eq(delegationsTable.id, req.params.delegationId as string))
        .returning();
      if (updated) delegation = updated;
    }

    res.json(delegation);
  },
);

// DELETE /delegations/:delegationId
router.delete(
  "/delegations/:delegationId",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;

    const [existing] = await db
      .select()
      .from(delegationsTable)
      .where(eq(delegationsTable.id, req.params.delegationId as string))
      .limit(1);

    if (!existing) {
      res.status(404).send();
      return;
    }

    // Authorization: only AG org may hard-delete
    if (existing.agOrgId !== orgId) {
      res.status(403).json({ error: "Only the AG organization that created this delegation may delete it" });
      return;
    }

    await db
      .delete(delegationsTable)
      .where(eq(delegationsTable.id, req.params.delegationId as string));
    res.status(204).send();
  },
);

// GET /delegations/:delegationId/responses
router.get(
  "/delegations/:delegationId/responses",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;

    // Authorization: verify the caller belongs to this delegation (AG or AN side)
    const [delegation] = await db
      .select()
      .from(delegationsTable)
      .where(eq(delegationsTable.id, req.params.delegationId as string))
      .limit(1);

    if (!delegation) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    if (delegation.agOrgId !== orgId && delegation.anOrgId !== orgId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const responses = await db
      .select()
      .from(delegationResponsesTable)
      .where(
        eq(delegationResponsesTable.delegationId, req.params.delegationId as string),
      )
      .orderBy(delegationResponsesTable.createdAt);

    res.json(responses);
  },
);

// POST /delegations/:delegationId/responses  (AN responds)
router.post(
  "/delegations/:delegationId/responses",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;

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
      .where(eq(delegationsTable.id, req.params.delegationId as string))
      .limit(1);

    if (!delegation) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    // Authorization: only the AN org that received the delegation may respond
    if (delegation.anOrgId !== orgId) {
      res.status(403).json({ error: "Only the AN organization assigned to this delegation may submit a response" });
      return;
    }

    // State guard: AN can only respond to a PENDING delegation
    if (delegation.status !== "PENDING") {
      res.status(409).json({
        error: "Delegation is not awaiting a response",
        status: delegation.status,
      });
      return;
    }

    const withinBuffer = isWithinBuffer(
      parsed.data.proposedStart ?? delegation.requestedStart,
      parsed.data.proposedEnd ?? delegation.requestedEnd,
      delegation.earliestStart,
      delegation.latestEnd,
    );

    const newDelegationStatus =
      parsed.data.type === "CONFIRMED"
        ? "CONFIRMED"
        : parsed.data.type === "REJECTED"
          ? "REJECTED"
          : "ALTERNATIVE_PROPOSED";

    const newTaktStatus =
      parsed.data.type === "CONFIRMED"
        ? "BESTAETIGT"
        : parsed.data.type === "REJECTED"
          ? "ABGELEHNT"
          : "ALTERNATIV";

    // Atomic: insert response + update delegation + update takt
    const response = await db.transaction(async (tx) => {
      const [resp] = await tx
        .insert(delegationResponsesTable)
        .values({
          ...parsed.data,
          delegationId: req.params.delegationId as string,
          isWithinBuffer: withinBuffer,
          agDecision: "PENDING",
        })
        .returning();

      // Conditional update: only if delegation is still PENDING (prevents replay)
      const [updatedDelegation] = await tx
        .update(delegationsTable)
        .set({ status: newDelegationStatus })
        .where(
          and(
            eq(delegationsTable.id, req.params.delegationId as string),
            eq(delegationsTable.status, "PENDING"),
          ),
        )
        .returning();

      if (!updatedDelegation) {
        throw new Error("Delegation state changed concurrently");
      }

      await tx
        .update(takteTable)
        .set({ status: newTaktStatus })
        .where(eq(takteTable.id, delegation.taktId));

      return resp;
    });

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

    const hubMsgType =
      parsed.data.type === "CONFIRMED"
        ? "DELEGATION_CONFIRMED" as const
        : parsed.data.type === "REJECTED"
          ? "DELEGATION_REJECTED" as const
          : "DELEGATION_ALTERNATIVE" as const;
    await writeHubMessage(
      hubMsgType,
      orgId,
      delegation.agOrgId,
      delegation.id,
      { responseId: response?.id, type: parsed.data.type, isWithinBuffer: withinBuffer },
    );

    res.status(201).json(response);
  },
);

// PATCH /delegations/:delegationId/responses/:responseId  (AG decides on alternative)
router.patch(
  "/delegations/:delegationId/responses/:responseId",
  requireJwt,
  async (req, res): Promise<void> => {
    const orgId = req.user!.orgId!;

    const schema = z.object({
      agDecision: z.enum(["ACCEPTED", "REJECTED"]),
      agComment: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Load delegation to check ownership and state
    const [delegation] = await db
      .select()
      .from(delegationsTable)
      .where(eq(delegationsTable.id, req.params.delegationId as string))
      .limit(1);

    if (!delegation) {
      res.status(404).json({ error: "Delegation not found" });
      return;
    }

    // Authorization: only the AG org may decide on an alternative
    if (delegation.agOrgId !== orgId) {
      res.status(403).json({ error: "Only the AG organization that created this delegation may accept or reject alternatives" });
      return;
    }

    // State guard: AG can only decide when there is an open alternative proposal
    if (delegation.status !== "ALTERNATIVE_PROPOSED") {
      res.status(409).json({
        error: "Delegation is not awaiting an AG decision on an alternative",
        status: delegation.status,
      });
      return;
    }

    // Guard: response must belong to this delegation
    const [existingResponse] = await db
      .select()
      .from(delegationResponsesTable)
      .where(
        and(
          eq(delegationResponsesTable.id, req.params.responseId as string),
          eq(delegationResponsesTable.delegationId, req.params.delegationId as string),
        ),
      )
      .limit(1);

    if (!existingResponse) {
      res.status(404).json({ error: "Response not found for this delegation" });
      return;
    }

    const newDelegationStatus =
      parsed.data.agDecision === "ACCEPTED" ? "CONFIRMED" : "REJECTED";
    const newTaktStatus =
      parsed.data.agDecision === "ACCEPTED" ? "BESTAETIGT" : "ABGELEHNT";

    // Atomic: update response + delegation + takt
    const response = await db.transaction(async (tx) => {
      const [updatedResponse] = await tx
        .update(delegationResponsesTable)
        .set(parsed.data)
        .where(eq(delegationResponsesTable.id, req.params.responseId as string))
        .returning();

      // Conditional: only if delegation is still ALTERNATIVE_PROPOSED (prevents replay)
      const [updatedDelegation] = await tx
        .update(delegationsTable)
        .set({ status: newDelegationStatus })
        .where(
          and(
            eq(delegationsTable.id, req.params.delegationId as string),
            eq(delegationsTable.status, "ALTERNATIVE_PROPOSED"),
          ),
        )
        .returning();

      if (!updatedDelegation) {
        throw new Error("Delegation state changed concurrently");
      }

      await tx
        .update(takteTable)
        .set({ status: newTaktStatus })
        .where(eq(takteTable.id, delegation.taktId));

      return updatedResponse;
    });

    const event =
      parsed.data.agDecision === "ACCEPTED" ? "response.accepted" : "response.rejected";

    await dispatchWebhookEvent(delegation.anOrgId, event, {
      delegationId: delegation.id,
      responseId: response?.id,
      agDecision: parsed.data.agDecision,
    });

    await writeHubMessage(
      parsed.data.agDecision === "ACCEPTED" ? "AG_ACCEPTED_ALTERNATIVE" : "AG_REJECTED_ALTERNATIVE",
      orgId,
      delegation.anOrgId,
      delegation.id,
      { responseId: response?.id, agDecision: parsed.data.agDecision },
    );

    res.json(response);
  },
);

export default router;

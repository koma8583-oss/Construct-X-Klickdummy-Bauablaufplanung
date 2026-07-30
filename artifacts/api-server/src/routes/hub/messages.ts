/**
 * Hub message routes — read access to the central message log.
 * Mounted at /api/hub/messages/*
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  hubMessagesTable,
  organizationsTable,
  delegationsTable,
  takteTable,
  projectsTable,
} from "@workspace/db";
import { eq, or, and, desc, SQL } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";

const router = Router();

// GET /messages
router.get("/", requireJwt, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const orgId = req.user!.orgId;
  const admin = req.user!.hubAdmin;
  const { type, delegationId, limit: limitStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr ?? "50", 10) || 50, 200);

  const conditions: SQL[] = [];
  if (type) conditions.push(eq(hubMessagesTable.type, type as any));
  if (delegationId) conditions.push(eq(hubMessagesTable.delegationId, delegationId));

  // Non-admins only see their own org's messages
  if (!admin && orgId) {
    conditions.push(
      or(
        eq(hubMessagesTable.senderOrgId, orgId),
        eq(hubMessagesTable.recipientOrgId, orgId),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(hubMessagesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(hubMessagesTable.createdAt))
    .limit(limit);

  // Enrich with org names
  const orgIds = [...new Set(rows.flatMap(r => [r.senderOrgId, r.recipientOrgId]))];
  const orgs = await db
    .select({ id: organizationsTable.id, name: organizationsTable.name, type: organizationsTable.type })
    .from(organizationsTable)
    .where(
      orgIds.length > 0
        ? or(...orgIds.map(id => eq(organizationsTable.id, id)))
        : undefined,
    );
  const orgMap = new Map(orgs.map(o => [o.id, o]));

  // Suppress unused variable warning
  void userId;

  res.json(rows.map(msg => ({
    ...msg,
    senderOrg: orgMap.get(msg.senderOrgId),
    recipientOrg: orgMap.get(msg.recipientOrgId),
  })));
});

// GET /messages/timeline/:delegationId — all hub_messages for one delegation
router.get("/timeline/:delegationId", requireJwt, async (req, res): Promise<void> => {
  const orgId = req.user!.orgId;
  const admin = req.user!.hubAdmin;
  const { delegationId } = req.params as { delegationId: string };

  // Fetch the delegation to verify access
  const [delegation] = await db
    .select()
    .from(delegationsTable)
    .where(eq(delegationsTable.id, delegationId))
    .limit(1);

  if (!delegation) {
    res.status(404).json({ error: "Delegation not found" });
    return;
  }

  if (!admin && orgId !== delegation.agOrgId && orgId !== delegation.anOrgId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Get takt + project for context
  const [takt] = await db
    .select()
    .from(takteTable)
    .where(eq(takteTable.id, delegation.taktId))
    .limit(1);

  const [project] = takt
    ? await db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(eq(projectsTable.id, takt.projectId))
        .limit(1)
    : [null];

  // All hub messages for this delegation
  const messages = await db
    .select()
    .from(hubMessagesTable)
    .where(eq(hubMessagesTable.delegationId, delegationId))
    .orderBy(hubMessagesTable.createdAt);

  res.json({
    delegation: {
      ...delegation,
      takt: takt ?? null,
      project: project ?? null,
    },
    timeline: messages,
  });
});

// DELETE /messages/:messageId — hub admin only
router.delete("/:messageId", requireJwt, async (req, res): Promise<void> => {
  const admin = req.user!.hubAdmin;
  if (!admin) {
    res.status(403).json({ error: "Nur Hub-Admins können Nachrichten löschen" });
    return;
  }

  const { messageId } = req.params as { messageId: string };

  const [deleted] = await db
    .delete(hubMessagesTable)
    .where(eq(hubMessagesTable.id, messageId))
    .returning({ id: hubMessagesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Nachricht nicht gefunden" });
    return;
  }

  res.status(204).send();
});

export default router;

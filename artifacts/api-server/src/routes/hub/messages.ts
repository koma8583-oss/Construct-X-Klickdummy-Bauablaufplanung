/**
 * Hub message routes — read access to the central message log.
 * Mounted at /api/hub/messages/*
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  hubMessagesTable,
  hubAdminsTable,
  organizationsTable,
  delegationsTable,
  takteTable,
  projectsTable,
} from "@workspace/db";
import { eq, or, and, desc, SQL } from "drizzle-orm";
import { z } from "zod";

const router = Router();

/** Middleware: require hub session */
function requireHubAuth(req: any, res: any, next: any) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function isHubAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(hubAdminsTable)
    .where(eq(hubAdminsTable.userId, userId))
    .limit(1);
  return !!row;
}

// GET /messages
router.get("/", requireHubAuth, async (req, res): Promise<void> => {
  const userId = req.session!.userId!;
  const orgId = req.session!.orgId;
  const { type, delegationId, limit: limitStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr ?? "50", 10) || 50, 200);

  const admin = await isHubAdmin(userId);

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

  res.json(rows.map(msg => ({
    ...msg,
    senderOrg: orgMap.get(msg.senderOrgId),
    recipientOrg: orgMap.get(msg.recipientOrgId),
  })));
});

// GET /messages/timeline/:delegationId — all hub_messages for one delegation
router.get("/timeline/:delegationId", requireHubAuth, async (req, res): Promise<void> => {
  const userId = req.session!.userId!;
  const orgId = req.session!.orgId;
  const { delegationId } = req.params as { delegationId: string };

  const admin = await isHubAdmin(userId);

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

  // Enrich org names
  const orgIds = [...new Set(messages.flatMap(r => [r.senderOrgId, r.recipientOrgId]))];
  const orgs = orgIds.length > 0
    ? await db
        .select({ id: organizationsTable.id, name: organizationsTable.name, type: organizationsTable.type })
        .from(organizationsTable)
        .where(or(...orgIds.map(id => eq(organizationsTable.id, id)))!)
    : [];
  const orgMap = new Map(orgs.map(o => [o.id, o]));

  res.json({
    delegation: {
      ...delegation,
      takt: takt ?? null,
      project: project ?? null,
    },
    timeline: messages.map(msg => ({
      ...msg,
      senderOrg: orgMap.get(msg.senderOrgId),
      recipientOrg: orgMap.get(msg.recipientOrgId),
    })),
  });
});

export default router;

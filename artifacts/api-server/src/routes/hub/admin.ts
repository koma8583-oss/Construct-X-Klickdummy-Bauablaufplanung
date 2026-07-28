/**
 * Hub admin routes — mounted at /api/hub/admin/*
 * Requires hub admin role.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  organizationsTable,
  userOrganizationsTable,
  hubAdminsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [row] = await db
    .select()
    .from(hubAdminsTable)
    .where(eq(hubAdminsTable.userId, req.session.userId))
    .limit(1);
  if (!row) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// GET /admin/users — list all users with their org and hub role
router.get("/users", requireAdmin, async (req, res): Promise<void> => {
  const users = await db
    .select({
      user: usersTable,
    })
    .from(usersTable)
    .orderBy(usersTable.createdAt);

  const enriched = await Promise.all(
    users.map(async ({ user }) => {
      const [membership] = await db
        .select({
          orgId: userOrganizationsTable.orgId,
          orgName: organizationsTable.name,
          orgType: organizationsTable.type,
          role: userOrganizationsTable.role,
        })
        .from(userOrganizationsTable)
        .innerJoin(
          organizationsTable,
          eq(userOrganizationsTable.orgId, organizationsTable.id),
        )
        .where(eq(userOrganizationsTable.userId, user.id))
        .limit(1);

      const [admin] = await db
        .select()
        .from(hubAdminsTable)
        .where(eq(hubAdminsTable.userId, user.id))
        .limit(1);

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        hubRole: admin ? "ADMIN" : (membership?.orgType ?? "UNKNOWN"),
        orgId: membership?.orgId ?? null,
        orgName: membership?.orgName ?? null,
        orgType: membership?.orgType ?? null,
      };
    }),
  );

  res.json(enriched);
});

// GET /admin/orgs — list all organisations
router.get("/orgs", requireAdmin, async (req, res): Promise<void> => {
  const orgs = await db
    .select()
    .from(organizationsTable)
    .orderBy(organizationsTable.type, organizationsTable.name);
  res.json(orgs);
});

export default router;

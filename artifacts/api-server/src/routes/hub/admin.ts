/**
 * Hub admin routes — mounted at /api/hub/admin/*
 * Requires hub admin role (hubAdmin: true in JWT).
 */
import { Router } from "express";
import { hubDb as db } from "@workspace/db";
import {
  usersTable,
  organizationsTable,
  userOrganizationsTable,
  hubAdminsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";
import { requireRole } from "../../middlewares/requireRole";

const router = Router();

// GET /admin/users — list all users with their org and hub role
router.get("/users", requireJwt, requireRole("HUB_ADMIN"), async (req, res): Promise<void> => {
  if (!req.user?.hubAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

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
router.get("/orgs", requireJwt, requireRole("HUB_ADMIN"), async (req, res): Promise<void> => {
  if (!req.user?.hubAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const orgs = await db
    .select()
    .from(organizationsTable)
    .orderBy(organizationsTable.type, organizationsTable.name);
  res.json(orgs);
});

export default router;

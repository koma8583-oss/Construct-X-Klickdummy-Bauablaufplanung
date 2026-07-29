import { Router } from "express";
import { db } from "@workspace/db";
import {
  organizationsTable,
  userOrganizationsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, ilike, or } from "drizzle-orm";
import { requireJwt } from "../middlewares/requireJwt";
import { z } from "zod";

const router = Router();

// GET /organizations
router.get("/organizations", requireJwt, async (req, res): Promise<void> => {
  const type = req.query.type as "AG" | "AN" | undefined;
  const search = req.query.search as string | undefined;

  let query = db.select().from(organizationsTable).$dynamic();

  if (type) {
    query = query.where(eq(organizationsTable.type, type));
  }
  if (search) {
    query = query.where(ilike(organizationsTable.name, `%${search}%`));
  }

  const orgs = await query;
  res.json(orgs);
});

// POST /organizations
router.post("/organizations", requireJwt, async (req, res): Promise<void> => {
  const schema = z.object({
    name: z.string().min(1),
    type: z.enum(["AG", "AN"]),
    description: z.string().optional(),
    contactEmail: z.string().email().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [org] = await db
    .insert(organizationsTable)
    .values(parsed.data)
    .returning();

  if (org && req.user!.userId) {
    await db.insert(userOrganizationsTable).values({
      userId: req.user!.userId,
      orgId: org.id,
      role: "ADMIN",
    });
  }

  res.status(201).json(org);
});

// GET /organizations/me
router.get(
  "/organizations/me",
  requireJwt,
  async (req, res): Promise<void> => {
    const memberships = await db
      .select({
        organization: organizationsTable,
        role: userOrganizationsTable.role,
        joinedAt: userOrganizationsTable.joinedAt,
      })
      .from(userOrganizationsTable)
      .innerJoin(
        organizationsTable,
        eq(userOrganizationsTable.orgId, organizationsTable.id),
      )
      .where(eq(userOrganizationsTable.userId, req.user!.userId!));

    res.json(
      memberships.map((m) => ({
        organization: m.organization,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    );
  },
);

// GET /organizations/:orgId
router.get(
  "/organizations/:orgId",
  requireJwt,
  async (req, res): Promise<void> => {
    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, (req.params.orgId as string)))
      .limit(1);

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    res.json(org);
  },
);

// PATCH /organizations/:orgId
router.patch(
  "/organizations/:orgId",
  requireJwt,
  async (req, res): Promise<void> => {
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      contactEmail: z.string().email().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [org] = await db
      .update(organizationsTable)
      .set(parsed.data)
      .where(eq(organizationsTable.id, (req.params.orgId as string)))
      .returning();

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    res.json(org);
  },
);

// GET /organizations/:orgId/members
router.get(
  "/organizations/:orgId/members",
  requireJwt,
  async (req, res): Promise<void> => {
    const members = await db
      .select({
        userId: userOrganizationsTable.userId,
        name: usersTable.name,
        email: usersTable.email,
        role: userOrganizationsTable.role,
        joinedAt: userOrganizationsTable.joinedAt,
      })
      .from(userOrganizationsTable)
      .innerJoin(
        usersTable,
        eq(userOrganizationsTable.userId, usersTable.id),
      )
      .where(eq(userOrganizationsTable.orgId, (req.params.orgId as string)));

    res.json(members);
  },
);

// POST /organizations/:orgId/members
router.post(
  "/organizations/:orgId/members",
  requireJwt,
  async (req, res): Promise<void> => {
    const schema = z.object({
      email: z.string().email(),
      role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, parsed.data.email))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await db
      .insert(userOrganizationsTable)
      .values({
        userId: user.id,
        orgId: (req.params.orgId as string),
        role: parsed.data.role,
      })
      .onConflictDoUpdate({
        target: [
          userOrganizationsTable.userId,
          userOrganizationsTable.orgId,
        ],
        set: { role: parsed.data.role },
      });

    res.status(201).json({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: parsed.data.role,
      joinedAt: new Date(),
    });
  },
);

// DELETE /organizations/:orgId/members/:userId
router.delete(
  "/organizations/:orgId/members/:userId",
  requireJwt,
  async (req, res): Promise<void> => {
    await db
      .delete(userOrganizationsTable)
      .where(
        and(
          eq(userOrganizationsTable.orgId, (req.params.orgId as string)),
          eq(userOrganizationsTable.userId, (req.params.userId as string)),
        ),
      );

    res.status(204).send();
  },
);

// GET /users/me
router.get("/users/me", requireJwt, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId!))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    preferredLanguage: user.preferredLanguage,
    createdAt: user.createdAt,
  });
});

// PATCH /users/me
router.patch("/users/me", requireJwt, async (req, res): Promise<void> => {
  const schema = z.object({
    name: z.string().min(1).optional(),
    preferredLanguage: z.enum(["de", "en"]).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, req.user!.userId!))
    .returning();

  res.json({
    id: user!.id,
    name: user!.name,
    email: user!.email,
    preferredLanguage: user!.preferredLanguage,
    createdAt: user!.createdAt,
  });
});

export default router;

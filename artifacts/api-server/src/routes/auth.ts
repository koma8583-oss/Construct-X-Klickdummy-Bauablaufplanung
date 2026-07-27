import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable,
  organizationsTable,
  userOrganizationsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  companyName: z.string().min(1),
  orgType: z.enum(["AG", "AN"]).default("AG"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, password, companyName, orgType } = parsed.data;

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db
    .insert(usersTable)
    .values({ name, email, passwordHash })
    .returning();

  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  const [org] = await db
    .insert(organizationsTable)
    .values({ name: companyName, type: orgType })
    .returning();

  if (!org) {
    res.status(500).json({ error: "Failed to create organization" });
    return;
  }

  await db.insert(userOrganizationsTable).values({
    userId: user.id,
    orgId: org.id,
    role: "ADMIN",
  });

  req.session.userId = user.id;
  req.session.orgId = org.id;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Session save failed" });
      return;
    }
    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      orgId: org.id,
      orgName: org.name,
      orgType: org.type,
    });
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

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

  if (!membership) {
    res.status(403).json({ error: "User has no organization" });
    return;
  }

  req.session.userId = user.id;
  req.session.orgId = membership.orgId;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Session save failed" });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      preferredLanguage: user.preferredLanguage,
      orgId: membership.orgId,
      orgName: membership.orgName,
      orgType: membership.orgType,
      role: membership.role,
    });
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId))
    .limit(1);

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "User not found" });
    return;
  }

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

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    preferredLanguage: user.preferredLanguage,
    orgId: req.session.orgId ?? membership?.orgId,
    orgName: membership?.orgName,
    orgType: membership?.orgType,
    role: membership?.role,
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// Switch active org (for users with multiple orgs)
router.post("/auth/switch-org", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { orgId } = req.body as { orgId: string };

  const [membership] = await db
    .select()
    .from(userOrganizationsTable)
    .where(
      eq(userOrganizationsTable.userId, req.session.userId),
    )
    .limit(1);

  if (!membership || membership.orgId !== orgId) {
    res.status(403).json({ error: "Not a member of this organization" });
    return;
  }

  req.session.orgId = orgId;
  res.json({ ok: true, orgId });
});

export default router;

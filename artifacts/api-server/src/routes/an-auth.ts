/**
 * AN-App specific auth routes: /api/an-auth/*
 *
 * These routes ONLY accept AN (Nachunternehmen) accounts.
 * This provides full session isolation from the AG-App:
 *   - AG users cannot log into the AN-App
 *   - /an-auth/me returns 401 when the active session belongs to an AG org
 */
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
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// GET /an-auth/me
router.get("/an-auth/me", async (req, res): Promise<void> => {
  if (!req.session?.userId || !req.session?.orgId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Verify the active session is an AN account
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
    .where(eq(userOrganizationsTable.userId, req.session.userId))
    .limit(1);

  if (!membership || membership.orgType !== "AN") {
    // Session exists but belongs to an AG org — treat as unauthenticated for AN-App
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
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

// POST /an-auth/login
router.post("/an-auth/login", async (req, res): Promise<void> => {
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
    res.status(401).json({ error: "Ungültige Anmeldedaten" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Ungültige Anmeldedaten" });
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
    res.status(403).json({ error: "Benutzer gehört keiner Organisation an" });
    return;
  }

  if (membership.orgType !== "AN") {
    res.status(403).json({
      error:
        "Dieses Konto ist ein Auftraggeber-Konto. Bitte verwenden Sie die AG-Anmeldung.",
    });
    return;
  }

  req.session.userId = user.id;
  req.session.orgId = membership.orgId;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Session konnte nicht gespeichert werden" });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      orgId: membership.orgId,
      orgName: membership.orgName,
      orgType: membership.orgType,
      role: membership.role,
    });
  });
});

// POST /an-auth/register (always registers as AN)
router.post("/an-auth/register", async (req, res): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, password, companyName } = parsed.data;

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "E-Mail bereits registriert" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db
    .insert(usersTable)
    .values({ name, email, passwordHash })
    .returning();

  if (!user) {
    res.status(500).json({ error: "Benutzer konnte nicht erstellt werden" });
    return;
  }

  const [org] = await db
    .insert(organizationsTable)
    .values({ name: companyName, type: "AN" })
    .returning();

  if (!org) {
    res.status(500).json({ error: "Organisation konnte nicht erstellt werden" });
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
      res.status(500).json({ error: "Session konnte nicht gespeichert werden" });
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

// POST /an-auth/logout
router.post("/an-auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

export default router;

/**
 * Hub authentication routes (mounted at /api/hub/auth/*)
 *
 * Einmalige Registrierung: AG / AN / ADMIN
 * - AG → creates user + AG-Organisation + user_organizations
 * - AN → creates user + AN-Organisation + user_organizations
 * - ADMIN → creates user + hub_admins entry (no organisation)
 *
 * Login validates against the shared users table.
 * Session cookie: tk_hub_sid
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable,
  organizationsTable,
  userOrganizationsTable,
  hubAdminsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// Public registration only allows AG and AN.
// ADMIN accounts must be created manually via the database — never via this endpoint.
const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["AG", "AN"]),
  companyName: z.string().min(1, "Firmenname ist erforderlich"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// GET /auth/me
router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session?.userId) {
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

  // Check hub admin
  const [admin] = await db
    .select()
    .from(hubAdminsTable)
    .where(eq(hubAdminsTable.userId, user.id))
    .limit(1);

  if (admin) {
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      hubRole: "ADMIN" as const,
      orgId: null,
      orgName: null,
      orgType: null,
    });
    return;
  }

  // Check org membership
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
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    hubRole: membership.orgType as "AG" | "AN",
    orgId: membership.orgId,
    orgName: membership.orgName,
    orgType: membership.orgType,
    role: membership.role,
  });
});

// POST /auth/login
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
    res.status(401).json({ error: "Ungültige Anmeldedaten" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Ungültige Anmeldedaten" });
    return;
  }

  // Determine role
  const [admin] = await db
    .select()
    .from(hubAdminsTable)
    .where(eq(hubAdminsTable.userId, user.id))
    .limit(1);

  if (admin) {
    req.session.userId = user.id;
    req.session.orgId = "";
    req.session.hubRole = "ADMIN";
    req.session.save((err) => {
      if (err) { res.status(500).json({ error: "Session error" }); return; }
      res.json({ id: user.id, name: user.name, email: user.email, hubRole: "ADMIN", orgId: null, orgName: null, orgType: null });
    });
    return;
  }

  const [membership] = await db
    .select({
      orgId: userOrganizationsTable.orgId,
      orgName: organizationsTable.name,
      orgType: organizationsTable.type,
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

  req.session.userId = user.id;
  req.session.orgId = membership.orgId;
  req.session.hubRole = membership.orgType as "AG" | "AN";

  req.session.save((err) => {
    if (err) { res.status(500).json({ error: "Session error" }); return; }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      hubRole: membership.orgType,
      orgId: membership.orgId,
      orgName: membership.orgName,
      orgType: membership.orgType,
    });
  });
});

// POST /auth/register
router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, password, role, companyName } = parsed.data;

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

  // Create organisation for AG or AN
  const [org] = await db
    .insert(organizationsTable)
    .values({ name: companyName!, type: role })
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
  req.session.hubRole = role;

  req.session.save((err) => {
    if (err) { res.status(500).json({ error: "Session error" }); return; }
    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      hubRole: role,
      orgId: org.id,
      orgName: org.name,
      orgType: org.type,
    });
  });
});

// POST /auth/logout
router.post("/auth/logout", (req, res): void => {
  req.session.destroy((err) => {
    if (err) console.warn("hub session destroy error:", err);
    res.clearCookie("tk_hub_sid", { httpOnly: true, path: "/" });
    res.json({ ok: true });
  });
});

export default router;

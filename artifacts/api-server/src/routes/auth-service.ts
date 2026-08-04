/**
 * Centralized auth service — mounted at /auth-service in app.ts
 *
 * Endpoints:
 *   POST /auth-service/register  — create user + org (AG/AN); returns access token + sets refresh cookie
 *   POST /auth-service/login     — verify credentials; returns access token + sets refresh cookie
 *   POST /auth-service/refresh   — exchange refresh cookie for new access token (token rotation)
 *   POST /auth-service/logout    — delete refresh token, clear cookie
 *   GET  /auth-service/me        — verify Bearer token, return user profile
 *   GET  /auth-service/healthz   — liveness probe
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import {
  usersTable,
  organizationsTable,
  userOrganizationsTable,
  hubAdminsTable,
  refreshTokensTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_COOKIE_NAME = "tk_refresh";
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const REFRESH_TOKEN_EXPIRY_MS =
  REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

interface TokenPayload {
  userId: string;
  orgId: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin: boolean;
  roles: string[];
}

interface UserProfile {
  id: string;
  name: string;
  email: string;
  preferredLanguage: string;
  orgId: string | null;
  orgName: string | null;
  orgType: "AG" | "AN" | null;
  hubAdmin: boolean;
  roles: string[];
}

function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  } as jwt.SignOptions);
}

async function createRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  await db.insert(refreshTokensTable).values({ token, userId, expiresAt });
  return token;
}

function setRefreshCookie(res: any, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
    path: "/",
  });
}

async function buildUserProfile(userId: string): Promise<UserProfile | null> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return null;

  // Check hub admin first
  const [admin] = await db
    .select()
    .from(hubAdminsTable)
    .where(eq(hubAdminsTable.userId, userId))
    .limit(1);

  if (admin) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      preferredLanguage: user.preferredLanguage ?? "de",
      orgId: null,
      orgName: null,
      orgType: null,
      hubAdmin: true,
      roles: user.roles ?? [],
    };
  }

  // Check org membership
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
    .where(eq(userOrganizationsTable.userId, userId))
    .limit(1);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    preferredLanguage: user.preferredLanguage ?? "de",
    orgId: membership?.orgId ?? null,
    orgName: membership?.orgName ?? null,
    orgType: membership?.orgType ?? null,
    hubAdmin: false,
    roles: user.roles ?? [],
  };
}

// ── GET /auth-service/healthz ────────────────────────────────────────────────
router.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// ── POST /auth-service/register ──────────────────────────────────────────────
const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  orgType: z.enum(["AG", "AN"]),
  companyName: z.string().min(1),
});

router.post("/register", async (req, res): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, password, orgType, companyName } = parsed.data;

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

  // Determine the initial role for this org type (founder always gets admin)
  const initialRole: string = orgType === "AG" ? "AG_ADMIN" : "AN_ADMIN";

  // Atomically create user, organisation, and membership.
  // If any step fails the whole transaction is rolled back — no orphaned rows.
  let user: typeof usersTable.$inferSelect;
  let org:  typeof organizationsTable.$inferSelect;

  try {
    const result = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(usersTable)
        .values({ name, email, passwordHash, roles: [initialRole] })
        .returning();
      if (!newUser) throw new Error("Benutzer konnte nicht erstellt werden");

      const [newOrg] = await tx
        .insert(organizationsTable)
        .values({ name: companyName, type: orgType })
        .returning();
      if (!newOrg) throw new Error("Organisation konnte nicht erstellt werden");

      await tx.insert(userOrganizationsTable).values({
        userId: newUser.id,
        orgId:  newOrg.id,
        role:   "ADMIN",
      });

      return { user: newUser, org: newOrg };
    });
    user = result.user;
    org  = result.org;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Registrierung fehlgeschlagen";
    res.status(500).json({ error: msg });
    return;
  }

  // Refresh token is created only after the transaction commits successfully
  const tokenPayload: TokenPayload = {
    userId: user.id,
    orgId:  org.id,
    orgType,
    hubAdmin: false,
    roles: [initialRole],
  };

  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = await createRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  const profile: UserProfile = {
    id: user.id,
    name: user.name,
    email: user.email,
    preferredLanguage: user.preferredLanguage ?? "de",
    orgId:   org.id,
    orgName: org.name,
    orgType,
    hubAdmin: false,
    roles: [initialRole],
  };

  res.status(201).json({ accessToken, user: profile });
});

// ── POST /auth-service/login ─────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res): Promise<void> => {
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

  const profile = await buildUserProfile(user.id);
  if (!profile) {
    res.status(500).json({ error: "Profil konnte nicht geladen werden" });
    return;
  }

  if (!profile.hubAdmin && !profile.orgId) {
    res.status(403).json({ error: "Benutzer gehört keiner Organisation an" });
    return;
  }

  const tokenPayload: TokenPayload = {
    userId: user.id,
    orgId: profile.orgId,
    orgType: profile.orgType,
    hubAdmin: profile.hubAdmin,
    roles: profile.roles,
  };

  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = await createRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  res.json({ accessToken, user: profile });
});

// ── POST /auth-service/refresh ───────────────────────────────────────────────
router.post("/refresh", async (req, res): Promise<void> => {
  const oldToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

  if (!oldToken) {
    res.status(401).json({ error: "No refresh token" });
    return;
  }

  const [row] = await db
    .select()
    .from(refreshTokensTable)
    .where(eq(refreshTokensTable.token, oldToken))
    .limit(1);

  if (!row || row.expiresAt < new Date()) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
    res.status(401).json({ error: "Refresh token expired or invalid" });
    return;
  }

  const profile = await buildUserProfile(row.userId);
  if (!profile) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
    res.status(401).json({ error: "User not found" });
    return;
  }

  // Rotate: delete old token, create new one
  await db
    .delete(refreshTokensTable)
    .where(eq(refreshTokensTable.token, oldToken));
  const newRefreshToken = await createRefreshToken(row.userId);
  setRefreshCookie(res, newRefreshToken);

  const tokenPayload: TokenPayload = {
    userId: profile.id,
    orgId: profile.orgId,
    orgType: profile.orgType,
    hubAdmin: profile.hubAdmin,
    roles: profile.roles,
  };

  const accessToken = signAccessToken(tokenPayload);

  res.json({ accessToken, user: profile });
});

// ── POST /auth-service/logout ────────────────────────────────────────────────
router.post("/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

  if (token) {
    await db
      .delete(refreshTokensTable)
      .where(eq(refreshTokensTable.token, token))
      .catch(() => {
        // token may already be gone — ignore
      });
  }

  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

// ── GET /auth-service/me ─────────────────────────────────────────────────────
router.get("/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = auth.slice(7);
  let payload: TokenPayload;

  try {
    payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const profile = await buildUserProfile(payload.userId);
  if (!profile) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(profile);
});

export default router;

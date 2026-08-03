import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "taktkoord-jwt-dev-secret-change-in-prod";

/**
 * JWT bearer-token middleware — replaces the old session-based requireAuth.
 * Reads `Authorization: Bearer <token>`, verifies it, and sets req.user.
 *
 * The `roles` field is optional in the token (older tokens omit it) — when
 * absent we default to an empty array, which triggers soft-enforcement in
 * requireRole (i.e. legacy tokens are not blocked by role checks).
 */
export function requireJwt(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = auth.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      orgId: string | null;
      orgType: "AG" | "AN" | null;
      hubAdmin: boolean;
      roles?: string[];
    };

    req.user = {
      userId: payload.userId,
      orgId: payload.orgId,
      orgType: payload.orgType,
      hubAdmin: payload.hubAdmin ?? false,
      roles: payload.roles ?? [],
    };

    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

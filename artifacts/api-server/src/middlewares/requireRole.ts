import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@workspace/db";

/**
 * Role-check middleware factory — fail-closed.
 *
 * Creates a middleware that ensures the authenticated user holds at least one
 * of the specified roles. If the user has no roles or no matching role, 403 is
 * returned immediately with no exceptions.
 *
 * Usage:
 *   router.post("/takt-requests", requireJwt, requireRole("AG_ADMIN", "GENERAL_PLANNER"), handler)
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return function roleMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const roles = req.user?.roles ?? [];

    const hasRole = roles.some((r) =>
      (allowedRoles as string[]).includes(r),
    );

    if (!hasRole) {
      res.status(403).json({
        error: "Forbidden: your role does not permit this action",
        requiredRoles: allowedRoles,
        yourRoles: roles,
      });
      return;
    }

    next();
  };
}

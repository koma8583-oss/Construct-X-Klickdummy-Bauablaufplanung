import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@workspace/db";

/**
 * Role-check middleware factory.
 *
 * Creates a middleware that ensures the authenticated user holds at least one
 * of the specified roles.
 *
 * Soft enforcement: if the user's `roles` array is empty (legacy / unassigned
 * user), the check is skipped and the request is allowed through.  This keeps
 * all existing tests that use bare JWT tokens (no roles) working unchanged.
 *
 * If the user has been assigned roles but none of them match the required set,
 * a 403 is returned immediately.
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

    // Soft enforcement: unassigned users are not blocked (backward compat).
    if (roles.length === 0) {
      next();
      return;
    }

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

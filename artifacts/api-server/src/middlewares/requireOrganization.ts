import type { NextFunction, Request, Response } from "express";
import { db, organizationsTable, userOrganizationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

type OrganizationType = "AG" | "AN";

/**
 * Verifies the organization claims against the database membership.
 *
 * JWT claims are authentication data, not authorization data. In particular,
 * never use an orgId/orgType claim for a data query until the user is still a
 * member of that organization and the persisted type agrees with the claim.
 */
export function requireOrganizationType(...allowedTypes: OrganizationType[]) {
  return async function organizationMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const user = req.user;
    if (
      !user ||
      user.hubAdmin ||
      !user.orgId ||
      !user.orgType ||
      !allowedTypes.includes(user.orgType)
    ) {
      res.status(403).json({ error: "Forbidden: organization access is not permitted" });
      return;
    }

    const [membership] = await db
      .select({ orgType: organizationsTable.type })
      .from(userOrganizationsTable)
      .innerJoin(
        organizationsTable,
        eq(userOrganizationsTable.orgId, organizationsTable.id),
      )
      .where(
        and(
          eq(userOrganizationsTable.userId, user.userId),
          eq(userOrganizationsTable.orgId, user.orgId),
        ),
      )
      .limit(1);

    if (!membership || membership.orgType !== user.orgType) {
      res.status(403).json({ error: "Forbidden: organization membership is invalid" });
      return;
    }

    next();
  };
}

/**
 * Restricts an organization resource to the caller's own organization.
 * A 404 avoids disclosing whether another organization's identifier exists.
 */
export function requireOwnOrganization(param = "orgId") {
  return function ownOrganizationMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!req.user?.orgId || req.params[param] !== req.user.orgId) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    next();
  };
}
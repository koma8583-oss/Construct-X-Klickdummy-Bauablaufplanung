import { Router } from "express";
import { db, policyTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";
import { buildOdrl } from "../../lib/odrl-builder";

const router = Router();

// Informative AN policy library. Only active policies are published here.
router.get("/policies", requireJwt, async (req, res): Promise<void> => {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "AN organisation required" });
    return;
  }

  const policies = await db
    .select()
    .from(policyTemplatesTable)
    .where(eq(policyTemplatesTable.active, true));

  res.json(policies.map((policy) => ({
    ...policy,
    odrl: buildOdrl({
      publicationId: `policy-${policy.code.toLowerCase()}`,
      policyCode: policy.code,
      agOrgId: "policy-library",
      nuOrgId: req.user!.orgId!,
      validFrom: null,
      validUntil: null,
    }),
  })));
});

export default router;
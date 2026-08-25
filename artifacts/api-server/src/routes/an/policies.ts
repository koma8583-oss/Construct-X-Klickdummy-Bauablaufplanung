import { Router } from "express";
import {
  db,
  dataPublicationRecipientsTable,
  dataPublicationsTable,
  organizationsTable,
  policyTemplatesTable,
  projectsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireJwt } from "../../middlewares/requireJwt";
import { buildOdrl } from "../../lib/odrl-builder";

const router = Router();

// Informative AN policy library. Only active policies are published here.
router.get("/policies", requireJwt, async (req, res): Promise<void> => {
  if (req.user?.orgType !== "AN" || !req.user.orgId) {
    res.status(403).json({ error: "AN organisation required" });
    return;
  }

  const rows = await db
    .select({
      policy: policyTemplatesTable,
      projectId: projectsTable.id,
      projectName: projectsTable.name,
      agOrgId: projectsTable.agOrgId,
      agName: organizationsTable.name,
    })
    .from(dataPublicationRecipientsTable)
    .innerJoin(
      dataPublicationsTable,
      eq(dataPublicationRecipientsTable.publicationId, dataPublicationsTable.id),
    )
    .innerJoin(
      policyTemplatesTable,
      eq(dataPublicationsTable.policyTemplateId, policyTemplatesTable.id),
    )
    .innerJoin(projectsTable, eq(dataPublicationsTable.projectId, projectsTable.id))
    .innerJoin(organizationsTable, eq(projectsTable.agOrgId, organizationsTable.id))
    .where(and(
      eq(dataPublicationRecipientsTable.anOrgId, req.user.orgId),
      eq(dataPublicationRecipientsTable.status, "ACCEPTED"),
      eq(policyTemplatesTable.active, true),
    ));

  const byPolicy = new Map<string, {
    policy: typeof rows[number]["policy"];
    projects: Array<{ id: string; name: string; agOrgId: string; agName: string }>;
  }>();
  for (const row of rows) {
    const current = byPolicy.get(row.policy.id) ?? { policy: row.policy, projects: [] };
    if (!current.projects.some((project) => project.id === row.projectId)) {
      current.projects.push({
        id: row.projectId,
        name: row.projectName,
        agOrgId: row.agOrgId,
        agName: row.agName,
      });
    }
    byPolicy.set(row.policy.id, current);
  }

  res.json([...byPolicy.values()].map(({ policy, projects }) => ({
    ...policy,
    projects,
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
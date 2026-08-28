/**
 * Data Publication routes (Task #112).
 *
 * AG endpoints:
 *   GET  /policy-templates
 *   GET  /projects/:projectId/data-publications
 *   POST /projects/:projectId/data-publications
 *   GET  /data-publications/:publicationId
 *   POST /data-publications/:publicationId/publish
 *   POST /data-publications/:publicationId/suspend
 *   POST /data-publications/:publicationId/withdraw
 *
 * All routes require AG org ownership of the project (requireProjectOwner pattern).
 * Publish/suspend/withdraw require AG_ADMIN or GENERAL_PLANNER.
 */
import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  policyTemplatesTable,
  dataPublicationsTable,
  dataPublicationRecipientsTable,
  projectsTable,
  projectContractorsTable,
  projectMembershipsTable,
  organizationsTable,
  taktRequestsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { buildOdrl } from "../lib/odrl-builder";
import { requireJwt } from "../middlewares/requireJwt";
import { requireRole } from "../middlewares/requireRole";
import { z } from "zod";
import {
  publishDataPublication,
  PublicationNotFoundError,
  PublicationStatusError,
  PublicationRecipientError,
  FIELD_WHITELISTS,
  syncDataPublicationProjection,
} from "../services/data-publication-service";
import {
  getLatestPolicyTemplateRegistryEntry,
  getPublicationPolicyTemplate,
  listPolicyTemplateRegistry,
  listPublicationPolicyTemplates,
} from "../lib/policy-template-registry";

const router = Router();

// ── Ownership helper (mirrors routes/projects.ts pattern) ─────────────────────

async function requireProjectOwner(
  req: Request,
  res: Response,
  projectId: string,
): Promise<{ id: string; agOrgId: string } | null> {
  const caller = req.user!;
  if (caller.orgType !== "AG" || !caller.orgId) {
    res.status(403).json({ error: "Forbidden: only AG organisations may manage data publications" });
    return null;
  }
  const [project] = await db
    .select({ id: projectsTable.id, agOrgId: projectsTable.agOrgId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (project.agOrgId !== caller.orgId) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  return project;
}

// ── GET /ag/data-publications — cross-project overview for the AG ─────────────
router.get(
  "/ag/data-publications",
  requireJwt,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    if (caller.orgType !== "AG" || !caller.orgId) {
      res.status(403).json({ error: "Nur AG-Organisationen können diese Ansicht abrufen" });
      return;
    }
    const agOrgId = caller.orgId;

    // All projects owned by this AG
    const projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.agOrgId, agOrgId));

    if (projects.length === 0) {
      res.json([]);
      return;
    }

    const projectIds = projects.map((p) => p.id);
    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));

    const publications = await db
      .select()
      .from(dataPublicationsTable)
      .where(inArray(dataPublicationsTable.projectId, projectIds as [string, ...string[]]));

    const enriched = await Promise.all(
      publications.map(async (pub) => {
        const recipients = await db
          .select({
            anOrgId: dataPublicationRecipientsTable.anOrgId,
            status: dataPublicationRecipientsTable.status,
            anName: organizationsTable.name,
            notifiedAt: dataPublicationRecipientsTable.notifiedAt,
            policyAcceptedAt: dataPublicationRecipientsTable.policyAcceptedAt,
            policyRejectedAt: dataPublicationRecipientsTable.policyRejectedAt,
            firstAccessedAt: dataPublicationRecipientsTable.firstAccessedAt,
            projectMembershipId: dataPublicationRecipientsTable.projectMembershipId,
          })
          .from(dataPublicationRecipientsTable)
          .innerJoin(
            organizationsTable,
            eq(dataPublicationRecipientsTable.anOrgId, organizationsTable.id),
          )
          .where(eq(dataPublicationRecipientsTable.publicationId, pub.id));

        const [policy] = await db
          .select({ code: policyTemplatesTable.code, name: policyTemplatesTable.name })
          .from(policyTemplatesTable)
          .where(eq(policyTemplatesTable.id, pub.policyTemplateId))
          .limit(1);

        return {
          ...pub,
          projectName: projectMap[pub.projectId] ?? null,
          recipients,
          policyCode: policy?.code ?? null,
          policyName: policy?.name ?? null,
        };
      }),
    );

    // Sort: PUBLISHED first, then DRAFT, then others; within each group newest first
    const ORDER: Record<string, number> = { PUBLISHED: 0, DRAFT: 1, SUSPENDED: 2, WITHDRAWN: 3, EXPIRED: 4 };
    enriched.sort((a, b) => {
      const os = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
      if (os !== 0) return os;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json(enriched);
  },
);

// ── GET /policy-templates ─────────────────────────────────────────────────────
// The selectable publication catalog. Other policy templates may support
// different Dataspace flows and are intentionally not exposed here.
router.get(
  "/policy-templates",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (_req, res): Promise<void> => {
    const publicationCatalog = listPublicationPolicyTemplates();
    const templates = await db
      .select()
      .from(policyTemplatesTable)
      .where(eq(policyTemplatesTable.active, true));
    const byCode = new Map(templates.map((template) => [template.code, template]));

    res.json(publicationCatalog.flatMap((entry) => {
      const template = byCode.get(entry.code);
      if (!template) return [];
      return [{
        ...template,
        templateVersion: entry.version,
        availableTemplateVersions: [entry.version],
        registryTemplateId: entry.templateId,
        ...(entry.allowedPublicationFields
          ? { allowedPublicationFields: [...entry.allowedPublicationFields] }
          : {}),
      }];
    }));
  },
);

// ── GET /policy-templates/registry ────────────────────────────────────────────
// Read-only code-owned registry for future policy creation flows.
router.get(
  "/policy-templates/registry",
  requireJwt,
  async (req, res): Promise<void> => {
    if (!req.user?.orgId || !["AG", "AN"].includes(req.user.orgType ?? "")) {
      res.status(403).json({ error: "Authenticated AG or AN organisation required" });
      return;
    }
    res.json(listPolicyTemplateRegistry());
  },
);

// ── GET /projects/:projectId/data-publications ────────────────────────────────
router.get(
  "/projects/:projectId/data-publications",
  requireJwt,
  async (req, res): Promise<void> => {
    const project = await requireProjectOwner(req, res, req.params.projectId as string);
    if (!project) return;

    const publications = await db
      .select()
      .from(dataPublicationsTable)
      .where(eq(dataPublicationsTable.projectId, project.id));

    // Enrich with recipient summaries
    const enriched = await Promise.all(
      publications.map(async (pub) => {
        const recipients = await db
          .select({
            id: dataPublicationRecipientsTable.id,
            anOrgId: dataPublicationRecipientsTable.anOrgId,
            status: dataPublicationRecipientsTable.status,
            anName: organizationsTable.name,
            notifiedAt: dataPublicationRecipientsTable.notifiedAt,
            policyAcceptedAt: dataPublicationRecipientsTable.policyAcceptedAt,
            policyRejectedAt: dataPublicationRecipientsTable.policyRejectedAt,
            firstAccessedAt: dataPublicationRecipientsTable.firstAccessedAt,
            lastAccessedAt: dataPublicationRecipientsTable.lastAccessedAt,
            revokedAt: dataPublicationRecipientsTable.revokedAt,
            projectMembershipId: dataPublicationRecipientsTable.projectMembershipId,
          })
          .from(dataPublicationRecipientsTable)
          .innerJoin(
            organizationsTable,
            eq(dataPublicationRecipientsTable.anOrgId, organizationsTable.id),
          )
          .where(eq(dataPublicationRecipientsTable.publicationId, pub.id));

        const policy = await db
          .select({ code: policyTemplatesTable.code, name: policyTemplatesTable.name })
          .from(policyTemplatesTable)
          .where(eq(policyTemplatesTable.id, pub.policyTemplateId))
          .limit(1);

        return {
          ...pub,
          recipients,
          policyCode: policy[0]?.code ?? null,
          policyName: policy[0]?.name ?? null,
          policy: policy[0] ?? null,
        };
      }),
    );

    res.json(enriched);
  },
);

// ── POST /projects/:projectId/data-publications ───────────────────────────────
// Creates a DRAFT publication (no snapshot, no notifications yet).
router.post(
  "/projects/:projectId/data-publications",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const project = await requireProjectOwner(req, res, req.params.projectId as string);
    if (!project) return;
    const agOrgId = project.agOrgId;

    const bodySchema = z.object({
      dataProductType: z.enum(["PROJECT_OVERVIEW", "PROJECT_COORDINATION_PACKAGE", "TAKT_INFORMATION_PACKAGE"]),
      title: z.string().min(1).max(255),
      description: z.string().max(2000).optional(),
      policyTemplateId: z.string().min(1),
      selectedFields: z.array(z.string()).min(1),
      selectedTaktIds: z.array(z.string()).optional(),
      recipientAnOrgIds: z.array(z.string()).min(1, "At least one recipient required"),
      validFrom: z.string().datetime({ offset: true }).optional(),
      validUntil: z.string().datetime({ offset: true }).optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const {
      dataProductType,
      title,
      description,
      policyTemplateId,
      selectedFields,
      selectedTaktIds,
      recipientAnOrgIds,
      validFrom,
      validUntil,
    } = parsed.data;

    // Validate fields against both the product whitelist and the selected
    // policy's narrower publication scope.
    const allowedFields = new Set(FIELD_WHITELISTS[dataProductType]);
    const invalidFields = selectedFields.filter((f) => !allowedFields.has(f as never));
    if (invalidFields.length > 0) {
      res.status(400).json({
        error: `Fields not allowed for ${dataProductType}: ${invalidFields.join(", ")}`,
      });
      return;
    }

    // Only policies in the publication catalog may be selected. Resolve the
    // catalog reference to the persisted row used by the publication FK.
    const requestedCatalogPolicy = getPublicationPolicyTemplate(policyTemplateId);
    const activePolicies = await db
      .select({ id: policyTemplatesTable.id, code: policyTemplatesTable.code })
      .from(policyTemplatesTable)
      .where(eq(policyTemplatesTable.active, true));
    const policy = activePolicies.find((candidate) => {
      const catalogPolicy = getPublicationPolicyTemplate(candidate.code);
      return catalogPolicy !== null &&
        (candidate.id === policyTemplateId ||
          catalogPolicy.code === requestedCatalogPolicy?.code);
    });

    if (!policy) {
      res.status(400).json({ error: "Policy template not found, unavailable, or inactive" });
      return;
    }

    const catalogPolicy = getPublicationPolicyTemplate(policy.code);
    const policyAllowedFields = catalogPolicy?.allowedPublicationFields;
    if (policyAllowedFields) {
      const policyFieldSet = new Set(policyAllowedFields);
      const disallowedFields = selectedFields.filter((field) => !policyFieldSet.has(field));
      if (disallowedFields.length > 0) {
        res.status(400).json({
          error: `Die ausgewählte Policy erlaubt diese Datenfelder nicht: ${disallowedFields.join(", ")}`,
        });
        return;
      }
    }

    // Only ACTIVE bilateral project members may receive a publication.
    const activeContractors = await db
      .select({ anOrgId: projectMembershipsTable.anOrgId })
      .from(projectMembershipsTable)
      .where(
        and(
          eq(projectMembershipsTable.projectId, project.id),
          eq(projectMembershipsTable.status, "ACTIVE"),
        ),
      );

    const validAnOrgIds = new Set(activeContractors.map((c) => c.anOrgId));
    const invalidRecipients = recipientAnOrgIds.filter((id) => !validAnOrgIds.has(id));
    if (invalidRecipients.length > 0) {
      res.status(400).json({
        error: `Recipients not found as active contractors for this project: ${invalidRecipients.join(", ")}`,
      });
      return;
    }

    // Determine next version number for this (project, dataProductType) combination
    const existing = await db
      .select({ version: dataPublicationsTable.version })
      .from(dataPublicationsTable)
      .where(
        and(
          eq(dataPublicationsTable.projectId, project.id),
          eq(dataPublicationsTable.dataProductType, dataProductType),
        ),
      );
    const nextVersion =
      existing.length > 0
        ? Math.max(...existing.map((p) => p.version)) + 1
        : 1;

    // Create DRAFT publication
    const [pub] = await db
      .insert(dataPublicationsTable)
      .values({
        agOrgId,
        projectId: project.id,
        dataProductType,
        title,
        description,
        version: nextVersion,
        // Persist the resolved FK, not a registry alias such as
        // "tk-policy-schedule-coordination".
        policyTemplateId: policy.id,
        selectedFields,
        selectedTaktIds: selectedTaktIds ?? null,
        validFrom: validFrom ? new Date(validFrom) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
      })
      .returning();

    // Create recipient rows (OFFERED)
    if (recipientAnOrgIds.length > 0) {
      await db.insert(dataPublicationRecipientsTable).values(
        recipientAnOrgIds.map((anOrgId) => ({
          publicationId: pub.id,
          anOrgId,
        })),
      );
    }

    res.status(201).json({ ...pub, recipientCount: recipientAnOrgIds.length });
  },
);

// ── GET /data-publications/:publicationId ─────────────────────────────────────
router.get(
  "/data-publications/:publicationId",
  requireJwt,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const publicationId = req.params.publicationId as string;

    const [pub] = await db
      .select()
      .from(dataPublicationsTable)
      .where(eq(dataPublicationsTable.id, publicationId))
      .limit(1);

    if (!pub) {
      res.status(404).json({ error: "DataPublication not found" });
      return;
    }

    // Only the owning AG org may see DRAFT publications
    if (pub.agOrgId !== caller.orgId) {
      res.status(404).json({ error: "DataPublication not found" });
      return;
    }

    const recipients = await db
      .select({
        id: dataPublicationRecipientsTable.id,
        anOrgId: dataPublicationRecipientsTable.anOrgId,
        status: dataPublicationRecipientsTable.status,
        notifiedAt: dataPublicationRecipientsTable.notifiedAt,
        policyAcceptedAt: dataPublicationRecipientsTable.policyAcceptedAt,
        policyRejectedAt: dataPublicationRecipientsTable.policyRejectedAt,
        firstAccessedAt: dataPublicationRecipientsTable.firstAccessedAt,
        lastAccessedAt: dataPublicationRecipientsTable.lastAccessedAt,
            projectMembershipId: dataPublicationRecipientsTable.projectMembershipId,
        anName: organizationsTable.name,
      })
      .from(dataPublicationRecipientsTable)
      .innerJoin(
        organizationsTable,
        eq(dataPublicationRecipientsTable.anOrgId, organizationsTable.id),
      )
      .where(eq(dataPublicationRecipientsTable.publicationId, publicationId));

    const [policy] = await db
      .select()
      .from(policyTemplatesTable)
      .where(eq(policyTemplatesTable.id, pub.policyTemplateId))
      .limit(1);

    res.json({ ...pub, recipients, policy });
  },
);

// ── POST /data-publications/:publicationId/publish ────────────────────────────
router.post(
  "/data-publications/:publicationId/publish",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const publicationId = req.params.publicationId as string;

    try {
      await publishDataPublication(
        publicationId,
        caller.userId!,
        caller.orgId!,
      );
      res.json({ ok: true, status: "PUBLISHED" });
    } catch (err) {
      if (err instanceof PublicationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PublicationStatusError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PublicationRecipientError) {
        res.status(422).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// ── POST /data-publications/:publicationId/suspend ────────────────────────────
router.post(
  "/data-publications/:publicationId/suspend",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const publicationId = req.params.publicationId as string;

    const [pub] = await db
      .select({ id: dataPublicationsTable.id, agOrgId: dataPublicationsTable.agOrgId, status: dataPublicationsTable.status })
      .from(dataPublicationsTable)
      .where(eq(dataPublicationsTable.id, publicationId))
      .limit(1);

    if (!pub || pub.agOrgId !== caller.orgId) {
      res.status(404).json({ error: "DataPublication not found" });
      return;
    }
    if (pub.status !== "PUBLISHED") {
      res.status(409).json({ error: `Cannot suspend a publication with status "${pub.status}". Only PUBLISHED may be suspended.` });
      return;
    }

    await db
      .update(dataPublicationsTable)
      .set({ status: "SUSPENDED" })
      .where(eq(dataPublicationsTable.id, publicationId));
    await syncDataPublicationProjection(publicationId, caller.orgId!, "SUSPENDED");

    res.json({ ok: true, status: "SUSPENDED" });
  },
);

// ── GET /data-publications/:publicationId/odrl ────────────────────────────────
// Accessible by the owning AG org or any AN recipient of the publication.
router.get(
  "/data-publications/:publicationId/odrl",
  requireJwt,
  async (req, res): Promise<void> => {
    const publicationId = req.params.publicationId as string;
    const caller = req.user!;

    // Load publication + policy template + project AG org ID
    const [row] = await db
      .select({
        pub: dataPublicationsTable,
        policy: policyTemplatesTable,
        agOrgId: projectsTable.agOrgId,
      })
      .from(dataPublicationsTable)
      .leftJoin(
        policyTemplatesTable,
        eq(dataPublicationsTable.policyTemplateId, policyTemplatesTable.id),
      )
      .leftJoin(
        projectsTable,
        eq(dataPublicationsTable.projectId, projectsTable.id),
      )
      .where(eq(dataPublicationsTable.id, publicationId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Publication not found" });
      return;
    }

    // Access control
    if (caller.orgType === "AG") {
      if (row.agOrgId !== caller.orgId) {
        res.status(404).json({ error: "Publication not found" });
        return;
      }
    } else if (caller.orgType === "AN") {
      const [recipient] = await db
        .select({ id: dataPublicationRecipientsTable.id })
        .from(dataPublicationRecipientsTable)
        .where(
          and(
            eq(dataPublicationRecipientsTable.publicationId, publicationId),
            eq(dataPublicationRecipientsTable.anOrgId, caller.orgId!),
          ),
        )
        .limit(1);
      if (!recipient) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } else {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { pub, policy, agOrgId } = row;
    const nuOrgId = caller.orgType === "AN" ? caller.orgId : null;

    const odrl = buildOdrl({
      publicationId: pub.id,
      policyCode:    policy?.code ?? undefined,
      agOrgId:       agOrgId ?? "unknown",
      nuOrgId,
      validFrom:     pub.validFrom,
      validUntil:    pub.validUntil,
    });

    res.json(odrl);
  },
);

// ── POST /data-publications/:publicationId/withdraw ───────────────────────────
router.post(
  "/data-publications/:publicationId/withdraw",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const publicationId = req.params.publicationId as string;

    const [pub] = await db
      .select({ id: dataPublicationsTable.id, agOrgId: dataPublicationsTable.agOrgId, status: dataPublicationsTable.status })
      .from(dataPublicationsTable)
      .where(eq(dataPublicationsTable.id, publicationId))
      .limit(1);

    if (!pub || pub.agOrgId !== caller.orgId) {
      res.status(404).json({ error: "DataPublication not found" });
      return;
    }
    if (!["PUBLISHED", "SUSPENDED"].includes(pub.status)) {
      res.status(409).json({ error: `Cannot withdraw a publication with status "${pub.status}". Only PUBLISHED or SUSPENDED may be withdrawn.` });
      return;
    }

    await db
      .update(dataPublicationsTable)
      .set({ status: "WITHDRAWN", withdrawnAt: new Date() })
      .where(eq(dataPublicationsTable.id, publicationId));
    await syncDataPublicationProjection(publicationId, caller.orgId!, "WITHDRAWN");

    res.json({ ok: true, status: "WITHDRAWN" });
  },
);

// ── DELETE /data-publications/:publicationId ──────────────────────────────────
// Permanently removes a WITHDRAWN publication and all related recipient rows.
// takt_requests referencing this publication have their FK nulled first (no cascade).
router.delete(
  "/data-publications/:publicationId",
  requireJwt,
  requireRole("AG_ADMIN", "GENERAL_PLANNER"),
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const publicationId = req.params.publicationId as string;

    const [pub] = await db
      .select({ id: dataPublicationsTable.id, agOrgId: dataPublicationsTable.agOrgId, status: dataPublicationsTable.status })
      .from(dataPublicationsTable)
      .where(eq(dataPublicationsTable.id, publicationId))
      .limit(1);

    if (!pub || pub.agOrgId !== caller.orgId) {
      res.status(404).json({ error: "DataPublication not found" });
      return;
    }
    if (pub.status !== "WITHDRAWN") {
      res.status(409).json({ error: `Only WITHDRAWN publications can be deleted (current status: "${pub.status}").` });
      return;
    }

    await db.transaction(async (tx) => {
      // Null out FK in takt_requests (no ON DELETE CASCADE on that FK)
      await tx
        .update(taktRequestsTable)
        .set({ dataPublicationId: null } as any)
        .where(eq(taktRequestsTable.dataPublicationId as any, publicationId));

      // Delete publication — CASCADE removes data_publication_recipients rows
      await tx
        .delete(dataPublicationsTable)
        .where(eq(dataPublicationsTable.id, publicationId));
    });

    res.json({ ok: true });
  },
);

export default router;

/**
 * Canonical policy template seed.
 *
 * Called once at server startup (index.ts).  Uses INSERT … ON CONFLICT (code)
 * DO UPDATE so it is safe to run on every deploy and keeps template content
 * current without manual psql scripts.
 */

import { db } from "@workspace/db";
import { policyTemplatesTable } from "@workspace/db";
import { logger } from "./logger";
import {
  listPolicyTemplateRegistry,
  listPublicationPolicyTemplates,
} from "./policy-template-registry";

interface PolicySeed {
  id?: string;
  code: string;
  name: string;
  description: string;
  purpose: string;
  permissions: string[];
  prohibitions: string[];
  validityRule: string;
  retentionRule: string | null;
  active: boolean;
}

const CANONICAL_POLICIES: PolicySeed[] = [
  ...listPublicationPolicyTemplates(),
  ...listPolicyTemplateRegistry({ latestOnly: true }).filter(
    (template) => template.code === "PROJECT_MEMBERSHIP",
  ),
].map((template) => ({
    id: template.templateId,
    code: template.code,
    name: template.name,
    description: template.description,
    purpose: template.purpose,
    permissions: [...template.permissions],
    prohibitions: [...template.prohibitions],
    validityRule: template.validityRule,
    retentionRule: template.retentionRule,
    active: true,
  }));

/**
 * Upserts all canonical policy templates on every startup.
 * Safe to call repeatedly — uses ON CONFLICT (code) DO UPDATE.
 */
export async function seedPolicyTemplates(): Promise<void> {
  for (const policy of CANONICAL_POLICIES) {
    await db
      .insert(policyTemplatesTable)
      .values(policy)
      .onConflictDoUpdate({
        target: policyTemplatesTable.code,
        set: {
          name:         policy.name,
          description:  policy.description,
          purpose:      policy.purpose,
          permissions:  policy.permissions,
          prohibitions: policy.prohibitions,
          validityRule: policy.validityRule,
          retentionRule: policy.retentionRule,
          active:       policy.active,
        },
      });
  }
  logger.info(
    { count: CANONICAL_POLICIES.length },
    "Policy templates seeded / verified",
  );
}

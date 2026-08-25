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

interface PolicySeed {
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
  // ── Einzige aktuell angebotene Richtlinie ──────────────────────────────────
  {
    code: "SCHEDULE_COORDINATION",
    name: "Project Coordination Subcontractor",
    description:
      "Richtlinie für Nachunternehmen zur sicheren projektbezogenen Koordination von " +
      "Terminen, Aktivitätsplanung und Ressourcen.",
    purpose:
      "Projektkoordination zwischen Auftraggeber und Nachunternehmen auf Grundlage " +
      "der für das konkrete Projekt freigegebenen Informationen.",
    permissions: [
      "Projekt- und Aktivitätsinformationen lesen",
      "Angefragte Termine und Aktivitäten abstimmen",
      "Interne Termin-, Ressourcen- und Kapazitätsplanung",
      "Mögliche Alternativtermine ermitteln",
    ],
    prohibitions: [
      "Weitergabe an Dritte oder andere Projekte",
      "Kommerzielle Nutzung außerhalb der Projektkoordination",
      "Veränderung oder Verfälschung der Originaldaten",
      "Marketing, Benchmarking oder KI-/ML-Training",
    ],
    validityRule:
      "Gilt ausschließlich für das konkrete Projekt und die angefragten Leistungen. " +
      "Nutzung nur intern beim Nachunternehmen und nur durch berechtigte Mitarbeitende.",
    retentionRule:
      "Nur so lange speichern, wie die Daten für die Projektkoordination erforderlich sind; " +
      "nicht mehr benötigte Daten und Kopien unverzüglich löschen.",
    active: true,
  },
];

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

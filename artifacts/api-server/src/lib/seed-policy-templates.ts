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
  // Deactivated — kept for ON CONFLICT upsert so existing DB rows are updated
  {
    code: "COORDINATION_USE",
    name: "Koordinationsnutzung",
    description:
      "Standardrichtlinie für die projektbezogene Weitergabe von Takt- und " +
      "Koordinationsdaten an Nachunternehmer.",
    purpose:
      "Nutzung der bereitgestellten Takt- und Koordinationsdaten ausschließlich " +
      "zur Baustellenkoordination und Ressourcenplanung innerhalb des jeweiligen Projekts.",
    permissions: ["Lesen", "Projektinterne Weitergabe", "Ressourcenplanung", "Terminplanung"],
    prohibitions: [
      "Kommerzielle Nutzung",
      "Weitergabe an Dritte außerhalb des Projekts",
      "Veränderung der Originaldaten",
      "Speicherung über Projektende hinaus",
    ],
    validityRule:
      "Gültig für die gesamte Laufzeit des Projekts, endet automatisch mit Projektabschluss.",
    retentionRule: "Daten sind spätestens 30 Tage nach Projektabschluss zu löschen.",
    active: false,
  },
  {
    code: "READ_ONLY",
    name: "Lesezugriff (eingeschränkt)",
    description:
      "Minimale Richtlinie für den reinen Lesezugriff ohne Weitergabemöglichkeit.",
    purpose: "Reine Einsichtnahme zur Vorbereitung von Abstimmungsgesprächen.",
    permissions: ["Lesen"],
    prohibitions: ["Weitergabe jeglicher Art", "Kommerzielle Nutzung", "Speicherung"],
    validityRule: "Gültig für 30 Tage ab Bereitstellung.",
    retentionRule: "Keine Speicherung gestattet.",
    active: false,
  },
  {
    code: "SUBCONTRACTOR_FULL",
    name: "Nachunternehmerpaket (vollständig)",
    description:
      "Erweiterte Richtlinie für Nachunternehmer mit umfangreichen Planungsaufgaben.",
    purpose:
      "Umfassende Nutzung der Takt- und Projektdaten zur Koordination und Dokumentation.",
    permissions: ["Lesen", "Ressourcenplanung", "Terminplanung", "Interne Dokumentation"],
    prohibitions: ["Kommerzielle Nutzung", "Weitergabe an Dritte außerhalb des Projekts"],
    validityRule: "Gültig für die Vertragslaufzeit des Nachunternehmers.",
    retentionRule:
      "Daten sind innerhalb von 60 Tagen nach Vertragsende oder Projektabschluss zu löschen.",
    active: false,
  },
  // ── Aktive Richtlinie ──────────────────────────────────────────────────────
  {
    code: "SCHEDULE_COORDINATION",
    name: "Project Coordination Subcontractor",
    description:
      "Richtlinie für Nachunternehmen zur sicheren projektbezogenen Koordination von " +
      "Terminen, Taktplanung und Ressourcen.",
    purpose:
      "Projektkoordination zwischen Auftraggeber und Nachunternehmen auf Grundlage " +
      "der für das konkrete Projekt freigegebenen Informationen.",
    permissions: [
      "Projekt- und Taktinformationen lesen",
      "Angefragte Termine und Takte abstimmen",
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

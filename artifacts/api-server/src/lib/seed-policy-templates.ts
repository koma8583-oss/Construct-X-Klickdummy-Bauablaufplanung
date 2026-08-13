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
  {
    code: "COORDINATION_USE",
    name: "Koordinationsnutzung",
    description:
      "Standardrichtlinie für die projektbezogene Weitergabe von Takt- und " +
      "Koordinationsdaten an Nachunternehmer.",
    purpose:
      "Nutzung der bereitgestellten Takt- und Koordinationsdaten ausschließlich " +
      "zur Baustellenkoordination und Ressourcenplanung innerhalb des jeweiligen Projekts.",
    permissions: [
      "Lesen",
      "Projektinterne Weitergabe",
      "Ressourcenplanung",
      "Terminplanung",
    ],
    prohibitions: [
      "Kommerzielle Nutzung",
      "Weitergabe an Dritte außerhalb des Projekts",
      "Veränderung der Originaldaten",
      "Speicherung über Projektende hinaus",
    ],
    validityRule:
      "Gültig für die gesamte Laufzeit des Projekts, endet automatisch mit Projektabschluss.",
    retentionRule:
      "Daten sind spätestens 30 Tage nach Projektabschluss zu löschen.",
    active: true,
  },
  {
    code: "READ_ONLY",
    name: "Lesezugriff (eingeschränkt)",
    description:
      "Minimale Richtlinie für den reinen Lesezugriff ohne Weitergabemöglichkeit. " +
      "Geeignet für Statusabfragen und Abstimmungsgespräche.",
    purpose:
      "Reine Einsichtnahme in bereitgestellte Projektdaten zur Vorbereitung von " +
      "Abstimmungsgesprächen und Statusüberprüfungen.",
    permissions: ["Lesen"],
    prohibitions: [
      "Weitergabe jeglicher Art",
      "Kommerzielle Nutzung",
      "Speicherung",
      "Veränderung der Daten",
      "Druckausgabe ohne Genehmigung",
    ],
    validityRule:
      "Gültig für 30 Tage ab Bereitstellung, danach automatischer Zugriffsentzug.",
    retentionRule: "Keine Speicherung gestattet.",
    active: true,
  },
  {
    code: "SUBCONTRACTOR_FULL",
    name: "Nachunternehmerpaket (vollständig)",
    description:
      "Erweiterte Richtlinie für Nachunternehmer mit umfangreichen Planungsaufgaben — " +
      "erlaubt interne Dokumentation und Ressourcenplanung.",
    purpose:
      "Umfassende Nutzung der Takt- und Projektdaten zur Koordination, internen " +
      "Ressourcenplanung und baubezogenen Dokumentation im Rahmen des Vertragsverhältnisses.",
    permissions: [
      "Lesen",
      "Projektinterne Weitergabe",
      "Ressourcenplanung",
      "Terminplanung",
      "Interne Dokumentation",
      "Druckausgabe für Baustelleneinsatz",
    ],
    prohibitions: [
      "Kommerzielle Nutzung",
      "Weitergabe an Dritte außerhalb des Projekts",
      "Veränderung der Originaldaten ohne Kennzeichnung",
    ],
    validityRule:
      "Gültig für die Vertragslaufzeit des Nachunternehmers, längstens bis zum Projektabschluss.",
    retentionRule:
      "Daten sind innerhalb von 60 Tagen nach Vertragsende oder Projektabschluss " +
      "(je nachdem, was früher eintritt) zu löschen.",
    active: true,
  },
  {
    code: "SCHEDULE_COORDINATION",
    name: "Abstimmung von Rahmenterminen",
    description:
      "Die interne Ressourcenplanung des NU verbleibt beim NU. " +
      "An den GU werden nur die für die Terminabstimmung notwendigen Ergebnisse übermittelt.",
    purpose:
      "Nutzung zur Abstimmung der angefragten Rahmentermine zwischen Auftraggeber und Nachunternehmen.",
    permissions: [
      "Nutzung zur Abstimmung der angefragten Rahmentermine",
      "Interne Termin-, Ressourcen- und Kapazitätsplanung",
      "Ermittlung möglicher Alternativtermine",
    ],
    prohibitions: [
      "Weitergabe an Dritte",
      "Nutzung für andere Projekte",
      "Marketing oder Benchmarking",
      "KI- oder ML-Training",
    ],
    validityRule:
      "Nur für das konkrete Projekt und die angefragten Leistungen. " +
      "Ausschließlich interne Nutzung beim NU. Vertrauliche Behandlung. " +
      "Nur erforderliche Daten speichern; nicht mehr benötigte Daten löschen.",
    retentionRule: "Nicht mehr benötigte Daten umgehend löschen.",
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

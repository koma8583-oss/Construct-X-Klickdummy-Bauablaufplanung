// ── Canonical Leistung schema (Task #196) ────────────────────────────────────
export * from "./leistungen";
export * from "./leistungsanfragen";
export * from "./service-change-proposals";
export * from "./leistungsanfrage-audit-events";
export * from "./leistungsanfrage-reminders";
export * from "./leistungsanfrage-resource-requirements";
export * from "./leistungsantworten";
export * from "./leistungsantwort-entscheidungen";
export * from "./leistungsabhaengigkeiten";
export * from "./leistungs-versionen";

// ── Legacy adapter tables (Task #196) — deprecated, use canonical names above ─
// Provides old TS property names (taktId, taktBezeichnung, taktRequestId, …)
// mapped to the renamed physical columns for backward compat during migration.
export * from "./legacy-takt-adapters";

// ── Other domain tables (unchanged) ──────────────────────────────────────────
export * from "./availability-checks";
export * from "./project-calendars";
export * from "./data-publications";
export * from "./delegations";
export * from "./hub";
export * from "./messages";
export * from "./dataspace-exchanges";
export * from "./organizations";
export * from "./projects";
export * from "./refreshTokens";
export * from "./resources";
export * from "./resource-bookings";
export * from "./users";
export * from "./webhooks";

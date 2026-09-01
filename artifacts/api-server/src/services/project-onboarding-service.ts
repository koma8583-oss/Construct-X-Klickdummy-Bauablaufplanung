import { ProjectMembershipError } from "./project-membership-service";

/**
 * The former combined onboarding operation was able to create a project
 * invitation and publish data in one transaction. That violates the explicit
 * membership-then-publication boundary and must not remain callable.
 *
 * Keep the symbol temporarily for callers that still import the legacy
 * module, but fail explicitly instead of reviving the combined semantics.
 */
export function inviteParticipantsWithData(_input: unknown): never {
  throw new ProjectMembershipError(
    "COMBINED_INVITATION_DISABLED",
    "Kombinierte Projekteinladungen mit Datenfreigabe sind deaktiviert. Einladung und Datenangebot müssen getrennt ausgeführt werden.",
  );
}
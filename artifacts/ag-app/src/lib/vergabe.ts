import type {
  DataPublication,
  ProjectMembership,
  ProjectSubcontractorAssignment,
} from '@workspace/api-client-react';

type Participant = {
  id: string;
  name?: string | null;
};

export type VergabePartner = {
  anOrgId: string;
  label: string;
};

/**
 * A publication version is unique per project and product type. Keep the
 * most useful row when older data contains the same version more than once
 * (for example, an orphaned row without recipient records).
 */
export function deduplicateDataPublications<T extends DataPublication>(
  publications: T[],
): T[] {
  const byVersion = new Map<string, T>();

  const score = (publication: T) => {
    const recipientCount = publication.recipients?.length ?? 0;
    const statusScore = publication.status === 'PUBLISHED' ? 10 : 0;
    const createdAtScore = Date.parse(publication.createdAt) || 0;
    return recipientCount * 100 + statusScore + createdAtScore / 1_000_000_000_000;
  };

  for (const publication of publications) {
    const key = `${publication.projectId}:${publication.dataProductType}:${publication.version}`;
    const current = byVersion.get(key);
    if (!current || score(publication) > score(current)) {
      byVersion.set(key, publication);
    }
  }

  return [...byVersion.values()];
}

/**
 * Builds the AN choices shown in the "Leistung vergeben" form.
 *
 * Assignments normally contain anName, but older/local projection rows may
 * omit it. In that case use the participant directory before falling back to
 * the stable organisation id.
 */
export function buildAssignablePartners(
  assignments: ProjectSubcontractorAssignment[] | undefined,
  memberships: ProjectMembership[] | undefined,
  participants: Participant[] | undefined,
): VergabePartner[] {
  const partners: VergabePartner[] = [];
  const seenOrgIds = new Set<string>();
  const participantNameByOrgId = new Map(
    (participants ?? [])
      .filter((participant) => participant.name?.trim())
      .map((participant) => [participant.id, participant.name!.trim()]),
  );

  const addPartner = (
    anOrgId: string,
    name: string | null | undefined,
    trade?: string | null,
  ) => {
    if (seenOrgIds.has(anOrgId)) return;
    seenOrgIds.add(anOrgId);
    const displayName = name?.trim() || participantNameByOrgId.get(anOrgId) || anOrgId;
    partners.push({
      anOrgId,
      label: `${displayName} – ${trade?.trim() || 'Alle Gewerke'}`,
    });
  };

  for (const assignment of assignments ?? []) {
    if (assignment.assignmentStatus !== 'ACTIVE') continue;
    addPartner(assignment.anOrgId, assignment.anName, assignment.trade);
  }

  for (const membership of memberships ?? []) {
    if (membership.status !== 'ACTIVE') continue;
    addPartner(membership.anOrgId, participantNameByOrgId.get(membership.anOrgId));
  }

  return partners;
}

/**
 * Returns only publications that can actually authorize the selected
 * TaktRequest. A published package without recipients is not an offer for the
 * selected AN and must not be presented as a valid choice.
 *
 * An empty/null selectedTaktIds value denotes a project-wide package. A
 * non-empty list must explicitly contain the selected Takt.
 */
export function getEligibleVergabePublications(
  publications: DataPublication[] | undefined,
  selectedTaktId: string | undefined,
  recipientOrgIds: string[],
): DataPublication[] {
  if (!selectedTaktId || recipientOrgIds.length === 0) return [];

  const requiredRecipientIds = [...new Set(recipientOrgIds)];
  const eligible = (publications ?? []).filter((publication) => {
    if (
      publication.dataProductType !== 'TAKT_INFORMATION_PACKAGE' ||
      publication.status !== 'PUBLISHED'
    ) {
      return false;
    }

    const selectedTaktIds = publication.selectedTaktIds ?? [];
    const appliesToTakt =
      selectedTaktIds.length === 0 || selectedTaktIds.includes(selectedTaktId);
    if (!appliesToTakt) return false;

    const recipients = publication.recipients ?? [];
    if (recipients.length === 0) return false;
    return requiredRecipientIds.every((orgId) =>
      recipients.some((recipient) => recipient.anOrgId === orgId),
    );
  });

  return deduplicateDataPublications(eligible);
}
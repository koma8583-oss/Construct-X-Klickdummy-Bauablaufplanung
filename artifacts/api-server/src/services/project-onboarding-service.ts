import {
  agDb,
  dataPublicationRecipientsTable,
  dataPublicationsTable,
  messageOutboxTable,
  policyTemplatesTable,
  projectMembershipsTable,
  projectsTable,
} from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { FIELD_WHITELISTS, buildContentSnapshot, computeContentHash } from "./data-publication-service";
import { resolveDataspaceParticipant } from "./dataspace/dataspace-participant-resolver";
import { createDataspaceExchange } from "./dataspace/dataspace-exchange-factory";
import { deliverLocalProjectInvitation } from "./dataspace/local-dataspace-delivery";
import type { ExternalProjectInvitation } from "./dataspace/external-contracts";
import { ProjectMembershipError } from "./project-membership-service";
import { createPolicySnapshot } from "./policy-snapshot-service";
import { toDataOfferPolicy, toInvitationPolicy } from "./policy-contract-adapters";
import { getPolicyTemplateRegistryEntry } from "../lib/policy-template-registry";

type CombinedInvitationInput = {
  projectId: string;
  agOrgId: string;
  participantIds: string[];
  invitationMessage?: string;
  validUntil?: Date;
  policyTemplateId: string;
  policyTemplateVersion?: number;
  title: string;
  description?: string;
  selectedFields: string[];
  validFrom?: Date;
};

export async function inviteParticipantsWithData(input: CombinedInvitationInput) {
  const [project] = await agDb.select().from(projectsTable)
    .where(and(eq(projectsTable.id, input.projectId), eq(projectsTable.agOrgId, input.agOrgId)))
    .limit(1);
  if (!project) throw new ProjectMembershipError("PROJECT_NOT_FOUND", "Projekt nicht gefunden.");

  const [policy] = await agDb.select().from(policyTemplatesTable)
    .where(and(
      or(
        eq(policyTemplatesTable.id, input.policyTemplateId),
        eq(policyTemplatesTable.code, input.policyTemplateId),
      ),
      eq(policyTemplatesTable.active, true),
    ))
    .limit(1);
  if (!policy) throw new ProjectMembershipError("POLICY_NOT_AVAILABLE", "Die ausgewählte Policy ist nicht verfügbar.");

  if (policy.code !== "PROJECT_MEMBERSHIP") {
    throw new ProjectMembershipError(
      "PROJECT_INVITATION_POLICY_NOT_ALLOWED",
      "Für eine Projekteinladung darf ausschließlich die Policy Projektaufnahme verwendet werden.",
    );
  }
  const registryPolicy = getPolicyTemplateRegistryEntry(policy.code, input.policyTemplateVersion);
  const allowedFields = new Set(
    registryPolicy?.allowedPublicationFields ?? FIELD_WHITELISTS.PROJECT_MEMBERSHIP,
  );
  const requestedFields = [...new Set(input.selectedFields)].sort();
  const fixedFields = [...allowedFields].sort();
  if (JSON.stringify(requestedFields) !== JSON.stringify(fixedFields)) {
    throw new ProjectMembershipError(
      "DATA_FIELDS_INVALID",
      `Eine Projektaufnahme enthält ausschließlich die festen Projektbasisdaten: ${fixedFields.join(", ")}`,
    );
  }

  const uniqueParticipantIds = [...new Set(input.participantIds)];
  const participants = await Promise.all(uniqueParticipantIds.map((id) => resolveDataspaceParticipant(id)));
  if (participants.some((participant) => !participant || participant.organizationType !== "AN" || participant.identityStatus !== "PREPARED")) {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_NOT_PREPARED", "Mindestens ein ausgewählter Teilnehmer ist nicht als lokale Identität vorbereitet.");
  }
  const resolved = participants as Array<NonNullable<typeof participants[number]>>;
  if (resolved.some((participant) => !participant.localOrgId || participant.localOrgId === input.agOrgId)) {
    throw new ProjectMembershipError("PROJECT_PARTICIPANT_INVALID", "Die Teilnehmerauswahl ist ungültig.");
  }

  const anOrgIds = resolved.map((participant) => participant.localOrgId!);
  const existingMemberships = await agDb.select({
    anOrgId: projectMembershipsTable.anOrgId,
    status: projectMembershipsTable.status,
  }).from(projectMembershipsTable).where(eq(projectMembershipsTable.projectId, input.projectId));
  const blocked = existingMemberships.filter((membership) => anOrgIds.includes(membership.anOrgId));
  if (blocked.length) {
    throw new ProjectMembershipError(
      "PROJECT_INVITATION_ALREADY_EXISTS",
      "Mindestens ein ausgewählter Nachunternehmer hat bereits eine Projektbeziehung.",
    );
  }

  // The immutable snapshot is assembled before the write transaction. Only its
  // whitelist-filtered result is persisted; it is never embedded in the invite.
  const snapshot = await buildContentSnapshot(
    "PROJECT_MEMBERSHIP",
    input.projectId,
    input.selectedFields,
    [],
  );
  const contentHash = computeContentHash(snapshot);
  const now = new Date();
  const publicationId = crypto.randomUUID();

  const prepared = await agDb.transaction(async (tx) => {
    const [publication] = await tx.insert(dataPublicationsTable).values({
      id: publicationId,
      agOrgId: input.agOrgId,
      projectId: input.projectId,
       dataProductType: "PROJECT_MEMBERSHIP",
      title: input.title,
       description: null,
      version: 1,
      policyTemplateId: policy.id,
       selectedFields: fixedFields,
      selectedTaktIds: [],
      contentSnapshot: snapshot,
      contentHash,
      status: "PUBLISHED",
      validFrom: input.validFrom ?? now,
      validUntil: input.validUntil ?? null,
      publishedByUserId: null,
      publishedAt: now,
    }).returning();

    const rows: Array<{ membership: typeof projectMembershipsTable.$inferSelect; payload: ExternalProjectInvitation }> = [];
    for (const participant of resolved) {
      const anOrgId = participant.localOrgId!;
      const invitationId = crypto.randomUUID();
      const correlationId = `project-membership:${input.projectId}:${anOrgId}:${invitationId}`;
      const messageId = `project-invitation-${invitationId}`;
      const policySnapshot = createPolicySnapshot({
        templateId: policy.code,
        templateVersion: input.policyTemplateVersion,
        providerContext: { organizationId: input.agOrgId, organizationType: "AG" },
        overrides: {
          recipientOrganizationId: anOrgId,
          purpose: "PROJECT_COLLABORATION",
          projectReference: project.id,
          ...(input.validFrom ? { validFrom: input.validFrom.toISOString() } : {}),
          ...(input.validUntil ? { validUntil: input.validUntil.toISOString() } : {}),
        },
      });
      const [membership] = await tx.insert(projectMembershipsTable).values({
        projectId: input.projectId,
        agOrgId: input.agOrgId,
        anOrgId,
        anParticipantId: participant.participantId,
        status: "INVITED",
        invitationId,
        correlationId,
        invitationMessage: input.invitationMessage ?? null,
        invitationExpiresAt: input.validUntil ?? null,
        invitedAt: now,
      }).returning();
      await tx.insert(dataPublicationRecipientsTable).values({
        publicationId: publication.id,
        anOrgId,
        projectMembershipId: membership.id,
        status: "OFFERED",
      });
      const payload: ExternalProjectInvitation = {
        metadata: {
          messageId,
          correlationId,
          schemaVersion: "1.0",
          senderOrgId: input.agOrgId,
          receiverOrgId: anOrgId,
          createdAt: now.toISOString(),
        },
        invitationId,
        project: {
          projectReference: project.id,
          projectName: project.name,
          ...(project.location ? { location: project.location } : {}),
        },
        requestedRole: "CONTRACTOR",
       purpose: "PROJECT_COLLABORATION",
        ...(input.invitationMessage ? { invitationMessage: input.invitationMessage } : {}),
        ...(input.validUntil ? { validUntil: input.validUntil.toISOString() } : {}),
        policy: {
          ...toInvitationPolicy(policySnapshot, participant.participantId),
        },
        policySnapshot,
        dataOffer: {
          publicationId: publication.id,
          title: publication.title,
           dataProductType: "PROJECT_MEMBERSHIP",
           selectedFields: fixedFields,
          policy: {
            ...toDataOfferPolicy(policySnapshot, policy),
          },
        },
      };
      await tx.insert(messageOutboxTable).values({
        messageId,
        schemaVersion: "1.0",
        messageType: "PROJECT_INVITATION",
        senderOrgId: input.agOrgId,
        recipientOrgId: anOrgId,
        correlationId,
        payload: payload as unknown as Record<string, unknown>,
        status: "PENDING",
      });
      rows.push({ membership, payload });
    }
    return { publication, rows };
  });

  // Delivery is deliberately after commit. Failed delivery leaves the durable
  // invitation and its original outbox envelope available for retry.
  const exchange = createDataspaceExchange();
  await Promise.all(prepared.rows.map(async ({ payload }) => {
    const delivery = await deliverLocalProjectInvitation(payload, exchange);
    if (delivery.status === "PENDING" || delivery.status === "FAILED") {
      const retry = await exchange.retryProjectInvitation(payload.metadata.messageId);
      if (retry.status === "DELIVERED") {
        await deliverLocalProjectInvitation(payload, exchange);
      }
    }
  }));

  return {
    publication: prepared.publication,
    memberships: prepared.rows.map(({ membership }) => membership),
  };
}
/**
 * Typed React Query hooks for the AG-facing data-publication endpoints (Task #112).
 *
 *   useGetPolicyTemplates()
 *   useGetProjectDataPublications(projectId)
 *   useGetDataPublication(publicationId)
 *   useCreateDataPublication()
 *   usePublishDataPublication()
 *   useSuspendDataPublication()
 *   useWithdrawDataPublication()
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Shared types ───────────────────────────────────────────────────────────────

export type DataProductType = "TAKT_INFORMATION_PACKAGE";

export type PublicationStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "SUSPENDED"
  | "WITHDRAWN"
  | "EXPIRED";

export type PublicationRecipientStatus =
  | "OFFERED"
  | "ACCEPTED"
  | "REJECTED"
  | "REVOKED"
  | "EXPIRED";

export interface PolicyTemplate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  purpose: string;
  permissions: string[];
  prohibitions: string[];
  validityRule: string;
  retentionRule: string | null;
  active: boolean;
}

export interface PublicationRecipientSummary {
  id?: string;
  anOrgId: string;
  anName: string;
  status: PublicationRecipientStatus;
  notifiedAt?: string | null;
  policyAcceptedAt?: string | null;
  policyRejectedAt?: string | null;
  firstAccessedAt?: string | null;
  lastAccessedAt?: string | null;
}

export interface DataPublication {
  id: string;
  agOrgId: string;
  projectId: string;
  dataProductType: DataProductType;
  title: string;
  description: string | null;
  version: number;
  schemaVersion: string;
  status: PublicationStatus;
  policyTemplateId: string;
  policyCode?: string | null;
  policyName?: string | null;
  selectedFields: string[];
  selectedTaktIds?: string[] | null;
  contentHash?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  publishedAt?: string | null;
  withdrawnAt?: string | null;
  createdAt: string;
  updatedAt: string;
  recipients?: PublicationRecipientSummary[];
  policy?: PolicyTemplate | null;
}

export interface CreateDataPublicationDto {
  dataProductType: DataProductType;
  title: string;
  description?: string;
  policyTemplateId: string;
  selectedFields: string[];
  selectedTaktIds?: string[];
  recipientAnOrgIds: string[];
  validFrom?: string;
  validUntil?: string;
}

export interface InviteParticipantsWithDataDto {
  participantIds: string[];
  invitationMessage?: string;
  validUntil?: string;
  policyTemplateId: string;
  title: string;
  description?: string;
  selectedFields: string[];
  validFrom?: string;
}

export interface InviteParticipantsWithDataResult {
  publication: DataPublication;
  memberships: Array<{ id: string; anOrgId: string; status: string }>;
}

/** A DataPublication enriched with projectName (returned by /ag/data-publications). */
export interface AgDataPublication extends DataPublication {
  projectName: string | null;
}

// ── FIELD_WHITELISTS (must mirror the server-side constant) ───────────────────

export const FIELD_WHITELISTS: Record<DataProductType, string[]> = {
  TAKT_INFORMATION_PACKAGE: [
    // Projektdaten
    "projectReference",
    "projectName",
    "projectStatus",
    "startDate",
    "endDate",
    "projectLocation",
    "projectDescription",
    // Leistungsdaten
    "workPackage",
    "trade",
    // Zeitplanung
    "plannedTimeWindow",
    "bufferTimeWindow",
    // Ausführung
    "location",
    "executionNotes",
    // Anordnungsbeziehungen
    "predecessors",
    "successors",
    // Ressourcen & Logistik
    "resourceRequirements",
  ],
};

export const FIELD_LABELS: Record<string, string> = {
  // Projektfelder
  projectReference: "Projektreferenz (ID)",
  projectName: "Projektname",
  projectStatus: "Projektstatus",
  startDate: "Projektbeginn",
  endDate: "Projektende",
  projectLocation: "Projektstandort / Bauvorhaben",
  projectDescription: "Projektbeschreibung",
  // Leistungsfelder (TAKT_INFORMATION_PACKAGE)
  workPackage: "Leistungsbezeichnung",
  trade: "Gewerk",
  plannedTimeWindow: "Geplantes Zeitfenster",
  bufferTimeWindow: "Puffer (Frühest / Spätest)",
  location: "Ausführungsort / Zone",
  executionNotes: "Hinweise zur Ausführung",
  predecessors: "Vorgänger-Leistungen",
  successors: "Nachfolger-Leistungen",
  resourceRequirements: "Ressourcenbedarf / Logistik",
};

// ── FIELD_GROUPS — grouped layout for TAKT_INFORMATION_PACKAGE Step 1 ─────────

export const FIELD_GROUPS: Record<DataProductType, { label: string; fields: string[] }[] | null> = {
  TAKT_INFORMATION_PACKAGE: [
    {
      label: "Projektdaten",
      fields: ["projectName", "projectStatus", "startDate", "endDate", "projectLocation", "projectDescription", "projectReference"],
    },
    {
      label: "Leistungsdaten",
      fields: ["workPackage", "trade"],
    },
    {
      label: "Zeitplanung",
      fields: ["plannedTimeWindow", "bufferTimeWindow"],
    },
    {
      label: "Ausführung",
      fields: ["location", "executionNotes"],
    },
    {
      label: "Anordnungsbeziehungen",
      fields: ["predecessors", "successors"],
    },
    {
      label: "Ressourcen & Logistik",
      fields: ["resourceRequirements"],
    },
  ],
};

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useGetPolicyTemplates(): UseQueryResult<PolicyTemplate[], Error> {
  return useQuery({
    queryKey: ["policy-templates"],
    queryFn: () =>
      customFetch<PolicyTemplate[]>("/api/policy-templates", { method: "GET" }),
  });
}

// ── GET /api/ag/data-publications ─────────────────────────────────────────────
export function useGetAllAgDataPublications(): import("@tanstack/react-query").UseQueryResult<AgDataPublication[], Error> {
  return useQuery({
    queryKey: ["ag-data-publications"],
    queryFn: () =>
      customFetch<AgDataPublication[]>("/api/ag/data-publications", {
        method: "GET",
      }),
  });
}

export function useGetProjectDataPublications(
  projectId: string | undefined,
): UseQueryResult<DataPublication[], Error> {
  return useQuery({
    queryKey: ["data-publications", projectId],
    queryFn: () =>
      customFetch<DataPublication[]>(
        `/api/projects/${projectId}/data-publications`,
        { method: "GET" },
      ),
    enabled: !!projectId,
  });
}

export function useGetDataPublication(
  publicationId: string | undefined,
): UseQueryResult<DataPublication, Error> {
  return useQuery({
    queryKey: ["data-publication", publicationId],
    queryFn: () =>
      customFetch<DataPublication>(
        `/api/data-publications/${publicationId}`,
        { method: "GET" },
      ),
    enabled: !!publicationId,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useCreateDataPublication(
  projectId: string,
): UseMutationResult<DataPublication, Error, CreateDataPublicationDto> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      customFetch<DataPublication>(
        `/api/projects/${projectId}/data-publications`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["data-publications", projectId] });
    },
  });
}

export function useInviteParticipantsWithData(
  projectId: string,
): UseMutationResult<InviteParticipantsWithDataResult, Error, InviteParticipantsWithDataDto> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      customFetch<InviteParticipantsWithDataResult>(
        `/api/projects/${projectId}/invitations-with-data`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["data-publications", projectId] });
      void qc.invalidateQueries({ queryKey: ["project-memberships", projectId] });
    },
  });
}

export function usePublishDataPublication(): UseMutationResult<
  { ok: boolean; status: string },
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (publicationId) =>
      customFetch<{ ok: boolean; status: string }>(
        `/api/data-publications/${publicationId}/publish`,
        { method: "POST" },
      ),
    onSuccess: (_data, publicationId) => {
      void qc.invalidateQueries({ queryKey: ["data-publication", publicationId] });
      void qc.invalidateQueries({ queryKey: ["data-publications"] });
    },
  });
}

export function useSuspendDataPublication(): UseMutationResult<
  { ok: boolean; status: string },
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (publicationId) =>
      customFetch<{ ok: boolean; status: string }>(
        `/api/data-publications/${publicationId}/suspend`,
        { method: "POST" },
      ),
    onSuccess: (_data, publicationId) => {
      void qc.invalidateQueries({ queryKey: ["data-publication", publicationId] });
      void qc.invalidateQueries({ queryKey: ["data-publications"] });
    },
  });
}

export function useWithdrawDataPublication(): UseMutationResult<
  { ok: boolean; status: string },
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (publicationId) =>
      customFetch<{ ok: boolean; status: string }>(
        `/api/data-publications/${publicationId}/withdraw`,
        { method: "POST" },
      ),
    onSuccess: (_data, publicationId) => {
      void qc.invalidateQueries({ queryKey: ["data-publication", publicationId] });
      void qc.invalidateQueries({ queryKey: ["data-publications"] });
    },
  });
}

export function useDeleteDataPublication(): UseMutationResult<
  { ok: boolean },
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (publicationId) =>
      customFetch<{ ok: boolean }>(
        `/api/data-publications/${publicationId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["data-publications"] });
    },
  });
}

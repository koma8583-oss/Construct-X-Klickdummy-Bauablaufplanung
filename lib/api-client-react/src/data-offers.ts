/**
 * Typed React Query hooks for the AN-facing data-offer endpoints (Task #112).
 *
 *   useGetAnDataOffers()
 *   useGetAnDataOffer(publicationId)
 *   useAcceptDataOffer()
 *   useRejectDataOffer()
 *   useGetDataOfferContent(publicationId, enabled)
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type {
  DataProductType,
  PublicationStatus,
  PublicationRecipientStatus,
  PolicyTemplate,
} from "./data-publications";

export type { DataProductType, PublicationStatus, PublicationRecipientStatus, PolicyTemplate };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DataOfferSummary {
  publicationId: string;
  title: string;
  agName: string;
  projectReference: string;
  dataProductType: DataProductType;
  version: number;
  publicationStatus: PublicationStatus;
  recipientStatus: PublicationRecipientStatus;
  policyCode: string | null;
  policyName: string | null;
  validFrom: string | null;
  validUntil: string | null;
  notifiedAt: string | null;
  policyAcceptedAt: string | null;
  policyRejectedAt: string | null;
}

export interface DataOfferProjectInfo {
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  description: string | null;
}

export interface DataOfferAssignment {
  id: string;
  trade: string | null;
  workPackageReference: string | null;
  assignmentStatus: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface DataOfferDetail extends DataOfferSummary {
  description: string | null;
  firstAccessedAt: string | null;
  projectInfo: DataOfferProjectInfo | null;
  assignments: DataOfferAssignment[];
  policy: PolicyTemplate | null;
}

export interface DataOfferContent {
  publicationId: string;
  title: string;
  dataProductType: DataProductType;
  version: number;
  schemaVersion: string;
  contentHash: string | null;
  validFrom: string | null;
  validUntil: string | null;
  publishedAt: string | null;
  content: Record<string, unknown>;
}

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useGetAnDataOffers(): UseQueryResult<DataOfferSummary[], Error> {
  return useQuery({
    queryKey: ["an-data-offers"],
    queryFn: () =>
      customFetch<DataOfferSummary[]>("/api/an/data-offers", { method: "GET" }),
  });
}

export function useGetAnDataOffer(
  publicationId: string | undefined,
): UseQueryResult<DataOfferDetail, Error> {
  return useQuery({
    queryKey: ["an-data-offer", publicationId],
    queryFn: () =>
      customFetch<DataOfferDetail>(
        `/api/an/data-offers/${publicationId}`,
        { method: "GET" },
      ),
    enabled: !!publicationId,
  });
}

export function useGetDataPublicationOdrl(
  publicationId: string | undefined,
  enabled = false,
): UseQueryResult<Record<string, unknown>, Error> {
  return useQuery({
    queryKey: ["data-publication-odrl", publicationId],
    queryFn: () =>
      customFetch<Record<string, unknown>>(
        `/api/data-publications/${publicationId}/odrl`,
        { method: "GET" },
      ),
    enabled: !!publicationId && enabled,
  });
}

export function useGetDataOfferContent(
  publicationId: string | undefined,
  enabled = false,
): UseQueryResult<DataOfferContent, Error> {
  return useQuery({
    queryKey: ["an-data-offer-content", publicationId],
    queryFn: () =>
      customFetch<DataOfferContent>(
        `/api/an/data-offers/${publicationId}/content`,
        { method: "GET" },
      ),
    enabled: !!publicationId && enabled,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useAcceptDataOffer(): UseMutationResult<
  { ok: boolean; status: string },
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (publicationId) =>
      customFetch<{ ok: boolean; status: string }>(
        `/api/an/data-offers/${publicationId}/accept`,
        { method: "POST" },
      ),
    onSuccess: (_data, publicationId) => {
      void qc.invalidateQueries({ queryKey: ["an-data-offer", publicationId] });
      void qc.invalidateQueries({ queryKey: ["an-data-offers"] });
    },
  });
}

export function useRejectDataOffer(): UseMutationResult<
  { ok: boolean; status: string },
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (publicationId) =>
      customFetch<{ ok: boolean; status: string }>(
        `/api/an/data-offers/${publicationId}/reject`,
        { method: "POST" },
      ),
    onSuccess: (_data, publicationId) => {
      void qc.invalidateQueries({ queryKey: ["an-data-offer", publicationId] });
      void qc.invalidateQueries({ queryKey: ["an-data-offers"] });
    },
  });
}

/**
 * Resource requirements hooks for TaktRequests (Task #118).
 * Endpoints: GET/POST/DELETE /api/takt-requests/:id/resource-requirements
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

/** @deprecated Use the generated ResourceRequirement for canonical Leistung APIs. */
export interface TaktResourceRequirement {
  id: string;
  taktRequestId: string;
  anOrgId: string;
  resourceTypeId: string | null;
  resourceTypeName: string | null;
  resourceTypeCategory: string | null;
  requiredCapacity: string | null;
  utilizationPercent: number;
  requiredQualification: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceRequirementCreate {
  resourceTypeId?: string | null;
  requiredCapacity?: number | null;
  utilizationPercent?: number;
  requiredQualification?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
}

// ── Query keys ─────────────────────────────────────────────────────────────────

export const RESOURCE_REQUIREMENTS_QUERY_KEY = "resource-requirements" as const;

export const getResourceRequirementsQueryKey = (requestId: string) =>
  [RESOURCE_REQUIREMENTS_QUERY_KEY, requestId] as const;

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useListResourceRequirements(
  requestId: string,
  options?: {
    query?: UseQueryOptions<TaktResourceRequirement[], Error>;
  },
) {
  return useQuery<TaktResourceRequirement[], Error>({
    queryKey: getResourceRequirementsQueryKey(requestId),
    queryFn: async ({ signal }) =>
      customFetch<TaktResourceRequirement[]>(
        `/api/takt-requests/${requestId}/resource-requirements`,
        { signal },
      ),
    enabled: !!requestId,
    ...options?.query,
  });
}

export function useAddResourceRequirement(
  options?: {
    mutation?: UseMutationOptions<
      TaktResourceRequirement,
      Error,
      { requestId: string; data: ResourceRequirementCreate }
    >;
  },
) {
  const queryClient = useQueryClient();
  return useMutation<
    TaktResourceRequirement,
    Error,
    { requestId: string; data: ResourceRequirementCreate }
  >({
    mutationFn: ({ requestId, data }) =>
      customFetch<TaktResourceRequirement>(
        `/api/takt-requests/${requestId}/resource-requirements`,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    onSuccess: (_, { requestId }) => {
      queryClient.invalidateQueries({
        queryKey: getResourceRequirementsQueryKey(requestId),
      });
    },
    ...options?.mutation,
  });
}

export function useDeleteResourceRequirement(
  options?: {
    mutation?: UseMutationOptions<
      void,
      Error,
      { requestId: string; requirementId: string }
    >;
  },
) {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { requestId: string; requirementId: string }
  >({
    mutationFn: ({ requestId, requirementId }) =>
      customFetch<void>(
        `/api/takt-requests/${requestId}/resource-requirements/${requirementId}`,
        { method: "DELETE" },
      ),
    onSuccess: (_, { requestId }) => {
      queryClient.invalidateQueries({
        queryKey: getResourceRequirementsQueryKey(requestId),
      });
    },
    ...options?.mutation,
  });
}

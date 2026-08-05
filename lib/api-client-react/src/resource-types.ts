/**
 * React Query hooks for the AN-facing resource-types endpoints (Task #117).
 *
 *   useListResourceTypes()
 *   useGetResourceType(id)
 *   useCreateResourceType()
 *   useUpdateResourceType()
 *   useDeactivateResourceType()
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResourceTypeCategory =
  | "PERSONNEL"
  | "CREW"
  | "EQUIPMENT"
  | "MACHINE"
  | "OTHER";

export type ResourceCapacityUnit =
  | "PERSONS"
  | "UNITS"
  | "HOURS_PER_DAY"
  | "PERCENT";

export interface ResourceTypeRecord {
  id: string;
  anOrgId: string;
  name: string;
  category: ResourceTypeCategory;
  qualification: string | null;
  capacityUnit: ResourceCapacityUnit | null;
  defaultDailyCapacity: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceTypeCreate {
  name: string;
  category: ResourceTypeCategory;
  qualification?: string;
  capacityUnit?: ResourceCapacityUnit;
  defaultDailyCapacity?: number;
}

export interface ResourceTypeUpdate {
  name?: string;
  category?: ResourceTypeCategory;
  qualification?: string | null;
  capacityUnit?: ResourceCapacityUnit | null;
  defaultDailyCapacity?: number | null;
  active?: boolean;
}

export interface ResourceTypeListResult {
  items: ResourceTypeRecord[];
  count: number;
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const RESOURCE_TYPES_QUERY_KEY = ["nu-resource-types"] as const;

export function getResourceTypesQueryKey(params?: { includeInactive?: boolean }) {
  return [...RESOURCE_TYPES_QUERY_KEY, params ?? {}] as const;
}

export function getResourceTypeQueryKey(id: string) {
  return [...RESOURCE_TYPES_QUERY_KEY, id] as const;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useListResourceTypes(params?: {
  includeInactive?: boolean;
}): UseQueryResult<ResourceTypeListResult, Error> {
  const qs = params?.includeInactive ? "?includeInactive=true" : "";
  return useQuery({
    queryKey: getResourceTypesQueryKey(params),
    queryFn: () =>
      customFetch<ResourceTypeListResult>(`/api/nu/resource-types${qs}`, {
        method: "GET",
      }),
  });
}

export function useGetResourceType(
  id: string | undefined,
): UseQueryResult<ResourceTypeRecord, Error> {
  return useQuery({
    queryKey: getResourceTypeQueryKey(id ?? ""),
    queryFn: () =>
      customFetch<ResourceTypeRecord>(`/api/nu/resource-types/${id}`, {
        method: "GET",
      }),
    enabled: !!id,
  });
}

export function useCreateResourceType(): UseMutationResult<
  ResourceTypeRecord,
  Error,
  ResourceTypeCreate
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) =>
      customFetch<ResourceTypeRecord>("/api/nu/resource-types", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RESOURCE_TYPES_QUERY_KEY });
    },
  });
}

export function useUpdateResourceType(): UseMutationResult<
  ResourceTypeRecord,
  Error,
  { id: string; data: ResourceTypeUpdate }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) =>
      customFetch<ResourceTypeRecord>(`/api/nu/resource-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: RESOURCE_TYPES_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: getResourceTypeQueryKey(id) });
    },
  });
}

export function useDeactivateResourceType(): UseMutationResult<
  ResourceTypeRecord,
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      customFetch<ResourceTypeRecord>(`/api/nu/resource-types/${id}/deactivate`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RESOURCE_TYPES_QUERY_KEY });
    },
  });
}

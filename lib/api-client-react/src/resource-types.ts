/**
 * React Query hooks for the AN-facing resource-types endpoints (Task #117, DTC update).
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

// ── DTC constants ──────────────────────────────────────────────────────────────

/** The four DTC v2 class URIs supported for AN resource types. */
export const DTC_CLASSES = {
  WORKER: "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedWorker",
  WORKER_CREW: "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedWorkerCrew",
  EQUIPMENT: "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedEquipment",
  TEMPORARY_EQUIPMENT: "https://dtc-ontology.cms.ed.tum.de/ontology/v2#AsPlannedTemporaryEquipment",
} as const;

export type DtcClassKey = keyof typeof DTC_CLASSES;
export type DtcClassUri = (typeof DTC_CLASSES)[DtcClassKey];

/** Human-readable German labels for DTC classes (used in dropdowns). */
export const DTC_CLASS_LABELS: Record<DtcClassKey, string> = {
  WORKER: "Arbeitskraft",
  WORKER_CREW: "Kolonne",
  EQUIPMENT: "Gerät / Maschine",
  TEMPORARY_EQUIPMENT: "Temporäres Bauhilfsmittel",
};

/** Mapping from DTC class key to the legacy `category` enum value. */
export const DTC_TO_CATEGORY: Record<DtcClassKey, ResourceTypeCategory> = {
  WORKER: "PERSONNEL",
  WORKER_CREW: "CREW",
  EQUIPMENT: "EQUIPMENT",
  TEMPORARY_EQUIPMENT: "MACHINE",
};

/** Reverse mapping: legacy category → best-fit DTC key. */
export const CATEGORY_TO_DTC: Record<ResourceTypeCategory, DtcClassKey> = {
  PERSONNEL: "WORKER",
  CREW: "WORKER_CREW",
  EQUIPMENT: "EQUIPMENT",
  MACHINE: "TEMPORARY_EQUIPMENT",
  OTHER: "WORKER", // best-effort fallback
};

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
  /** Short internal code, e.g. "LAB-DRYWALL" */
  code: string | null;
  /** Full DTC-v2 class URI */
  dtcClass: string | null;
  classificationSystem: string | null;
  classificationCode: string | null;
  /** @deprecated use dtcClass to determine resource semantics */
  qualification: string | null;
  capacityUnit: ResourceCapacityUnit | null;
  /** @deprecated use per-resource capacity instead */
  defaultDailyCapacity: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceTypeCreate {
  name: string;
  category: ResourceTypeCategory;
  code?: string;
  dtcClass?: string;
  classificationSystem?: string;
  classificationCode?: string;
  capacityUnit?: ResourceCapacityUnit;
  /** @deprecated */
  qualification?: string;
  /** @deprecated */
  defaultDailyCapacity?: number;
}

export interface ResourceTypeUpdate {
  name?: string;
  category?: ResourceTypeCategory;
  code?: string | null;
  dtcClass?: string | null;
  classificationSystem?: string | null;
  classificationCode?: string | null;
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

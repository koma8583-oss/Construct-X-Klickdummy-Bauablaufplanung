/**
 * Typed hooks for the /api/reports/* summary endpoints (Task #105).
 *
 * Hand-written to avoid regenerating the full OpenAPI client.
 * Uses the same customFetch and @tanstack/react-query pattern as the
 * generated api.ts file.
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult, QueryKey } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

/** UseQueryOptions with queryKey made optional (the hook provides it). */
type PartialQueryOptions<TData, TError, TResult = TData> = Omit<
  UseQueryOptions<TData, TError, TResult, QueryKey>,
  "queryKey"
> & { queryKey?: QueryKey };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgReportSummary {
  projects: number;
  assignedSubcontractors: number;
  openTaktRequests: number;
  overdueTaktRequests: number;
  acceptedTaktRequests: number;
  alternativeTaktRequests: number;
  rejectedTaktRequests: number;
  confirmedTakts: number;
}

export interface AnReportSummary {
  openTaktRequests: number;
  dueSoonTaktRequests: number;
  overdueTaktRequests: number;
  acceptedResponses: number;
  alternativeResponses: number;
  rejectedResponses: number;
  activeResources: number;
  activeResourceBookings: number;
}

export interface HubReportSummary {
  pendingMessages: number;
  deliveredMessages: number;
  failedMessages: number;
  retryCount: number;
}

// ── AG summary ────────────────────────────────────────────────────────────────

export const getAgReportSummaryUrl = () => `/api/reports/ag/summary`;

export const getAgReportSummary = (options?: RequestInit): Promise<AgReportSummary> =>
  customFetch<AgReportSummary>(getAgReportSummaryUrl(), { ...options, method: "GET" });

export const getAgReportSummaryQueryKey = () => [getAgReportSummaryUrl()] as const;

export function useGetAgReportSummary<
  TData = AgReportSummary,
  TError = ErrorType<unknown>,
>(
  options?: { query?: PartialQueryOptions<AgReportSummary, TError, TData>; request?: RequestInit },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getAgReportSummaryQueryKey();
  const result = useQuery<AgReportSummary, TError, TData>({
    queryKey,
    queryFn: ({ signal }) => getAgReportSummary({ signal, ...requestOptions }),
    ...queryOptions,
  } as UseQueryOptions<AgReportSummary, TError, TData>);
  return Object.assign(result, { queryKey });
}

// ── AN summary ────────────────────────────────────────────────────────────────

export const getAnReportSummaryUrl = () => `/api/reports/an/summary`;

export const getAnReportSummary = (options?: RequestInit): Promise<AnReportSummary> =>
  customFetch<AnReportSummary>(getAnReportSummaryUrl(), { ...options, method: "GET" });

export const getAnReportSummaryQueryKey = () => [getAnReportSummaryUrl()] as const;

export function useGetAnReportSummary<
  TData = AnReportSummary,
  TError = ErrorType<unknown>,
>(
  options?: { query?: PartialQueryOptions<AnReportSummary, TError, TData>; request?: RequestInit },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getAnReportSummaryQueryKey();
  const result = useQuery<AnReportSummary, TError, TData>({
    queryKey,
    queryFn: ({ signal }) => getAnReportSummary({ signal, ...requestOptions }),
    ...queryOptions,
  } as UseQueryOptions<AnReportSummary, TError, TData>);
  return Object.assign(result, { queryKey });
}

// ── Hub summary ───────────────────────────────────────────────────────────────

export const getHubReportSummaryUrl = () => `/api/reports/hub/summary`;

export const getHubReportSummary = (options?: RequestInit): Promise<HubReportSummary> =>
  customFetch<HubReportSummary>(getHubReportSummaryUrl(), { ...options, method: "GET" });

export const getHubReportSummaryQueryKey = () => [getHubReportSummaryUrl()] as const;

export function useGetHubReportSummary<
  TData = HubReportSummary,
  TError = ErrorType<unknown>,
>(
  options?: { query?: PartialQueryOptions<HubReportSummary, TError, TData>; request?: RequestInit },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getHubReportSummaryQueryKey();
  const result = useQuery<HubReportSummary, TError, TData>({
    queryKey,
    queryFn: ({ signal }) => getHubReportSummary({ signal, ...requestOptions }),
    ...queryOptions,
  } as UseQueryOptions<HubReportSummary, TError, TData>);
  return Object.assign(result, { queryKey });
}

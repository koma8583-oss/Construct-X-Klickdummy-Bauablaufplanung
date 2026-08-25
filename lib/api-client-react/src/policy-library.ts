import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { PolicyTemplate } from "./data-publications";

export type PolicyLibraryItem = PolicyTemplate & {
  odrl: Record<string, unknown>;
};

export function useListAnPolicies(): UseQueryResult<PolicyLibraryItem[], Error> {
  return useQuery({
    queryKey: ["an-policy-library"],
    queryFn: () => customFetch<PolicyLibraryItem[]>("/api/policies", { method: "GET" }),
  });
}
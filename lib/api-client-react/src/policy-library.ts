import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { PolicyTemplate } from "./data-publications";

export type PolicyLibraryItem = PolicyTemplate & {
  projects: Array<{
    id: string;
    name: string;
    agOrgId: string;
    agName: string;
  }>;
  odrl: Record<string, unknown>;
};

export type PolicyTemplateRegistryEntry = {
  templateId: string;
  version: number;
  code: string;
  name: string;
  description: string;
  purpose: string;
  requiredParameters: string[];
  allowedOverrides: string[];
  permissions: string[];
  prohibitions: string[];
  validityRule: string;
  retentionRule: string | null;
  allowedPublicationFields?: string[];
};

export function useGetPolicyTemplateRegistry(): UseQueryResult<PolicyTemplateRegistryEntry[], Error> {
  return useQuery({
    queryKey: ["policy-template-registry"],
    queryFn: () => customFetch<PolicyTemplateRegistryEntry[]>("/api/policy-templates/registry", { method: "GET" }),
  });
}

export function useListAnPolicies(): UseQueryResult<PolicyLibraryItem[], Error> {
  return useQuery({
    queryKey: ["an-policy-library"],
    queryFn: () => customFetch<PolicyLibraryItem[]>("/api/policies", { method: "GET" }),
  });
}
import type { LeistungsanfragePolicyAccessError } from "../../services/leistungsanfrage-policy-guard";

export function policyAccessConflictBody(error: Pick<LeistungsanfragePolicyAccessError, "code" | "action">) {
  return {
    error: error.code,
    code: error.code,
    action: error.action,
  };
}
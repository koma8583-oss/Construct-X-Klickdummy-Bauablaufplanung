import { customFetch } from "./custom-fetch";

export type CoordinationTask = {
  id: string;
  serviceRequestId: string;
  serviceName: string;
  partnerOrgId: string;
  partnerName: string;
  projectId: string | null;
  projectName: string | null;
  taskType:
    | "RESPOND_TO_REQUEST"
    | "DECIDE_RESPONSE"
    | "RESPOND_TO_CHANGE_PROPOSAL"
    | "RESOLVE_CONSTRAINT"
    | "ANSWER_CLARIFICATION"
    | "CONFIRM_READINESS";
  priority: "NORMAL" | "HIGH" | "CRITICAL";
  dueAt: string | null;
  status: "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "OPEN";
  summary: string;
  lastChangedAt: string;
  targetUrl: string;
};

export function getCoordinationTasks(options?: RequestInit) {
  return customFetch<CoordinationTask[]>("/api/coordination/tasks", options);
}
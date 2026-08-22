import { customFetch } from "./custom-fetch";

export type ChangeProposalPayload = {
  start: string;
  end: string;
  reasonCode?: string | null;
  comment?: string | null;
};

const proposalUrl = (requestId: string) => `/api/leistungsanfragen/${requestId}/change-proposals`;

export function createChangeProposal(requestId: string, payload: ChangeProposalPayload) {
  return customFetch(proposalUrl(requestId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, action: "PROPOSE" }),
  });
}

export function counterChangeProposal(requestId: string, proposalId: string, payload: ChangeProposalPayload) {
  return customFetch(`${proposalUrl(requestId)}/${proposalId}/counter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function acceptChangeProposal(requestId: string, proposalId: string) {
  return customFetch(`${proposalUrl(requestId)}/${proposalId}/accept`, { method: "POST" });
}

export function rejectChangeProposal(requestId: string, proposalId: string) {
  return customFetch(`${proposalUrl(requestId)}/${proposalId}/reject`, { method: "POST" });
}
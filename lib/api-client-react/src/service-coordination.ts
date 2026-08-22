import { customFetch } from "./custom-fetch";

export function getServiceConstraints(requestId: string) {
  return customFetch(`/api/service-requests/${requestId}/constraints`);
}
export function getServiceClarifications(requestId: string) {
  return customFetch(`/api/service-requests/${requestId}/clarifications`);
}
export function getServiceReadiness(requestId: string) {
  return customFetch(`/api/service-requests/${requestId}/readiness`);
}
export function getProjectCoordinationBoard(projectId: string) {
  return customFetch(`/api/ag/projects/${projectId}/coordination-board`);
}
export function getChangeImpact(requestId: string, proposedStart: string, proposedEnd: string) {
  const params = new URLSearchParams({ proposedStart, proposedEnd });
  return customFetch(`/api/service-requests/${requestId}/change-impact?${params.toString()}`);
}
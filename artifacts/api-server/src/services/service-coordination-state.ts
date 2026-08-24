export type CoordinationParty = "AG" | "AN";
export type CoordinationAction =
  | "RESPOND_TO_REQUEST"
  | "DECIDE_RESPONSE"
  | "RESPOND_TO_CHANGE_PROPOSAL"
  | "ANSWER_CLARIFICATION"
  | "RESOLVE_CONSTRAINT"
  | "CONFIRM_READINESS"
  | "NO_ACTION";

export type ServiceCoordinationState = {
  nextActionOwner: CoordinationParty | null;
  nextAction: CoordinationAction;
};

export function deriveCoordinationFacts(input: {
  guOrgId: string;
  requestStatus: string;
  hasResponse?: boolean;
  hasDecision?: boolean;
  openProposalProposerOrgId?: string | null;
  openProposalGuOrgId?: string | null;
  clarificationPendingForAG?: boolean;
  clarificationPendingForAN?: boolean;
  constraintPendingForAG?: boolean;
  constraintPendingForAN?: boolean;
  readinessPendingForAG?: boolean;
  readinessPendingForAN?: boolean;
}): ServiceCoordinationState {
  if (input.openProposalProposerOrgId) {
    return {
      nextActionOwner: input.openProposalProposerOrgId === (input.openProposalGuOrgId ?? input.guOrgId) ? "AN" : "AG",
      nextAction: "RESPOND_TO_CHANGE_PROPOSAL",
    };
  }
  // A revision replaces the previous response. Its historical response and
  // GU decision must not make the request look finished to coordination views.
  if (input.requestStatus === "REVISION_REQUIRED") {
    return { nextActionOwner: "AN", nextAction: "RESPOND_TO_REQUEST" };
  }
  if (input.hasResponse && !input.hasDecision) return { nextActionOwner: "AG", nextAction: "DECIDE_RESPONSE" };
  if (!input.hasResponse && ["SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"].includes(input.requestStatus)) {
    return { nextActionOwner: "AN", nextAction: "RESPOND_TO_REQUEST" };
  }
  if (input.clarificationPendingForAG) return { nextActionOwner: "AG", nextAction: "ANSWER_CLARIFICATION" };
  if (input.clarificationPendingForAN) return { nextActionOwner: "AN", nextAction: "ANSWER_CLARIFICATION" };
  if (input.constraintPendingForAG) return { nextActionOwner: "AG", nextAction: "RESOLVE_CONSTRAINT" };
  if (input.constraintPendingForAN) return { nextActionOwner: "AN", nextAction: "RESOLVE_CONSTRAINT" };
  if (input.readinessPendingForAG) return { nextActionOwner: "AG", nextAction: "CONFIRM_READINESS" };
  if (input.readinessPendingForAN) return { nextActionOwner: "AN", nextAction: "CONFIRM_READINESS" };
  return { nextActionOwner: null, nextAction: "NO_ACTION" };
}

export function deriveServiceCoordinationState(input: {
  party: CoordinationParty;
  requestStatus: string;
  hasResponse?: boolean;
  hasDecision?: boolean;
  openProposalProposer?: CoordinationParty | null;
  clarificationNeedsAnswer?: boolean;
  constraintNeedsResolution?: boolean;
  readinessNeedsConfirmation?: boolean;
}): ServiceCoordinationState {
  const proposalOwner = input.openProposalProposer
    ? input.openProposalProposer === "AG" ? "AN" : "AG"
    : null;
  const candidates: Array<[CoordinationAction, CoordinationParty]> = [];
  if (proposalOwner) candidates.push(["RESPOND_TO_CHANGE_PROPOSAL", proposalOwner]);
  // REVISION_REQUIRED means that the GU has already decided that the previous
  // response must be replaced. The existing response and decision therefore
  // must not hide the AN's next action.
  if (input.requestStatus === "REVISION_REQUIRED") {
    candidates.push(["RESPOND_TO_REQUEST", "AN"]);
  } else if (input.hasResponse && !input.hasDecision) {
    candidates.push(["DECIDE_RESPONSE", "AG"]);
  } else if (["SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW"].includes(input.requestStatus)) {
    candidates.push(["RESPOND_TO_REQUEST", "AN"]);
  }
  if (input.clarificationNeedsAnswer) candidates.push(["ANSWER_CLARIFICATION", input.party]);
  if (input.constraintNeedsResolution) candidates.push(["RESOLVE_CONSTRAINT", input.party]);
  if (input.readinessNeedsConfirmation) candidates.push(["CONFIRM_READINESS", input.party]);
  const selected = candidates[0];
  if (!selected || selected[1] !== input.party) {
    return { nextActionOwner: selected?.[1] ?? null, nextAction: "NO_ACTION" };
  }
  return { nextActionOwner: selected[1], nextAction: selected[0] };
}
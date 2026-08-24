export type CoordinationParty = "AG" | "AN";
export type CoordinationAction =
  | "RESPOND_TO_REQUEST"
  | "DECIDE_RESPONSE"
  | "RESPOND_TO_CHANGE_PROPOSAL"
  | "ANSWER_CLARIFICATION"
  | "RESOLVE_CONSTRAINT"
  | "CONFIRM_READINESS"
  | "NO_ACTION";

export type ServiceCoordinationFacts = {
  requestStatus: string;
  hasResponse: boolean;
  hasDecision: boolean;
  openProposalProposer?: CoordinationParty | null;
  clarificationWaitingFor?: CoordinationParty | null;
  constraintResponsible?: CoordinationParty | null;
  readinessActionRequiredBy?: CoordinationParty | null;
  responseRequiredBy?: Date | string | null;
  decisionRequiredBy?: Date | string | null;
};

export type ServiceCoordinationState = {
  nextActionOwner: CoordinationParty | null;
  nextAction: CoordinationAction;
  actionRequiredBy: string | null;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** The single objective workflow interpretation shared by every consumer. */
export function deriveServiceCoordinationState(
  input: ServiceCoordinationFacts & { party?: CoordinationParty },
): ServiceCoordinationState {
  if (input.openProposalProposer) {
    return {
      nextActionOwner: input.openProposalProposer === "AG" ? "AN" : "AG",
      nextAction: "RESPOND_TO_CHANGE_PROPOSAL",
      actionRequiredBy: null,
    };
  }

  if (input.requestStatus === "REVISION_REQUIRED") {
    return {
      nextActionOwner: "AN",
      nextAction: "RESPOND_TO_REQUEST",
      actionRequiredBy: asIso(input.responseRequiredBy),
    };
  }

  if (input.hasResponse && !input.hasDecision) {
    return {
      nextActionOwner: "AG",
      nextAction: "DECIDE_RESPONSE",
      actionRequiredBy: asIso(input.decisionRequiredBy),
    };
  }

  if (
    !input.hasResponse &&
    ["SENT", "DELIVERED", "DETAILS_RETRIEVED", "UNDER_REVIEW"].includes(
      input.requestStatus,
    )
  ) {
    return {
      nextActionOwner: "AN",
      nextAction: "RESPOND_TO_REQUEST",
      actionRequiredBy: asIso(input.responseRequiredBy),
    };
  }

  if (input.clarificationWaitingFor) {
    return {
      nextActionOwner: input.clarificationWaitingFor,
      nextAction: "ANSWER_CLARIFICATION",
      actionRequiredBy: null,
    };
  }

  if (input.constraintResponsible) {
    return {
      nextActionOwner: input.constraintResponsible,
      nextAction: "RESOLVE_CONSTRAINT",
      actionRequiredBy: null,
    };
  }

  if (input.readinessActionRequiredBy) {
    return {
      nextActionOwner: input.readinessActionRequiredBy,
      nextAction: "CONFIRM_READINESS",
      actionRequiredBy: null,
    };
  }

  return { nextActionOwner: null, nextAction: "NO_ACTION", actionRequiredBy: null };
}

/**
 * Compatibility adapter for existing callers. It normalizes the older boolean
 * facts into the same objective state; it never uses the viewer role.
 */
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
  responseRequiredBy?: Date | string | null;
  decisionRequiredBy?: Date | string | null;
}): ServiceCoordinationState {
  const proposer = input.openProposalProposerOrgId
    ? input.openProposalProposerOrgId === (input.openProposalGuOrgId ?? input.guOrgId)
      ? "AG"
      : "AN"
    : null;
  return deriveServiceCoordinationState({
    requestStatus: input.requestStatus,
    hasResponse: !!input.hasResponse,
    hasDecision: !!input.hasDecision,
    openProposalProposer: proposer,
    clarificationWaitingFor: input.clarificationPendingForAG
      ? "AG"
      : input.clarificationPendingForAN
        ? "AN"
        : null,
    constraintResponsible: input.constraintPendingForAG
      ? "AG"
      : input.constraintPendingForAN
        ? "AN"
        : null,
    readinessActionRequiredBy: input.readinessPendingForAG
      ? "AG"
      : input.readinessPendingForAN
        ? "AN"
        : null,
    responseRequiredBy: input.responseRequiredBy,
    decisionRequiredBy: input.decisionRequiredBy,
  });
}
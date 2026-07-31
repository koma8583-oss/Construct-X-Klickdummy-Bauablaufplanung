/**
 * TaktRequest status transition validator — framework-independent.
 *
 * The function only operates on string values and has no side effects.
 * It does NOT use Express, Drizzle, or any HTTP framework.
 *
 * Rules:
 *   - DELIVERED is a technical transport state, not a business confirmation.
 *   - ACCEPTED is an explicit business decision by the NU.
 *   - REJECTED applies to one request, not to the Takt itself.
 *   - Terminal states (ACCEPTED, CANCELLED, EXPIRED, SUPERSEDED) have no
 *     outgoing transitions.
 *
 * Usage: call assertValidTaktRequestTransition() from updateTaktRequestStatus()
 * in the repository layer. Do NOT wire this to existing delegation routes.
 */

export type TaktRequestStatus =
  | "DRAFT"
  | "SENT"
  | "DELIVERED"
  | "DETAILS_RETRIEVED"
  | "UNDER_REVIEW"
  | "ACCEPTED"
  | "ALTERNATIVES_PROPOSED"
  | "REJECTED"
  | "REVISION_REQUIRED"
  | "CANCELLED"
  | "EXPIRED"
  | "SUPERSEDED";

export const TERMINAL_TAKT_REQUEST_STATUSES = new Set<TaktRequestStatus>([
  "ACCEPTED",
  "CANCELLED",
  "EXPIRED",
  "SUPERSEDED",
]);

/**
 * All permitted state transitions for TaktRequest.
 * Any transition not listed here is invalid.
 */
const VALID_TRANSITIONS: Readonly<Record<TaktRequestStatus, readonly TaktRequestStatus[]>> = {
  DRAFT:                ["SENT", "CANCELLED"],
  SENT:                 ["DELIVERED", "CANCELLED", "EXPIRED"],
  DELIVERED:            ["DETAILS_RETRIEVED", "UNDER_REVIEW", "CANCELLED", "EXPIRED"],
  DETAILS_RETRIEVED:    ["UNDER_REVIEW", "ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED", "CANCELLED", "EXPIRED"],
  UNDER_REVIEW:         ["ACCEPTED", "ALTERNATIVES_PROPOSED", "REJECTED", "CANCELLED", "EXPIRED"],
  ALTERNATIVES_PROPOSED:["ACCEPTED", "REVISION_REQUIRED", "SUPERSEDED"],
  REJECTED:             ["REVISION_REQUIRED", "SUPERSEDED"],
  REVISION_REQUIRED:    ["SUPERSEDED"],
  // Terminal — no outgoing transitions
  ACCEPTED:             [],
  CANCELLED:            [],
  EXPIRED:              [],
  SUPERSEDED:           [],
} as const;

/**
 * Returns true if transitioning from `current` to `next` is permitted.
 *
 * Important distinctions:
 *   - DELIVERED → ACCEPTED is NOT a valid transition.
 *     The NU must actively review and then decide (ACCEPTED, ALTERNATIVES_PROPOSED, REJECTED).
 *   - ALTERNATIVES_PROPOSED → ACCEPTED is valid:
 *     The GU may accept one of the proposed alternatives.
 */
export function isValidTaktRequestTransition(
  current: TaktRequestStatus,
  next: TaktRequestStatus,
): boolean {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) return false; // unknown/invalid current status → reject
  return (allowed as readonly string[]).includes(next);
}

/**
 * Asserts that the transition is valid. Throws a descriptive Error if not.
 *
 * Use this in service/repository layer functions that update status.
 * The caller is responsible for wrapping in a domain-appropriate error type.
 */
export function assertValidTaktRequestTransition(
  current: TaktRequestStatus,
  next: TaktRequestStatus,
): void {
  if (!isValidTaktRequestTransition(current, next)) {
    const isTerminal = TERMINAL_TAKT_REQUEST_STATUSES.has(current);
    const reason = isTerminal
      ? `status "${current}" is terminal and has no permitted outgoing transitions`
      : `transition "${current}" → "${next}" is not in the permitted transition table`;
    throw new Error(`Invalid TaktRequest status transition: ${reason}`);
  }
}

/**
 * Returns all statuses that the given status can transition to.
 * Returns an empty array for terminal statuses.
 */
export function getAllowedNextStatuses(
  current: TaktRequestStatus,
): readonly TaktRequestStatus[] {
  return VALID_TRANSITIONS[current];
}

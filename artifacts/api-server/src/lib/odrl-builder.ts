/**
 * Builds a policy-specific ODRL Set document for a given data publication.
 *
 * Each policy code maps to its own permission actions, constraints, and
 * prohibition actions.  TaktKoord-specific restrictions that have no
 * standard ODRL left-operand are expressed with the `taktkoord:` namespace
 * prefix (ODRL extension point, §2.3).
 */

export interface OdrlConstraint {
  leftOperand: string;
  operator:    string;
  rightOperand: string;
}

export interface OdrlDuty {
  action:      string;
  constraint?: OdrlConstraint[];
}

export interface OdrlPermission {
  target:      string;
  assigner:    string;
  assignee?:   string;
  action:      string;
  constraint?: OdrlConstraint[];
  duty?:       OdrlDuty[];
}

export interface OdrlProhibition {
  target:    string;
  assigner?: string;
  assignee?: string;
  action:    string;
}

export interface OdrlDocument {
  "@context":  string;
  "@type":     string;
  uid:         string;
  permission:  OdrlPermission[];
  prohibition: OdrlProhibition[];
}

// ── Per-policy ODRL shapes ────────────────────────────────────────────────────

type PolicyDefinition = {
  purposeValue:  string;
  /** Additional custom constraints beyond purpose (TaktKoord namespace). */
  extraConstraints?: OdrlConstraint[];
  /** Duties on the "use" permission (e.g. delete obligation). */
  duties?: OdrlDuty[];
  /** Prohibition action verbs. SCHEDULE_COORDINATION intentionally omits "derive". */
  prohibitionActions: string[];
};

const POLICY_DEFINITIONS: Record<string, PolicyDefinition> = {
  PROJECT_COORDINATION_READ_ONLY: {
    purposeValue: "projectCoordination",
    prohibitionActions: ["distribute", "derive", "commercialize"],
  },

  TAKT_EXECUTION_USE: {
    purposeValue: "taktExecution",
    prohibitionActions: ["distribute", "commercialize"],
  },

  EXTENDED_PROJECT_COLLABORATION: {
    purposeValue: "projectExecution",
    prohibitionActions: ["distribute", "commercialize"],
  },

  SCHEDULE_COORDINATION: {
    purposeValue: "scheduleCoordination",
    extraConstraints: [
      {
        leftOperand:  "taktkoord:scope",
        operator:     "eq",
        rightOperand: "taktkoord:projectSpecific",
      },
      {
        leftOperand:  "taktkoord:internalUse",
        operator:     "eq",
        rightOperand: "taktkoord:restrictedToRecipient",
      },
    ],
    duties: [
      {
        action: "delete",
        constraint: [
          {
            leftOperand:  "taktkoord:trigger",
            operator:     "eq",
            rightOperand: "taktkoord:noLongerNeeded",
          },
        ],
      },
    ],
    // Only "distribute" — no "derive" for this policy.
    prohibitionActions: ["distribute"],
  },

  COORDINATION_USE: {
    purposeValue: "coordinationUse",
    extraConstraints: [
      {
        leftOperand:  "taktkoord:scope",
        operator:     "eq",
        rightOperand: "taktkoord:projectSpecific",
      },
    ],
    prohibitionActions: ["distribute", "derive", "modify"],
  },

  READ_ONLY: {
    purposeValue: "readOnly",
    prohibitionActions: ["distribute", "derive", "modify", "archive"],
  },

  SUBCONTRACTOR_FULL: {
    purposeValue: "subcontractorFull",
    extraConstraints: [
      {
        leftOperand:  "taktkoord:scope",
        operator:     "eq",
        rightOperand: "taktkoord:contractScope",
      },
    ],
    prohibitionActions: ["distribute", "commercialize"],
  },
};

/** Fallback for unknown policy codes — conservative defaults. */
function defaultDefinition(code: string): PolicyDefinition {
  return {
    purposeValue:       code.toLowerCase().replace(/_/g, ""),
    prohibitionActions: ["distribute", "derive"],
  };
}

// ── Public builder ────────────────────────────────────────────────────────────

export interface BuildOdrlInput {
  publicationId: string;
  policyCode:    string | undefined;
  agOrgId:       string;
  nuOrgId:       string | null;
  validFrom?:    string | Date | null;
  validUntil?:   string | Date | null;
}

export function buildOdrl(input: BuildOdrlInput): OdrlDocument {
  const code    = input.policyCode ?? "";
  const def     = POLICY_DEFINITIONS[code] ?? defaultDefinition(code);
  const target  = `data-publication:${input.publicationId}`;
  const assigner = `organization:${input.agOrgId}`;
  const assignee = input.nuOrgId ? `organization:${input.nuOrgId}` : undefined;

  // ── Permission constraints ─────────────────────────────────────────────────
  const permConstraints: OdrlConstraint[] = [
    { leftOperand: "purpose", operator: "eq", rightOperand: def.purposeValue },
    ...(def.extraConstraints ?? []),
    ...(input.validFrom
      ? [{ leftOperand: "dateTime", operator: "gteq", rightOperand: String(input.validFrom) }]
      : []),
    ...(input.validUntil
      ? [{ leftOperand: "dateTime", operator: "lteq", rightOperand: String(input.validUntil) }]
      : []),
  ];

  const permission: OdrlPermission = {
    target,
    assigner,
    ...(assignee ? { assignee } : {}),
    action:     "use",
    constraint: permConstraints,
    ...(def.duties ? { duty: def.duties } : {}),
  };

  // ── Prohibitions ──────────────────────────────────────────────────────────
  const prohibition: OdrlProhibition[] = def.prohibitionActions.map((action) => ({
    target,
    ...(assignee ? { assignee } : {}),
    action,
  }));

  return {
    "@context": "http://www.w3.org/ns/odrl.jsonld",
    "@type":    "Set",
    uid:        `urn:odrl:data-publication:${input.publicationId}`,
    permission:  [permission],
    prohibition,
  };
}

// ── Client-side preview (no publicationId yet — wizard) ───────────────────────

export function buildPreviewOdrl(
  policyCode: string,
  agOrgId:    string,
): OdrlDocument {
  return buildOdrl({
    publicationId: "preview",
    policyCode,
    agOrgId,
    nuOrgId:   null,
    validFrom: null,
    validUntil: null,
  });
}

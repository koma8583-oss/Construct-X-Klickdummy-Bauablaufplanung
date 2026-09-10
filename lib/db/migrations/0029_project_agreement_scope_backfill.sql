-- Backfill the explicit child-purpose and field-scope contract for accepted
-- project agreements created before these terms were persisted.
--
-- The update is deliberately conditional and idempotent:
--   * accepted project agreements are the only records affected;
--   * an existing valid string array is never replaced;
--   * when one representation already contains a restricted valid array, the
--     other representation inherits that array instead of widening it;
--   * rerunning this migration does not change already-complete rows.
WITH scope_defaults AS (
  SELECT
    '["RAHMENTERMINE","LEISTUNGSKOORDINATION","AUSFUEHRUNGSINFORMATIONEN","INDIVIDUELLE_FREIGABE"]'::jsonb
      AS allowed_purposes,
    '["trade","workPackage","kurzbezeichnung","location","plannedTimeWindow","bufferTimeWindow","predecessors","successors","taktReference","taktVersion","requiredOutput","resourceRequirements","constraints","documentReferences"]'::jsonb
      AS allowed_field_scope
),
scope_candidates AS (
  SELECT
    policy.id,
    policy.effective_policy,
    policy.policy_snapshot,
    defaults.allowed_purposes,
    defaults.allowed_field_scope,
    CASE
      WHEN jsonb_typeof(policy.effective_policy -> 'allowedPurposes') = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(policy.effective_policy -> 'allowedPurposes') = 'array'
                THEN policy.effective_policy -> 'allowedPurposes'
              ELSE '[]'::jsonb
            END
          ) AS item
          WHERE jsonb_typeof(item) <> 'string'
        )
        THEN policy.effective_policy -> 'allowedPurposes'
      ELSE NULL
    END AS effective_purposes,
    CASE
      WHEN jsonb_typeof(policy.policy_snapshot -> 'allowedPurposes') = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(policy.policy_snapshot -> 'allowedPurposes') = 'array'
                THEN policy.policy_snapshot -> 'allowedPurposes'
              ELSE '[]'::jsonb
            END
          ) AS item
          WHERE jsonb_typeof(item) <> 'string'
        )
        THEN policy.policy_snapshot -> 'allowedPurposes'
      ELSE NULL
    END AS snapshot_purposes,
    CASE
      WHEN jsonb_typeof(policy.effective_policy -> 'allowedFieldScope') = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(policy.effective_policy -> 'allowedFieldScope') = 'array'
                THEN policy.effective_policy -> 'allowedFieldScope'
              ELSE '[]'::jsonb
            END
          ) AS item
          WHERE jsonb_typeof(item) <> 'string'
        )
        THEN policy.effective_policy -> 'allowedFieldScope'
      ELSE NULL
    END AS effective_fields,
    CASE
      WHEN jsonb_typeof(policy.policy_snapshot -> 'allowedFieldScope') = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(policy.policy_snapshot -> 'allowedFieldScope') = 'array'
                THEN policy.policy_snapshot -> 'allowedFieldScope'
              ELSE '[]'::jsonb
            END
          ) AS item
          WHERE jsonb_typeof(item) <> 'string'
        )
        THEN policy.policy_snapshot -> 'allowedFieldScope'
      ELSE NULL
    END AS snapshot_fields
  FROM coordination_policies AS policy
  CROSS JOIN scope_defaults AS defaults
  WHERE policy.kind = 'PROJECT_AGREEMENT'
    AND policy.lifecycle_status = 'ACCEPTED'
)
UPDATE coordination_policies AS policy
SET
  effective_policy = jsonb_set(
    jsonb_set(
      COALESCE(scope.effective_policy, '{}'::jsonb),
      '{allowedPurposes}',
      COALESCE(scope.effective_purposes, scope.snapshot_purposes, scope.allowed_purposes),
      true
    ),
    '{allowedFieldScope}',
    COALESCE(scope.effective_fields, scope.snapshot_fields, scope.allowed_field_scope),
    true
  ),
  policy_snapshot = jsonb_set(
    jsonb_set(
      COALESCE(scope.policy_snapshot, '{}'::jsonb),
      '{allowedPurposes}',
      COALESCE(scope.snapshot_purposes, scope.effective_purposes, scope.allowed_purposes),
      true
    ),
    '{allowedFieldScope}',
    COALESCE(scope.snapshot_fields, scope.effective_fields, scope.allowed_field_scope),
    true
  ),
  updated_at = now()
FROM scope_candidates AS scope
WHERE policy.id = scope.id
  AND (
    scope.effective_purposes IS NULL
    OR scope.effective_fields IS NULL
    OR scope.snapshot_purposes IS NULL
    OR scope.snapshot_fields IS NULL
  );
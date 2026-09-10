-- Make the historical consent-free Project Agreement purpose explicit.
--
-- Only accepted agreements without a database value are eligible. A value
-- already present in either immutable policy representation wins; otherwise
-- the historical Leistungskoordination baseline is recorded only for
-- version-1 agreements. Newer versions without an explicit value and
-- non-accepted agreements are intentionally left unchanged.
ALTER TABLE coordination_policies
  ADD COLUMN IF NOT EXISTS baseline_purpose text;

WITH baseline_candidates AS (
  SELECT
    policy.id,
    COALESCE(
      NULLIF(policy.effective_policy ->> 'baselinePurpose', ''),
      NULLIF(policy.policy_snapshot ->> 'baselinePurpose', ''),
      CASE
        WHEN policy.version < 2 THEN 'LEISTUNGSKOORDINATION'
        ELSE NULL
      END
    ) AS baseline_purpose
  FROM coordination_policies AS policy
  WHERE policy.kind = 'PROJECT_AGREEMENT'
    AND policy.lifecycle_status = 'ACCEPTED'
    AND policy.baseline_purpose IS NULL
)
UPDATE coordination_policies AS policy
SET
  baseline_purpose = candidates.baseline_purpose,
  effective_policy = jsonb_set(
    COALESCE(policy.effective_policy, '{}'::jsonb),
    '{baselinePurpose}',
    to_jsonb(candidates.baseline_purpose),
    true
  ),
  policy_snapshot = jsonb_set(
    COALESCE(policy.policy_snapshot, '{}'::jsonb),
    '{baselinePurpose}',
    to_jsonb(candidates.baseline_purpose),
    true
  ),
  updated_at = now()
FROM baseline_candidates AS candidates
WHERE policy.id = candidates.id
  AND candidates.baseline_purpose IS NOT NULL;
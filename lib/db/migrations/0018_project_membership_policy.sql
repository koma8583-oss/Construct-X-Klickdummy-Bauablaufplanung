-- Separate project admission data from service/schedule coordination data.
ALTER TYPE data_product_type
  ADD VALUE IF NOT EXISTS 'PROJECT_MEMBERSHIP';

ALTER TABLE project_contractors
  ADD COLUMN IF NOT EXISTS coordination_policy_template_id text,
  ADD COLUMN IF NOT EXISTS coordination_policy_version integer;

INSERT INTO policy_templates (
  id,
  code,
  name,
  description,
  purpose,
  permissions,
  prohibitions,
  validity_rule,
  retention_rule,
  active
)
VALUES (
  'tk-policy-project-membership',
  'PROJECT_MEMBERSHIP',
  'Projektaufnahme',
  'Schlanke Projektaufnahme mit wenigen grundlegenden Projektinformationen.',
  'projectMembership',
  '["READ", "USE_AS_PROJECT_PARTNER"]'::jsonb,
  '["REDISTRIBUTE", "SHARE_OUTSIDE_PROJECT_TEAM", "DERIVE", "MODIFY", "COMMERCIAL_REUSE", "AI_TRAINING"]'::jsonb,
  'Ausschließlich für die Aufnahme der Organisation in das konkrete Projekt.',
  NULL,
  true
)
ON CONFLICT (code) DO UPDATE SET
  id = EXCLUDED.id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  purpose = EXCLUDED.purpose,
  permissions = EXCLUDED.permissions,
  prohibitions = EXCLUDED.prohibitions,
  validity_rule = EXCLUDED.validity_rule,
  retention_rule = EXCLUDED.retention_rule,
  active = EXCLUDED.active;

UPDATE project_contractors AS pc
SET
  coordination_policy_template_id = pt.id,
  coordination_policy_version = 4
FROM policy_templates AS pt
WHERE pt.code = 'SCHEDULE_COORDINATION'
  AND pt.active = true
  AND pc.coordination_policy_template_id IS NULL;
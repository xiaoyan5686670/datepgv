-- Data scope policies seed examples.
-- This file is optional for manual bootstrap.

-- Example 1: all province_manager users can only see Guangxi (replace mode)
INSERT INTO data_scope_policies
    (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
VALUES
    ('level', 'province_manager', 'province', '["广西"]'::jsonb, '[]'::jsonb, 'replace', 100, true, '省区经理默认仅广西（示例）', 'init-sql')
ON CONFLICT (subject_type, subject_key, dimension)
DO UPDATE SET
    allowed_values = EXCLUDED.allowed_values,
    deny_values = EXCLUDED.deny_values,
    merge_mode = EXCLUDED.merge_mode,
    priority = EXCLUDED.priority,
    enabled = EXCLUDED.enabled,
    note = EXCLUDED.note,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

-- Example 2: one role-wide policy
INSERT INTO data_scope_policies
    (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
VALUES
    ('role', 'province_executive', 'province', '["广西","广东"]'::jsonb, '[]'::jsonb, 'union', 200, false, '省总示例策略（默认关闭）', 'init-sql')
ON CONFLICT (subject_type, subject_key, dimension)
DO NOTHING;

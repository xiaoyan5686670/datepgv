-- Idempotent backfill from users profile fields to scope policies.
-- Safe to rerun.

INSERT INTO data_scope_policies
  (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
SELECT
  'user_id',
  CAST(u.id AS VARCHAR),
  'province',
  to_jsonb(ARRAY[u.province]),
  '[]'::jsonb,
  'replace',
  100,
  TRUE,
  'init-db baseline from users profile',
  'init-db'
FROM users u
WHERE COALESCE(TRIM(u.province), '') <> ''
ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING;

INSERT INTO data_scope_policies
  (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
SELECT
  'user_id',
  CAST(u.id AS VARCHAR),
  'region',
  to_jsonb(ARRAY[u.org_region]),
  '[]'::jsonb,
  'replace',
  110,
  TRUE,
  'init-db baseline from users profile',
  'init-db'
FROM users u
WHERE COALESCE(TRIM(u.org_region), '') <> ''
ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING;

INSERT INTO data_scope_policies
  (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
SELECT
  'user_id',
  CAST(u.id AS VARCHAR),
  'district',
  to_jsonb(ARRAY[u.district]),
  '[]'::jsonb,
  'replace',
  120,
  TRUE,
  'init-db baseline from users profile',
  'init-db'
FROM users u
WHERE COALESCE(TRIM(u.district), '') <> ''
ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING;

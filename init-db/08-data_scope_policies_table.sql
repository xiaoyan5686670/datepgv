-- Table for data scope policies (RAG / NL-SQL scope). Must run before 09_data_scope_policies.sql inserts.
-- Keep in sync with backend/app/core/migrations.py::_ensure_data_scope_policy_table.

CREATE TABLE IF NOT EXISTS data_scope_policies (
    id SERIAL PRIMARY KEY,
    subject_type VARCHAR(20) NOT NULL,
    subject_key VARCHAR(120) NOT NULL,
    dimension VARCHAR(32) NOT NULL,
    allowed_values JSONB NOT NULL DEFAULT '[]'::jsonb,
    deny_values JSONB NOT NULL DEFAULT '[]'::jsonb,
    merge_mode VARCHAR(16) NOT NULL DEFAULT 'union',
    priority INTEGER NOT NULL DEFAULT 100,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT NULL,
    updated_by VARCHAR(100) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_data_scope_policy_subject_dimension
        UNIQUE(subject_type, subject_key, dimension)
);

CREATE INDEX IF NOT EXISTS idx_data_scope_policies_subject
    ON data_scope_policies(subject_type, subject_key);

CREATE INDEX IF NOT EXISTS idx_data_scope_policies_dim_enabled
    ON data_scope_policies(dimension, enabled);

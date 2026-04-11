-- Legacy singleton table for NL→SQL execute URLs. Superseded by analytics_db_connections (see 14-analytics_db_connections.sql).
-- When columns are NULL, the app falls back to ANALYTICS_* / DATABASE_URL from environment.
CREATE TABLE IF NOT EXISTS analytics_db_settings (
    id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    postgres_url  TEXT,
    mysql_url     TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO analytics_db_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

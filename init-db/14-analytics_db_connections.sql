-- Multiple NL→SQL execute targets (Settings → 数据连接).
-- Migrates from legacy analytics_db_settings singleton if present, then drops it.

CREATE TABLE IF NOT EXISTS analytics_db_connections (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    engine       VARCHAR(20)  NOT NULL
        CHECK (engine IN ('postgresql', 'mysql')),
    url          TEXT         NOT NULL,
    is_default   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_db_conn_one_default_pg
    ON analytics_db_connections (engine)
    WHERE is_default AND engine = 'postgresql';

CREATE UNIQUE INDEX IF NOT EXISTS analytics_db_conn_one_default_mysql
    ON analytics_db_connections (engine)
    WHERE is_default AND engine = 'mysql';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'analytics_db_settings'
    ) THEN
        INSERT INTO analytics_db_connections (name, engine, url, is_default)
        SELECT
            'PostgreSQL（迁移）',
            'postgresql',
            TRIM(postgres_url),
            TRUE
        FROM analytics_db_settings
        WHERE id = 1
          AND postgres_url IS NOT NULL
          AND TRIM(postgres_url) <> '';

        INSERT INTO analytics_db_connections (name, engine, url, is_default)
        SELECT
            'MySQL（迁移）',
            'mysql',
            TRIM(mysql_url),
            TRUE
        FROM analytics_db_settings
        WHERE id = 1
          AND mysql_url IS NOT NULL
          AND TRIM(mysql_url) <> '';

        DROP TABLE analytics_db_settings;
    END IF;
END $$;

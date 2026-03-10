-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table metadata registry for RAG-based SQL generation
CREATE TABLE IF NOT EXISTS table_metadata (
    id            SERIAL PRIMARY KEY,
    db_type       VARCHAR(20) NOT NULL CHECK (db_type IN ('hive', 'postgresql')),
    database_name VARCHAR(200),
    schema_name   VARCHAR(200),
    table_name    VARCHAR(200) NOT NULL,
    table_comment TEXT,
    -- JSON array: [{name, type, comment, nullable, is_partition_key}]
    columns       JSONB NOT NULL DEFAULT '[]',
    -- Optional sample rows for additional context
    sample_data   JSONB,
    tags          TEXT[],
    -- text-embedding-3-small produces 1536-dim vectors
    embedding     vector(1536),
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- IVFFlat approximate vector index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS table_metadata_embedding_idx
    ON table_metadata
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Full-text search index on table/column names
CREATE INDEX IF NOT EXISTS table_metadata_name_idx
    ON table_metadata (db_type, database_name, table_name);

-- Chat history table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id         SERIAL PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id         SERIAL PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content    TEXT NOT NULL,
    sql_type   VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER table_metadata_updated_at
    BEFORE UPDATE ON table_metadata
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- LLM & Embedding configuration table
-- All provider settings are stored here; the application reads at runtime.
CREATE TABLE IF NOT EXISTS llm_configs (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    config_type  VARCHAR(20)  NOT NULL CHECK (config_type IN ('llm', 'embedding')),
    model        VARCHAR(200) NOT NULL,   -- LiteLLM model string, e.g. "gemini/gemini-2.0-flash"
    api_key      TEXT,                    -- stored as-is; masked in API responses
    api_base     VARCHAR(500),            -- optional custom endpoint (Ollama, proxies, etc.)
    extra_params JSONB        NOT NULL DEFAULT '{}',  -- temperature, dim, max_tokens, etc.
    is_active    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enforce at most one active config per type
CREATE UNIQUE INDEX IF NOT EXISTS llm_configs_active_idx
    ON llm_configs (config_type) WHERE is_active = TRUE;

CREATE TRIGGER llm_configs_updated_at
    BEFORE UPDATE ON llm_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Built-in presets (no API keys; users fill them in via the Settings UI)
INSERT INTO llm_configs (name, config_type, model, extra_params) VALUES
('GPT-4o (OpenAI)',          'llm',       'openai/gpt-4o',                   '{"temperature": 0.1}'),
('GPT-4o-mini (OpenAI)',     'llm',       'openai/gpt-4o-mini',              '{"temperature": 0.1}'),
('Gemini 2.0 Flash',         'llm',       'gemini/gemini-2.0-flash',          '{"temperature": 0.1}'),
('Gemini 1.5 Pro',           'llm',       'gemini/gemini-1.5-pro',            '{"temperature": 0.1}'),
('DeepSeek Coder V2',        'llm',       'deepseek/deepseek-coder',          '{"temperature": 0.1}'),
('Claude 3.5 Sonnet',        'llm',       'anthropic/claude-3-5-sonnet-20241022', '{"temperature": 0.1}'),
('Ollama (本地)',             'llm',       'ollama/qwen2.5-coder:32b',         '{"temperature": 0.1, "api_base": "http://localhost:11434"}'),
('text-embedding-3-small',   'embedding', 'openai/text-embedding-3-small',    '{"dim": 1536}'),
('text-embedding-3-large',   'embedding', 'openai/text-embedding-3-large',    '{"dim": 3072}'),
('Gemini text-embedding-004','embedding', 'gemini/text-embedding-004',        '{"dim": 768}'),
('Ollama nomic-embed-text',  'embedding', 'ollama/nomic-embed-text',          '{"dim": 768, "api_base": "http://localhost:11434"}');

-- Seed: example tables for demonstration
INSERT INTO table_metadata (db_type, database_name, schema_name, table_name, table_comment, columns, tags)
VALUES
(
    'hive', 'dw', NULL, 'ods_orders',
    '订单原始数据表，每日全量',
    '[
        {"name": "order_id",     "type": "STRING",    "comment": "订单唯一ID",       "nullable": false, "is_partition_key": false},
        {"name": "user_id",      "type": "STRING",    "comment": "用户ID",           "nullable": false, "is_partition_key": false},
        {"name": "product_id",   "type": "STRING",    "comment": "商品ID",           "nullable": false, "is_partition_key": false},
        {"name": "amount",       "type": "DECIMAL",   "comment": "订单金额（元）",   "nullable": false, "is_partition_key": false},
        {"name": "status",       "type": "STRING",    "comment": "订单状态: paid/pending/cancelled", "nullable": false, "is_partition_key": false},
        {"name": "created_time", "type": "TIMESTAMP", "comment": "下单时间",         "nullable": false, "is_partition_key": false},
        {"name": "dt",           "type": "STRING",    "comment": "分区日期 yyyyMMdd", "nullable": false, "is_partition_key": true}
    ]',
    ARRAY['ods', 'orders', 'transaction']
),
(
    'hive', 'dw', NULL, 'dim_user',
    '用户维度表，SCD Type 2',
    '[
        {"name": "user_id",     "type": "STRING",  "comment": "用户唯一ID",   "nullable": false, "is_partition_key": false},
        {"name": "username",    "type": "STRING",  "comment": "用户名",       "nullable": false, "is_partition_key": false},
        {"name": "department",  "type": "STRING",  "comment": "所属部门",     "nullable": true,  "is_partition_key": false},
        {"name": "city",        "type": "STRING",  "comment": "城市",         "nullable": true,  "is_partition_key": false},
        {"name": "register_dt", "type": "DATE",    "comment": "注册日期",     "nullable": false, "is_partition_key": false},
        {"name": "is_active",   "type": "BOOLEAN", "comment": "是否活跃用户", "nullable": false, "is_partition_key": false}
    ]',
    ARRAY['dim', 'user']
),
(
    'postgresql', 'analytics', 'public', 'sales_summary',
    '销售汇总分析表（每日聚合）',
    '[
        {"name": "summary_date", "type": "DATE",    "comment": "汇总日期",     "nullable": false, "is_partition_key": false},
        {"name": "department",   "type": "VARCHAR", "comment": "部门名称",     "nullable": false, "is_partition_key": false},
        {"name": "total_amount", "type": "NUMERIC", "comment": "当日销售总额", "nullable": false, "is_partition_key": false},
        {"name": "order_count",  "type": "INTEGER", "comment": "订单数量",     "nullable": false, "is_partition_key": false},
        {"name": "avg_amount",   "type": "NUMERIC", "comment": "平均客单价",   "nullable": true,  "is_partition_key": false}
    ]',
    ARRAY['dws', 'sales', 'aggregation']
);

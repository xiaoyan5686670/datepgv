-- ABAC RAG: document chunks with pgvector + hierarchy_path (JSONB array).
-- vector(N) must match backend EMBEDDING_DIM (default 1536); align .env if using other models.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_chunks (
    id              BIGSERIAL PRIMARY KEY,
    content         TEXT NOT NULL,
    embedding       vector(1536),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    hierarchy_path  JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_rag_chunks_hierarchy_path_is_array
        CHECK (jsonb_typeof(hierarchy_path) = 'array'),
    CONSTRAINT chk_rag_chunks_metadata_hierarchy_path
        CHECK (
            NOT (metadata ? 'hierarchy_path')
            OR jsonb_typeof(metadata->'hierarchy_path') = 'array'
        )
);

COMMENT ON TABLE rag_chunks IS 'RAG text chunks; hierarchy_path mirrors metadata.hierarchy_path for indexing';
COMMENT ON COLUMN rag_chunks.hierarchy_path IS 'JSON array of org path segments, e.g. ["北部大区","山西省","张三"]';

CREATE INDEX IF NOT EXISTS rag_chunks_hierarchy_path_gin
    ON rag_chunks USING gin (hierarchy_path jsonb_path_ops);

-- IVFFlat works on older pgvector; tune lists when row count grows.
CREATE INDEX IF NOT EXISTS rag_chunks_embedding_ivfflat_idx
    ON rag_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);

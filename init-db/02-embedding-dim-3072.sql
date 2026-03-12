-- Migration: change table_metadata.embedding from vector(1536) to vector(3072)
-- Use when you switch to a 3072-dim embedding model (e.g. OpenAI text-embedding-3-large).
-- Can be run from Settings UI (Embedding 向量维度) or manually. After running:
--   Restart the backend, then in Admin UI run "全部重新向量化".

-- Drop the vector index (required before altering the column)
DROP INDEX IF EXISTS table_metadata_embedding_idx;

-- Drop the old column and add new one (existing embeddings are lost; re-embed after)
ALTER TABLE table_metadata DROP COLUMN IF EXISTS embedding;
ALTER TABLE table_metadata ADD COLUMN embedding vector(3072);

-- pgvector IVFFlat supports at most 2000 dimensions; 3072 uses sequential scan (no index)
-- For 1536-dim you would add: CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- So backend reads 3072 on next startup (when using UI, API does this)
INSERT INTO app_settings (key, value) VALUES ('embedding_dim', '3072')
ON CONFLICT (key) DO UPDATE SET value = '3072';

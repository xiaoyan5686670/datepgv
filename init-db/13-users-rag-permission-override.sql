-- Admin-editable override for hierarchical RAG (rag_chunks) ABAC prefixes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS rag_permission_override JSONB NULL;

COMMENT ON COLUMN users.rag_permission_override IS
  'RAG 层级权限覆盖：{"unrestricted":true} 或 {"prefixes":[["大区","省",...], ...]}；NULL 表示按通讯录自动推导';

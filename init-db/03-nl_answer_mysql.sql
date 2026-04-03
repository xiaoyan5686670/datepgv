-- NL answer + MySQL catalog support (run on existing DBs)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS generated_sql TEXT;

-- 01-init.sql 的内联 CHECK 在 PostgreSQL 中名为 table_metadata_db_type_check，不是 db_type_check
ALTER TABLE table_metadata DROP CONSTRAINT IF EXISTS table_metadata_db_type_check;
ALTER TABLE table_metadata DROP CONSTRAINT IF EXISTS db_type_check;
ALTER TABLE table_metadata ADD CONSTRAINT db_type_check
  CHECK (db_type IN ('hive', 'postgresql', 'oracle', 'mysql'));

-- 允许 table_metadata.db_type 为 mysql / oracle（与代码、DDL 导入一致）。
-- 若只跑过旧版 01-init.sql，内联约束名为 table_metadata_db_type_check，需执行本脚本。
-- 可安全重复执行。

ALTER TABLE table_metadata DROP CONSTRAINT IF EXISTS table_metadata_db_type_check;
ALTER TABLE table_metadata DROP CONSTRAINT IF EXISTS db_type_check;
ALTER TABLE table_metadata ADD CONSTRAINT db_type_check
  CHECK (db_type IN ('hive', 'postgresql', 'oracle', 'mysql'));

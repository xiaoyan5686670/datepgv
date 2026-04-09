-- 用户表：大区字段（与通讯录 daqua 对齐，便于展示与筛选）
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_region VARCHAR(100) NULL;

COMMENT ON COLUMN users.org_region IS '大区(daqua)，来自业务经理通讯录同步';

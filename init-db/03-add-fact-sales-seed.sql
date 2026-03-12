-- 若你此前已执行过 01-init.sql（且当时没有 fact_sales 种子），
-- 可单独执行本脚本以补充 fact_sales，无需重跑整份 01-init.sql 造成重复插入。
INSERT INTO table_metadata (db_type, database_name, schema_name, table_name, table_comment, columns, tags)
SELECT
    'hive', 'dw', NULL, 'fact_sales',
    '销售事实表',
    '[
        {"name": "order_id",   "type": "STRING",  "comment": "订单ID",     "nullable": false, "is_partition_key": false},
        {"name": "product_id", "type": "STRING",  "comment": "商品ID",     "nullable": false, "is_partition_key": false},
        {"name": "user_id",    "type": "STRING",  "comment": "用户ID",     "nullable": false, "is_partition_key": false},
        {"name": "amount",     "type": "DECIMAL", "comment": "销售金额",   "nullable": false, "is_partition_key": false},
        {"name": "sale_date",  "type": "DATE",    "comment": "销售日期",   "nullable": false, "is_partition_key": false},
        {"name": "dt",         "type": "STRING",  "comment": "分区日期",   "nullable": false, "is_partition_key": true}
    ]'::jsonb,
    ARRAY['fact', 'sales', 'dw']
WHERE NOT EXISTS (
    SELECT 1 FROM table_metadata
    WHERE db_type = 'hive' AND database_name = 'dw' AND table_name = 'fact_sales'
);

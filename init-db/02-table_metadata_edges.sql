-- Schema graph: edges between table_metadata rows for RAG graph expansion.
-- Run after 01-init.sql on existing databases: psql ... -f init-db/02-table_metadata_edges.sql

CREATE TABLE IF NOT EXISTS table_metadata_edges (
    id                 SERIAL PRIMARY KEY,
    from_metadata_id   INTEGER NOT NULL REFERENCES table_metadata (id) ON DELETE CASCADE,
    to_metadata_id     INTEGER NOT NULL REFERENCES table_metadata (id) ON DELETE CASCADE,
    relation_type      VARCHAR(32) NOT NULL
        CHECK (relation_type IN ('foreign_key', 'logical', 'coquery')),
    from_column        VARCHAR(200),
    to_column          VARCHAR(200),
    note               TEXT,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (from_metadata_id <> to_metadata_id),
    CONSTRAINT table_metadata_edges_unique_triple
        UNIQUE (from_metadata_id, to_metadata_id, relation_type)
);

CREATE INDEX IF NOT EXISTS table_metadata_edges_from_idx
    ON table_metadata_edges (from_metadata_id);
CREATE INDEX IF NOT EXISTS table_metadata_edges_to_idx
    ON table_metadata_edges (to_metadata_id);
CREATE INDEX IF NOT EXISTS table_metadata_edges_endpoints_idx
    ON table_metadata_edges (from_metadata_id, to_metadata_id);

-- Demo: link seed Hive tables ods_orders <-> dim_user (user_id)
INSERT INTO table_metadata_edges (
    from_metadata_id, to_metadata_id, relation_type, from_column, to_column, note
)
SELECT f.id, t.id, 'foreign_key', 'user_id', 'user_id', '订单事实关联用户维度'
FROM table_metadata f
INNER JOIN table_metadata t
    ON f.db_type = t.db_type
   AND f.db_type = 'hive'
   AND f.table_name = 'ods_orders'
   AND t.table_name = 'dim_user'
WHERE NOT EXISTS (
    SELECT 1
    FROM table_metadata_edges e
    WHERE e.from_metadata_id = f.id
      AND e.to_metadata_id = t.id
      AND e.relation_type = 'foreign_key'
);

# 图数据库 Schema 设计 (基于 PostgreSQL + Doris)

由于当前业务主库为 PostgreSQL，数据仓库/分析库为 Doris，我们将需要维护的复杂关系抽取到图数据库中。

## 1. 实体 (Nodes)
在图数据库中，我们不需要存储所有的业务字段，只需要存储 ID、类型以及用于快速过滤的少量索引字段。详细数据依然从 PostgreSQL 或 Doris 中获取。

### 示例节点类型：
*   **User (用户)**
    *   `id`: 唯一标识 (对应 PostgreSQL `users.id`)
    *   `status`: 用户状态 (用于过滤)
*   **Product (产品)**
    *   `id`: 唯一标识 (对应 PostgreSQL `products.id`)
    *   `category_id`: 分类ID
*   **Organization (组织/部门)**
    *   `id`: 唯一标识 (对应 PostgreSQL `organizations.id`)
    *   `level`: 组织层级

## 2. 关系 (Edges)
将 PostgreSQL 中的外键关联和多对多中间表转换为图数据库的边。

### 示例关系类型：
*   **(User)-[:BELONGS_TO]->(Organization)**
    *   属性：`join_date` (加入时间)
*   **(Organization)-[:PARENT_OF]->(Organization)**
    *   说明：解决 PostgreSQL 中无限极分类/树形结构的递归查询痛点。
*   **(User)-[:PURCHASED]->(Product)**
    *   属性：`order_id` (订单ID), `purchase_date` (购买时间), `amount` (金额)
*   **(User)-[:REFERRED]->(User)**
    *   说明：解决用户邀请、社交裂变等复杂网络关系。

## 3. 架构建议：PostgreSQL Apache AGE 插件 (可选)
既然主库已经是 PostgreSQL，强烈建议评估 **Apache AGE** 插件。
*   **优势**：直接在 PostgreSQL 中运行 Cypher 查询，无需额外部署 Neo4j，无需处理复杂的数据同步 (CDC)，避免了分布式事务和数据一致性问题。
*   **如果坚持使用独立图库 (Neo4j)**：则需要通过 Debezium 监听 PostgreSQL 的 WAL 日志，将变更同步到 Neo4j。

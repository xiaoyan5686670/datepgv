# 核心查询接口重构对比 (PostgreSQL vs Neo4j)

## 业务场景：查询用户的多级下属网络 (社交裂变/组织架构)

### 1. 原始方案：PostgreSQL 递归查询 (Recursive CTE)
在 PostgreSQL 中，查询某个用户的所有下级、下级的下级（无限极分类），通常使用 `WITH RECURSIVE` 语法。

```sql
-- PostgreSQL Recursive CTE 示例
WITH RECURSIVE subordinates AS (
    -- 基础查询：查找直接下属
    SELECT id, parent_id, 1 AS depth
    FROM users
    WHERE parent_id = 12345 -- 假设查询用户ID为12345
    
    UNION ALL
    
    -- 递归查询：查找下属的下属
    SELECT u.id, u.parent_id, s.depth + 1
    FROM users u
    INNER JOIN subordinates s ON u.parent_id = s.id
    WHERE s.depth < 5 -- 限制最大深度防止死循环
)
SELECT id, depth FROM subordinates;
```
**痛点**：随着层级加深和数据量增大，递归查询会导致大量的表扫描，性能急剧下降。

### 2. 重构方案：Neo4j Cypher 图查询
在图数据库中，这种查询是原生的，利用图遍历算法，性能极高。

```cypher
// Neo4j Cypher 示例
MATCH (u:User {id: 12345})-[:REFERRED*1..5]->(sub:User)
RETURN sub.id AS id, length(path) AS depth
ORDER BY depth;
```
**优势**：
1. **语法简洁**：一行代码解决复杂的递归 JOIN。
2. **性能优越**：图数据库的底层存储结构决定了关系遍历的时间复杂度与整个图的大小无关，只与遍历的深度和分支数有关（Index-free adjacency）。

### 3. 应用层代码重构 (Python 示例)
```python
from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password123"))

def get_subordinates(user_id, max_depth=5):
    query = """
    MATCH p=(u:User {id: $user_id})-[:REFERRED*1..$max_depth]->(sub:User)
    RETURN sub.id AS id, length(p) AS depth
    ORDER BY depth
    """
    with driver.session() as session:
        result = session.run(query, user_id=user_id, max_depth=max_depth)
        # 获取ID列表后，再去 Doris/PostgreSQL 中批量查询详细信息 (结果聚合)
        subordinate_ids = [record["id"] for record in result]
        return subordinate_ids

# 性能对比测试：
# 1. 记录 PostgreSQL Recursive CTE 耗时
# 2. 记录 Neo4j Cypher 耗时
# 3. 记录 Neo4j + Doris (通过ID批量查询详情) 总耗时
```

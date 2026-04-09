-- 1. 加载 AGE 插件
CREATE EXTENSION IF NOT EXISTS age;

-- 2. 将 age 命名空间添加到 search_path 中
SET search_path = ag_catalog, "$user", public;

-- 3. 创建一个图数据库实例（名为 my_graph）
SELECT create_graph('my_graph');

-- 4. 验证图是否创建成功
SELECT * FROM ag_graph;

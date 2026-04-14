# 用户提问统计 — 二期：语义聚类（设计草案）

一期在 [`backend/app/services/chat_query_stats.py`](../backend/app/services/chat_query_stats.py) 使用**确定性归一化**（空白折叠 + 小写）聚合高频问法，成本低、可解释，但无法合并「语义相同、措辞不同」的问题。

## 目标

- 将大量用户提问归并为**主题簇**（例如「近七天销售额」「近 7 日销售额」合并）。
- 管理端展示：**簇 ID、代表问法、簇内提问次数、簇内用户数（可选）**。
- 个人端展示：仅包含当前用户提问的簇统计（或过滤）。

## 数据流（建议）

1. **候选抽取**：从一期结果中取 Top-N `normalized_key` 或按时间窗全量去重后的代表句。
2. **向量化**：调用现有 [`EmbeddingService`](../backend/app/services/embedding.py) 对代表句生成向量（维度与 `EMBEDDING_DIM` / 库表一致）。
3. **聚类 / 近邻**：
   - 轻量：pgvector 上 `IVFFlat` / `HNSW` 近邻，阈值合并（贪心或 union-find）。
   - 或离线：MiniBatchKMeans / HDBSCAN（需 Python 任务进程）。
4. **持久化**（新表草案）：
   - `query_clusters(id, label, centroid_embedding, created_at, algorithm_version)`
   - `query_cluster_members(cluster_id, normalized_key, sample_question, first_seen_at, last_seen_at, total_count)`
5. **刷新策略**：每日批任务 + 管理端「重新聚类」按钮（admin）。

## 权限与隐私

- 聚类输入尽量使用**已归一化文本**；若存原文片段，需与一期相同的截断与访问控制。
- 可配置「仅聚合指纹（hash）」模式以减少敏感原文留存。

## 与一期 API 的关系

- 一期 `GET /api/v1/stats/chat-queries/me` 与 admin 全局接口保持不变。
- 二期新增例如 `GET /api/v1/stats/chat-query-clusters`（admin）与 `.../me` 用户过滤视图。

"""
RAG engine – retrieves relevant table schemas from pgvector,
then builds a structured prompt for the LLM.
"""
from __future__ import annotations

import json
from itertools import combinations
from typing import Any, Literal

import networkx as nx
from sqlalchemy import or_, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.metadata import TableMetadata, TableMetadataEdge
from app.services.embedding import EmbeddingService

SQLType = Literal["hive", "postgresql", "oracle", "mysql"]
RetrieveSQLType = Literal["hive", "postgresql", "oracle", "mysql", "all"]

HIVE_RULES = """
Hive SQL 规范：
- 必须使用分区裁剪（WHERE dt = '...' 或 WHERE dt BETWEEN ...）
- 禁止不带分区条件的全表扫描
- 使用 INSERT OVERWRITE ... PARTITION(...) 写入分区表
- 日期函数使用 date_format / date_add / datediff
- 字符串拼接使用 concat()
- 不支持 LIMIT OFFSET，使用 ROW_NUMBER() OVER(...)
- JOIN 时大表放左侧，使用 /*+ MAPJOIN(small_table) */ hint 优化小表
""".strip()

POSTGRESQL_RULES = """
PostgreSQL 规范：
- 优先使用 CTE（WITH ... AS (...)）提升可读性
- NULL 处理：使用 COALESCE / NULLIF
- 日期函数：DATE_TRUNC / TO_CHAR / EXTRACT
- 使用 LIMIT / OFFSET 分页
- 窗口函数：ROW_NUMBER() / LAG() / LEAD() / SUM() OVER(...)
      - 避免 SELECT *，明确列出字段
""".strip()

ORACLE_RULES = """
Oracle SQL 规范：
- 使用双引号区分大小写标识符，推荐统一使用大写不加引号
- 日期时间类型通常为 DATE 或 TIMESTAMP，使用 TO_DATE / TO_TIMESTAMP / TO_CHAR 进行转换
- 字符串拼接使用 || 运算符
- 推荐使用 OFFSET ... ROWS FETCH NEXT ... ROWS ONLY 或 ROWNUM 进行分页
- 支持丰富的窗口函数：ROW_NUMBER() / LAG() / LEAD() / RANK() 等
- 避免 SELECT *，明确列出字段
""".strip()


MYSQL_RULES = """
MySQL 5.x 规范：
- 标识符必要时使用反引号 `，避免与保留字冲突
- 日期/时间：DATE_FORMAT、STR_TO_DATE、YEAR/MONTH/DAY、CURDATE()
- 分组与时间截断：DATE_FORMAT(dt, '%Y-%m') 等（避免依赖 MySQL 8 专属函数）
- 使用 LIMIT / OFFSET 分页
- 窗口函数在 MySQL 8+ 可用；在 MySQL 5.7 及以下请用变量或子查询替代 ROW_NUMBER
- NULL 处理：IFNULL / COALESCE；避免 SELECT *
""".strip()


def _table_column_names_lower(row: TableMetadata) -> set[str]:
    return {
        str(c["name"]).lower()
        for c in (row.columns or [])
        if c.get("name")
    }


def _join_columns_for_path_step(
    u_id: int,
    v_id: int,
    u_table: TableMetadata,
    v_table: TableMetadata,
    cond: dict[str, Any],
) -> tuple[str, str]:
    """
    Map edge from_column/to_column to this undirected step (u -> v) so each column
    attaches to the correct physical table. If the edge was saved with swapped
    names, pick the (u_col,v_col) pair that exists in metadata.
    """
    fc = (cond.get("from_column") or "").strip() or "id"
    tc = (cond.get("to_column") or "").strip() or "id"
    ef = cond.get("endpoint_from")
    et = cond.get("endpoint_to")
    uset = _table_column_names_lower(u_table)
    vset = _table_column_names_lower(v_table)

    candidates: list[tuple[str, str]] = []
    if ef is not None and et is not None and {u_id, v_id} == {int(ef), int(et)}:
        if u_id == int(ef) and v_id == int(et):
            candidates = [(fc, tc), (tc, fc)]
        elif u_id == int(et) and v_id == int(ef):
            candidates = [(tc, fc), (fc, tc)]
        else:
            candidates = [(fc, tc)]
    else:
        candidates = [(fc, tc), (tc, fc)]

    for uc, vc in candidates:
        if uc.lower() in uset and vc.lower() in vset:
            return uc, vc
    return candidates[0]


def _format_table_schema(row: TableMetadata) -> str:
    """Convert a TableMetadata row to a human-readable schema block."""
    full_name = ".".join(
        filter(None, [row.database_name, row.schema_name, row.table_name])
    )
    lines = [f"### 表: {full_name}  [类型: {row.db_type}]"]
    if row.table_comment:
        lines.append(f"说明: {row.table_comment}")

    cols: list[dict[str, Any]] = row.columns or []
    if cols:
        lines.append("字段:")
        for c in cols:
            nullable = "" if c.get("nullable", True) else " NOT NULL"
            partition = " [分区键]" if c.get("is_partition_key") else ""
            comment = f"  -- {c['comment']}" if c.get("comment") else ""
            lines.append(f"  {c['name']}  {c['type']}{nullable}{partition}{comment}")

    if row.sample_data:
        sample_str = json.dumps(row.sample_data[:3], ensure_ascii=False)
        lines.append(f"示例数据(前3行): {sample_str}")

    return "\n".join(lines)


def _schemas_joined_length(tables: list[TableMetadata]) -> int:
    if not tables:
        return 0
    sep = 2  # matches "\n\n".join in build_prompt
    return sum(len(_format_table_schema(t)) for t in tables) + (len(tables) - 1) * sep


def _trim_tables_to_schema_budget(
    seeds: list[TableMetadata],
    extras: list[TableMetadata],
    max_chars: int,
) -> list[TableMetadata]:
    """Keep all seeds that fit, then extras in order, capped by approximate schema chars."""
    if max_chars <= 0:
        return seeds[:1] if seeds else []

    def trim_head(tables: list[TableMetadata]) -> list[TableMetadata]:
        out: list[TableMetadata] = []
        acc = 0
        for t in tables:
            piece = len(_format_table_schema(t)) + (2 if out else 0)
            if acc + piece > max_chars:
                break
            out.append(t)
            acc += piece
        return out

    seed_len = _schemas_joined_length(seeds)
    if seed_len > max_chars:
        return trim_head(seeds)

    acc = seed_len
    kept_extras: list[TableMetadata] = []
    for t in extras:
        piece = len(_format_table_schema(t)) + 2
        if acc + piece > max_chars:
            break
        kept_extras.append(t)
        acc += piece
    return seeds + kept_extras


class RAGEngine:
    def __init__(self, db: AsyncSession, embedding_service: EmbeddingService) -> None:
        self.db = db
        self.embedding_service = embedding_service

    async def retrieve(
        self,
        query: str,
        sql_type: RetrieveSQLType,
        top_k: int | None = None,
        *,
        expand_graph: bool | None = None,
    ) -> tuple[list[TableMetadata], list[dict]]:
        """
        Embed the query and perform cosine similarity search in pgvector.
        Falls back to keyword search when no embedding is available.
        Optionally expands along table_metadata_edges using NetworkX shortest paths.
        Returns: (tables, join_paths)
        """
        k = top_k or settings.RAG_TOP_K
        query_vec = await self.embedding_service.embed(query, self.db)

        stmt = (
            select(TableMetadata)
            .order_by(
                TableMetadata.embedding.cosine_distance(query_vec)
            )
            .limit(k)
        )

        # Optionally filter by db_type
        if sql_type != "all":
            stmt = stmt.where(TableMetadata.db_type == sql_type)

        # Only rows that have embeddings
        stmt = stmt.where(TableMetadata.embedding.is_not(None))

        result = await self.db.execute(stmt)
        rows = result.scalars().all()

        # If few results, supplement with unembedded rows via keyword search
        if len(rows) < k:
            rows = await self._keyword_fallback(query, sql_type, k, rows)

        out = list(rows)
        join_paths = []
        use_expand = (
            settings.RAG_GRAPH_EXPAND_ENABLED if expand_graph is None else expand_graph
        )
        if use_expand and out:
            try:
                out, join_paths = await self._expand_graph_context(out, sql_type)
            except ProgrammingError:
                # e.g. table_metadata_edges not migrated yet — keep vector hits only
                await self.db.rollback()
        return out, join_paths

    async def _build_nx_graph(self, sql_type: RetrieveSQLType) -> nx.Graph:
        """Load edges from database and build a NetworkX in-memory graph."""
        G = nx.Graph()
        stmt = select(TableMetadataEdge)
        result = await self.db.execute(stmt)
        edges = result.scalars().all()
        for e in edges:
            G.add_edge(
                e.from_metadata_id,
                e.to_metadata_id,
                relation_type=e.relation_type,
                from_column=e.from_column,
                to_column=e.to_column,
                note=e.note,
                endpoint_from=e.from_metadata_id,
                endpoint_to=e.to_metadata_id,
            )
        return G

    def _format_join_paths(
        self, join_paths: list[dict], loaded_map: dict[int, TableMetadata]
    ) -> list[str]:
        formatted = []
        for path in join_paths:
            u = path["from"]
            v = path["to"]
            cond = path["condition"]
            u_table = loaded_map.get(u)
            v_table = loaded_map.get(v)
            if not u_table or not v_table:
                continue
            u_name = u_table.table_name
            v_name = v_table.table_name
            u_col, v_col = _join_columns_for_path_step(
                u, v, u_table, v_table, cond
            )
            note = cond.get("note") or ""
            note_str = f" (业务含义: {note})" if note else ""
            formatted.append(
                f"{u_name} JOIN {v_name} ON {u_name}.{u_col} = {v_name}.{v_col}{note_str}"
            )
        return formatted

    async def _load_metadata_map(
        self, ids: list[int], sql_type: RetrieveSQLType
    ) -> dict[int, TableMetadata]:
        if not ids:
            return {}
        stmt = select(TableMetadata).where(TableMetadata.id.in_(ids))
        if sql_type != "all":
            stmt = stmt.where(TableMetadata.db_type == sql_type)
        result = await self.db.execute(stmt)
        return {r.id: r for r in result.scalars().all()}

    async def _expand_graph_context(
        self,
        seeds: list[TableMetadata],
        sql_type: RetrieveSQLType,
    ) -> tuple[list[TableMetadata], list[str]]:
        """
        Use NetworkX to calculate shortest paths between seed tables,
        recall intermediate tables, and extract join conditions.
        Returns: (tables, formatted_join_paths)
        """
        max_tables = max(1, settings.RAG_GRAPH_MAX_TABLES)
        max_chars = max(0, settings.RAG_GRAPH_MAX_SCHEMA_CHARS)

        trimmed_seeds = seeds[:max_tables]
        if not trimmed_seeds:
            return [], []

        G = await self._build_nx_graph(sql_type)
        seed_ids = [t.id for t in trimmed_seeds]
        
        nodes_to_fetch = set(seed_ids)
        join_paths = []

        if len(seed_ids) >= 2:
            for source, target in combinations(seed_ids, 2):
                if nx.has_path(G, source, target):
                    path = nx.shortest_path(G, source=source, target=target)
                    nodes_to_fetch.update(path)
                    for i in range(len(path) - 1):
                        u, v = path[i], path[i+1]
                        edge_data = G.get_edge_data(u, v)
                        join_paths.append({
                            "from": u,
                            "to": v,
                            "condition": edge_data
                        })
        else:
            source = seed_ids[0]
            if source in G:
                neighbors = list(G.neighbors(source))[:3]
                nodes_to_fetch.update(neighbors)
                for n in neighbors:
                    join_paths.append({
                        "from": source,
                        "to": n,
                        "condition": G.get_edge_data(source, n)
                    })

        loaded_map = await self._load_metadata_map(list(nodes_to_fetch), sql_type)
        
        final_tables = [loaded_map[sid] for sid in seed_ids if sid in loaded_map]
        extras_ordered = []
        for nid in nodes_to_fetch:
            if nid not in seed_ids and nid in loaded_map:
                extras_ordered.append(loaded_map[nid])
                
        formatted_paths = self._format_join_paths(join_paths, loaded_map)
        
        # Ensure we respect schema budget
        final_tables = _trim_tables_to_schema_budget(final_tables, extras_ordered, max_chars)

        return final_tables, formatted_paths

    async def _keyword_fallback(
        self,
        query: str,
        sql_type: str,
        k: int,
        existing: list[TableMetadata],
    ) -> list[TableMetadata]:
        existing_ids = {r.id for r in existing}
        stmt = select(TableMetadata).where(
            TableMetadata.id.not_in(existing_ids) if existing_ids else text("1=1")
        )
        if sql_type != "all":
            stmt = stmt.where(TableMetadata.db_type == sql_type)
        stmt = stmt.limit(k - len(existing))
        result = await self.db.execute(stmt)
        extras = result.scalars().all()
        return existing + list(extras)

    def build_prompt(
        self,
        query: str,
        tables: list[TableMetadata],
        sql_type: SQLType,
        join_paths: list[str] | None = None,
    ) -> list[dict[str, str]]:
        """Construct the messages list for the LLM."""
        if sql_type == "hive":
            rules = HIVE_RULES
        elif sql_type == "postgresql":
            rules = POSTGRESQL_RULES
        elif sql_type == "mysql":
            rules = MYSQL_RULES
        else:
            rules = ORACLE_RULES

        schemas = "\n\n".join(_format_table_schema(t) for t in tables)
        
        path_str = ""
        if join_paths:
            path_str = "\n\n已知表之间的关联路径参考：\n" + "\n".join(f"- {p}" for p in join_paths)

        system_prompt = f"""你是一个专业的数据仓库工程师，只生成 {sql_type.upper()} SQL。

{rules}

严格要求（违反则视为错误）：
- 所有 SELECT / WHERE / GROUP BY / ORDER BY / HAVING 以及 JOIN ON 条件中出现的「列名」，必须逐字来自下方「可用的表结构」中列出的字段名；禁止根据中文含义翻译、缩写或拼音造列名（例如不要用臆造的 renyuanbianma 代替实际字段名）。
- 若「已知表之间的关联路径参考」给出了 JOIN ON 条件，应优先采用这些 ON 条件连接表，不要改用未在表结构中出现的列去关联。
- 若无法只用已给出的字段完成查询，不要编造列名：请返回仅含注释的 SQL（如 -- 缺少某某业务字段，元数据中无对应列）说明原因，不要生成会在数据库上报 Unknown column 的语句。

只返回 SQL 代码块（```sql ... ```），不要任何额外解释。"""

        user_prompt = f"""可用的表结构：

{schemas}{path_str}

---
用户需求：{query}

请生成 {sql_type.upper()} SQL（列名必须与上表完全一致）："""

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

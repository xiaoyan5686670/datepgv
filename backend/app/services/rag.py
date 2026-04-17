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
from app.models.user import User
from app.services.embedding import EmbeddingService
from app.services.sql_skill_service import (
    SQLSkill,
    list_skill_descriptions,
    render_loaded_skills,
)
from app.services.viewer_sql_context import build_viewer_sql_context

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
- 【重要】标识符（表名、列名、别名）若可能与保留字（如 ALL, USER, DESC）冲突，必须使用双引号 " 包裹。
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
- 【重要】标识符（表名、列名、别名）必要时、或可能与保留字（如 ALL, DESC, ORDER, GROUP, SELECT）冲突时，必须使用反引号 ` 包裹。
- 日期/时间：DATE_FORMAT、STR_TO_DATE、YEAR/MONTH/DAY、CURDATE()
- 分组与时间截断：DATE_FORMAT(dt, '%Y-%m') 等（避免依赖 MySQL 8 专属函数）
- 使用 LIMIT / OFFSET 分页
- 窗口函数在 MySQL 8+ 可用；在 MySQL 5.7 及以下请用变量或子查询替代 ROW_NUMBER
- NULL 处理：IFNULL / COALESCE；避免 SELECT *
- 【重要·类型安全】在 IFNULL / COALESCE 中，默认值的类型必须与字段类型一致。
  对于数值型字段，必须写 IFNULL(col, 0)（不带引号），禁止写 IFNULL(col, '0')（带引号的字符串）。
  错误示例：SUM(IFNULL(amount, '0'))  ← 会导致 Doris/StarRocks 报 "sum requires a numeric parameter"
  正确示例：SUM(IFNULL(amount, 0))    ← 无引号的数值
  若需确保类型安全，可用 CAST：SUM(CAST(IFNULL(amount, 0) AS DECIMAL(20,2)))
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


def qualified_table_label(row: TableMetadata) -> str:
    """Fully qualified name as in SQL (database.schema.table), for prompts and JOIN hints."""
    parts = [row.database_name, row.schema_name, row.table_name]
    return ".".join(p for p in parts if p and str(p).strip()) or row.table_name


def _format_table_schema(row: TableMetadata) -> str:
    """Convert a TableMetadata row to a human-readable schema block."""
    full_name = qualified_table_label(row)
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
            u_name = qualified_table_label(u_table)
            v_name = qualified_table_label(v_table)
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
        # Vector hits may include tables with no row in table_metadata_edges; those IDs
        # are otherwise absent from G, and nx.has_path / shortest_path raise NodeNotFound.
        G.add_nodes_from(seed_ids)

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
        current_user: User | None = None,
        selected_skills: list[SQLSkill] | None = None,
        available_skills: list[SQLSkill] | None = None,
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
        skill_descriptions = "\n".join(list_skill_descriptions(available_skills or []))
        loaded_skills = render_loaded_skills(selected_skills or [])
        loaded_skills_block = (
            f"\n\n已加载技能详情：\n{loaded_skills}" if loaded_skills else ""
        )
        
        path_str = ""
        if join_paths:
            path_str = "\n\n已知表之间的关联路径参考：\n" + "\n".join(f"- {p}" for p in join_paths)

        viewer_block = ""
        if current_user is not None:
            viewer_block = (
                "\n---\n【当前登录用户与数据范围（服务端注入，须遵守）】\n"
                f"{build_viewer_sql_context(current_user)}\n"
            )

        system_prompt = f"""你是一个专业的数据仓库工程师，不仅可以回答用户关于数据库有哪些表、数据结构的问题，也能根据需求生成 {sql_type.upper()} SQL 查询。

{rules}

可用技能（按需加载）：
{skill_descriptions}

请优先遵守已加载技能中的规则；若未加载任何技能，则仅按通用规则与表结构生成。
{loaded_skills_block}

严格要求：
- 如果用户的请求是查询具体数据，请仅返回 SQL 代码块（```sql ... ```），并且不要附加任何额外解释。
- 生成的 SQL 代码块中【禁止】包含分号 `;`（尤其是在 SQL 末尾或注释中）；不要写多条语句。
- 避免在 SQL 中编写冗长的注释（尤其是在每行末尾），以免干扰解析。
- SQL 中的「表名」与「列名」必须严格依据下方「可用的表结构」；严禁臆造、严禁拼音内联、严禁翻译字段名。
- 如果请求的指标或维度在「可用的表结构」中不存在，请直接在 SQL 注释中说明并尝试寻找最接近的替代字段，切勿自行发明字段名。
- 若字段名是 SQL 保留字（如 ALL, SELECT, DESC, FROM, CASE 等），在 SQL 中引用该字段时【必须】使用对应方言的引用符号（如 MySQL 的反引号 `）包裹。
- 若「已知表之间的关联路径参考」给出了 JOIN ON 条件，应优先采用这些 ON 条件连接表。
- 对于地区（省份、城市）、名称、部门等维度过滤：
  - 省份维度【禁止】使用 LIKE 模糊匹配与 LIKE 关联（例如 `PROV_NAME LIKE '%广西%'` 或 `A.PROV_NAME LIKE CONCAT('%', B.shengfen, '%')`）。
  - 省份必须使用等值方式（`=` / `IN`）并优先采用规范值（如“广西壮族自治区”）或已知同义值集合（如“广西壮族自治区”与“广西”）。
  - 仅非省份文本字段可按需使用 LIKE（如人员备注、自由文本）。
- 如果用户的请求是宽泛的问答（例如“我可以查哪些数据”、“解释一下表的意思”）、打招呼，或者仅仅询问表结构，请直接用易于阅读的「自然语言」回答，并在回答中综合参考下方的「可用的表结构」。此种情况【不要】生成任何 SQL 语句。
- 【特别强调】严禁输出任何 Markdown 代码块之外的解释文字，除非是在进行「非 SQL 生成」的问答。如果是生成 SQL，仅输出一个代码块即可。
若无需生成SQL，请直接输出中文文本即可。"""

        user_prompt = f"""【参考信息：可用的表结构】
{schemas}{path_str}{viewer_block}---
【用户需求】
{query}

请根据以上指南响应："""

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

"""
Hierarchical vector search over rag_chunks with JSONB hierarchy_path @> filter (ABAC).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import sqlglot
from sqlglot import exp
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.rag_abac import UserPermission
from app.services.embedding import EmbeddingService

logger = logging.getLogger(__name__)


def _audit_sql_for_execution(sql: str, params: dict[str, Any]) -> None:
    """Replace :binds with safe literals so sqlglot can parse the final shape."""
    s = sql
    for key, val in params.items():
        placeholder = f":{key}"
        if key == "qv":
            s = s.replace(placeholder, f"CAST('[0]' AS vector({settings.EMBEDDING_DIM}))")
        elif key.startswith("p") and isinstance(val, str):
            s = s.replace(placeholder, "'[]'::jsonb")
        elif key == "k":
            s = s.replace(placeholder, str(int(val)))
        else:
            s = s.replace(placeholder, "NULL")
    try:
        tree = sqlglot.parse_one(s, read="postgres")
    except sqlglot.errors.ParseError:
        # pgvector casts are not always in sqlglot grammar; fall back to lenient check
        s2 = re.sub(
            r"<=>[\s]*CAST\([^)]+\)",
            "<=> NULL",
            s,
            flags=re.IGNORECASE,
        )
        try:
            tree = sqlglot.parse_one(s2, read="postgres")
        except sqlglot.errors.ParseError as e2:
            logger.exception("sqlglot parse failed for RAG search SQL audit")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="RAG SQL 结构校验失败",
            ) from e2

    if not isinstance(tree, exp.Select):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RAG SQL 结构校验失败：根节点必须为 SELECT",
        )
    if tree.find(exp.Union):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RAG SQL 结构校验失败：禁止 UNION",
        )
    if tree.find(exp.Insert) or tree.find(exp.Update) or tree.find(exp.Delete):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RAG SQL 结构校验失败：仅允许只读查询",
        )


async def hierarchical_vector_search(
    db: AsyncSession,
    embedding_service: EmbeddingService,
    query: str,
    permission: UserPermission,
    top_k: int | None = None,
) -> list[dict[str, Any]]:
    """
    Embed ``query`` and return top similar rag_chunks rows enforcing hierarchy_path @> prefixes.
    """
    k = top_k if top_k is not None else settings.RAG_TOP_K
    dim = int(settings.EMBEDDING_DIM)
    query_vec = await embedding_service.embed(query, db)
    vec_literal = "[" + ",".join(str(float(x)) for x in query_vec) + "]"

    where_parts = ["embedding IS NOT NULL"]
    params: dict[str, Any] = {"qv": vec_literal, "k": k}

    if not permission.unrestricted and not permission.allowed_prefixes:
        where_parts.append("FALSE")

    if not permission.unrestricted and permission.allowed_prefixes:
        or_clauses: list[str] = []
        for i, pref in enumerate(permission.allowed_prefixes):
            key = f"p{i}"
            or_clauses.append(f"hierarchy_path @> CAST(:{key} AS jsonb)")
            params[key] = json.dumps(pref, ensure_ascii=False)
        where_parts.append("(" + " OR ".join(or_clauses) + ")")

    where_sql = " AND ".join(where_parts)
    sql = (
        "SELECT id, content, metadata, "
        f"(embedding <=> CAST(:qv AS vector({dim})))::double precision AS distance "
        "FROM rag_chunks "
        f"WHERE {where_sql} "
        f"ORDER BY embedding <=> CAST(:qv AS vector({dim})) ASC "
        "LIMIT :k"
    )

    _audit_sql_for_execution(sql, params)

    result = await db.execute(text(sql), params)
    rows = result.mappings().all()
    return [dict(r) for r in rows]

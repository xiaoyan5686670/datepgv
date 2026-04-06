# -*- coding: utf-8 -*-
"""
Chat endpoint with Server-Sent Events (SSE) streaming.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.chat import ChatMessage, ChatSession
from app.models.schemas import ChatRequest, ChatSessionSummary
from app.services.embedding import get_embedding_service
from app.services.llm import LLMService, get_llm_service
from app.services.analytics_db_settings_service import (
    effective_mysql_execute_url,
    effective_postgres_execute_url,
)
from app.core.config import settings
from app.services.query_executor import QueryExecutorError, QueryResult, run_analytics_query
from app.services.rag import RAGEngine
from app.services.sql_generator import process_llm_output
from app.services.sql_metadata_guard import validate_generated_sql_columns

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)

_SUMMARY_SYSTEM = """你是数据分析助手。用户提出了一个问题，系统已执行查询并得到下列 JSON 结果（可能仅包含部分行）。
请严格根据给定数据用简体中文直接回答用户问题；不得编造数据中不存在的数字、日期或事实。
若结果为空数组，说明可能无匹配数据，请简要说明。
若用户消息中注明「结果已截断」，请在回答中说明结论基于返回数据的前若干行。"""


def _history_turn_text(m: ChatMessage) -> str:
    """Build one turn's text for multi-turn LLM context."""
    if m.role == "user":
        return m.content
    if m.generated_sql:
        return m.content
    return m.content


async def _summarize_query_result(
    llm: LLMService,
    db: AsyncSession,
    user_query: str,
    qres: QueryResult,
) -> str:
    trunc_note = (
        "\n（查询结果已按行数上限截断，请仅基于以上数据分析。）" if qres.truncated else ""
    )
    payload = {
        "columns": qres.columns,
        "rows": qres.rows,
    }
    user_msg = f"""用户问题：{user_query}

查询返回（JSON）：{json.dumps(payload, ensure_ascii=False, default=str)}{trunc_note}"""
    messages = [
        {"role": "system", "content": _SUMMARY_SYSTEM},
        {"role": "user", "content": user_msg},
    ]
    return await llm.chat(messages, db)


async def _ensure_session(session_id: str | None, db: AsyncSession) -> str:
    """Create a chat session row if it doesn't exist; return the session_id."""
    sid = session_id or str(uuid.uuid4())
    existing = await db.execute(
        select(ChatSession).where(ChatSession.session_id == sid)
    )
    if not existing.scalar_one_or_none():
        db.add(ChatSession(session_id=sid))
        await db.commit()
    return sid


async def _load_history(
    session_id: str, db: AsyncSession
) -> list[dict[str, str]]:
    """Load last 10 messages for multi-turn context."""
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    msgs = list(reversed(result.scalars().all()))
    return [{"role": m.role, "content": _history_turn_text(m)} for m in msgs]


@router.get("/sessions", response_model=list[ChatSessionSummary])
async def list_sessions(db: AsyncSession = Depends(get_db)) -> list[ChatSessionSummary]:
    """
    List chat sessions ordered by most recent activity.
    Uses a single aggregate query to fetch title and last_message_at.
    """
    # Subquery: first user message per session (used as title)
    first_user_msg = (
        select(
            ChatMessage.session_id,
            func.min(ChatMessage.id).label("first_id"),
        )
        .where(ChatMessage.role == "user")
        .group_by(ChatMessage.session_id)
        .subquery("first_user_msg")
    )

    title_msg = (
        select(ChatMessage.session_id, ChatMessage.content.label("title"))
        .join(
            first_user_msg,
            (ChatMessage.session_id == first_user_msg.c.session_id)
            & (ChatMessage.id == first_user_msg.c.first_id),
        )
        .subquery("title_msg")
    )

    # Main query: join sessions with aggregates
    stmt = (
        select(
            ChatSession.session_id,
            ChatSession.created_at,
            func.coalesce(
                func.max(ChatMessage.created_at), ChatSession.created_at
            ).label("last_message_at"),
            func.coalesce(title_msg.c.title, "新会话").label("title"),
        )
        .outerjoin(ChatMessage, ChatMessage.session_id == ChatSession.session_id)
        .outerjoin(title_msg, title_msg.c.session_id == ChatSession.session_id)
        .group_by(ChatSession.session_id, ChatSession.created_at, title_msg.c.title)
        .order_by(func.coalesce(func.max(ChatMessage.created_at), ChatSession.created_at).desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    return [
        ChatSessionSummary(
            session_id=row.session_id,
            title=row.title[:40] + "..." if len(row.title) > 40 else row.title,
            created_at=row.created_at,
            last_message_at=row.last_message_at,
        )
        for row in rows
    ]


async def _save_messages(
    session_id: str,
    user_query: str,
    assistant_text: str,
    sql_type: str,
    db: AsyncSession,
    generated_sql: str | None = None,
    *,
    executed: bool | None = None,
    exec_error: str | None = None,
    result_preview: dict | None = None,
) -> None:
    db.add(ChatMessage(session_id=session_id, role="user", content=user_query))
    db.add(
        ChatMessage(
            session_id=session_id,
            role="assistant",
            content=assistant_text,
            sql_type=sql_type,
            generated_sql=generated_sql,
            executed=executed,
            exec_error=exec_error,
            result_preview=result_preview,
        )
    )
    await db.commit()


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    SSE streaming chat endpoint.

    Stream format:
    - `data: {"type": "meta", ...}`      – session/tables info (first event)
    - `data: {"type": "token", "text": "..."}` – SQL token stream
    - `data: {"type": "done", ...}`      – sql, answer, executed, exec_error, result_preview
    - `data: {"type": "error", "message": "..."}` – on error
    """
    timing = settings.DEBUG or settings.CHAT_STREAM_TIMING_LOG
    timing_rid = uuid.uuid4().hex[:10]

    t0 = time.perf_counter()
    session_id = await _ensure_session(request.session_id, db)
    ensure_ms = (time.perf_counter() - t0) * 1000

    emb_svc = get_embedding_service()
    rag = RAGEngine(db, emb_svc)
    llm = get_llm_service()

    t = time.perf_counter()
    tables, join_paths = await rag.retrieve(request.query, request.sql_type, request.top_k)
    retrieve_ms = (time.perf_counter() - t) * 1000
    if not tables:
        raise HTTPException(
            status_code=400,
            detail=f"未找到与 {request.sql_type.upper()} 相关的表结构。请先在「元数据管理」中导入该类型的表。",
        )

    t = time.perf_counter()
    history = await _load_history(session_id, db)
    history_ms = (time.perf_counter() - t) * 1000

    t = time.perf_counter()
    messages = rag.build_prompt(request.query, tables, request.sql_type, join_paths)
    if history:
        messages = [messages[0]] + history + [messages[1]]
    prompt_ms = (time.perf_counter() - t) * 1000

    pre_stream_ms = (time.perf_counter() - t0) * 1000
    referenced = [t.table_name for t in tables]
    if timing:
        logger.info(
            "chat_stream_timing rid=%s session_id=%s pre_stream_ms=%.1f "
            "ensure_ms=%.1f retrieve_ms=%.1f history_ms=%.1f prompt_ms=%.1f",
            timing_rid,
            session_id,
            pre_stream_ms,
            ensure_ms,
            retrieve_ms,
            history_ms,
            prompt_ms,
        )

    async def event_generator() -> AsyncGenerator[bytes, None]:
        full_response = ""

        t_meta = time.perf_counter()
        model_name = await llm.model_name(db)
        model_name_ms = (time.perf_counter() - t_meta) * 1000
        meta = {
            "type": "meta",
            "session_id": session_id,
            "referenced_tables": referenced,
            "model": model_name,
            "sql_type": request.sql_type,
        }
        yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n".encode()

        t_stream = time.perf_counter()
        first_token_ms: float | None = None
        try:
            async for token in llm.stream(messages, db):
                if first_token_ms is None:
                    first_token_ms = (time.perf_counter() - t_stream) * 1000
                full_response += token
                chunk = {"type": "token", "text": token}
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()
        except Exception as e:
            if timing:
                logger.info(
                    "chat_stream_timing rid=%s session_id=%s stream_failed_after_ms=%.1f error=%s",
                    timing_rid,
                    session_id,
                    (time.perf_counter() - t_stream) * 1000,
                    e,
                )
            err = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n".encode()
            return

        stream_total_ms = (time.perf_counter() - t_stream) * 1000

        clean_sql = process_llm_output(full_response, request.sql_type)

        answer = ""
        executed = False
        exec_error: str | None = None
        result_preview: dict | None = None

        t_exec_block = time.perf_counter()
        if not request.execute:
            answer = "已按设置跳过数据库执行，仅生成 SQL。"
        elif request.sql_type not in ("postgresql", "mysql"):
            answer = (
                f"当前为 {request.sql_type.upper()} 方言模式，系统未连接业务库执行查询，"
                "请在目标环境中自行运行下方 SQL。"
            )
        elif request.sql_type == "postgresql" and not await effective_postgres_execute_url(
            db
        ):
            exec_error = (
                "未配置可用的 PostgreSQL 执行连接：请在「设置 → 数据连接」填写，"
                "或设置 DATABASE_URL / ANALYTICS_POSTGRES_URL。"
            )
            answer = exec_error
        elif request.sql_type == "mysql" and not await effective_mysql_execute_url(db):
            exec_error = (
                "未配置 MySQL 执行连接：请在「设置 → 数据连接」填写，或设置 ANALYTICS_MYSQL_URL。"
            )
            answer = exec_error
        else:
            try:
                validate_generated_sql_columns(clean_sql, tables, request.sql_type)
                qres = await run_analytics_query(request.sql_type, clean_sql, db)
                executed = True
                result_preview = {
                    "columns": qres.columns,
                    "rows": qres.rows,
                    "truncated": qres.truncated,
                }
                try:
                    answer = await _summarize_query_result(
                        llm, db, request.query, qres
                    )
                except Exception as sum_err:
                    answer = (
                        "查询已成功执行，但生成自然语言总结时出现错误："
                        f"{sum_err}\n请查看下方返回的数据摘要。"
                    )
            except QueryExecutorError as e:
                exec_error = str(e)
                answer = f"查询未能执行：{exec_error}"
            except Exception as e:
                exec_error = str(e)
                answer = f"执行过程出错：{exec_error}"

        exec_block_ms = (time.perf_counter() - t_exec_block) * 1000

        done = {
            "type": "done",
            "sql": clean_sql,
            "answer": answer,
            "executed": executed,
            "exec_error": exec_error,
            "result_preview": result_preview,
        }
        yield f"data: {json.dumps(done, ensure_ascii=False, default=str)}\n\n".encode()

        t_save = time.perf_counter()
        await _save_messages(
            session_id,
            request.query,
            answer,
            request.sql_type,
            db,
            generated_sql=clean_sql or None,
            executed=executed,
            exec_error=exec_error,
            result_preview=result_preview,
        )
        save_ms = (time.perf_counter() - t_save) * 1000

        if timing:
            logger.info(
                "chat_stream_timing rid=%s session_id=%s model_name_ms=%.1f "
                "first_sql_token_ms=%s stream_total_ms=%.1f exec_and_summarize_ms=%.1f save_ms=%.1f",
                timing_rid,
                session_id,
                model_name_ms,
                f"{first_token_ms:.1f}" if first_token_ms is not None else "n/a",
                stream_total_ms,
                exec_block_ms,
                save_ms,
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions/{session_id}/history")
async def get_history(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Fetch full chat history for a session."""
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    msgs = result.scalars().all()
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sql_type": m.sql_type,
            "generated_sql": m.generated_sql,
            "executed": m.executed,
            "exec_error": m.exec_error,
            "result_preview": m.result_preview,
            "created_at": m.created_at.isoformat(),
        }
        for m in msgs
    ]


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a chat session and all its messages."""
    result = await db.execute(
        select(ChatSession).where(ChatSession.session_id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

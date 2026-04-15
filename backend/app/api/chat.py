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

from app.deps.auth import get_current_active_user
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.chat import ChatMessage, ChatSession
from app.models.llm_config import LLMConfig
from app.models.schemas import ChatRequest, ChatSessionSummary
from app.services.embedding import get_embedding_service
from app.services.llm import LLMService, get_llm_service
from app.services.analytics_db_connection_service import resolve_execute_url
from app.core.config import settings
from app.models.user import User
from app.services.query_executor import QueryExecutorError, QueryResult, run_analytics_query
from app.services.org_hierarchy import filter_rows_by_scope
from app.services.rag import RAGEngine, qualified_table_label
from app.services.sql_generator import process_llm_output, fix_ifnull_string_numerics
from app.services.sql_column_repair import repair_sql_unknown_columns, repair_sql_unknown_tables
from app.services.viewer_sql_context import build_viewer_sql_context
from app.services.sql_metadata_guard import find_unknown_columns, find_unknown_tables
from app.services.scope_policy_service import resolve_user_scope
from app.services.sql_scope_guard import rewrite_sql_with_scope
from app.services.error_formatter import format_execution_error

router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(get_current_active_user)],
)
logger = logging.getLogger(__name__)


def _user_is_admin(user: User) -> bool:
    return any(r.name == "admin" for r in user.roles)


async def _get_session_for_user(
    session_id: str,
    db: AsyncSession,
    user: User,
) -> ChatSession:
    result = await db.execute(
        select(ChatSession).where(ChatSession.session_id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    if session.user_id is None:
        # 认领无主遗留会话（用户隔离前创建），避免 403
        session.user_id = user.id
        await db.flush()
    elif session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该会话")
    return session


# 首轮 SQL 若含元数据外列名，最多调用 LLM 纠错几次再执行分析库
_SQL_COLUMN_REPAIR_MAX_ROUNDS = 2

_SUMMARY_SYSTEM = """你是数据分析助手。用户提出了一个问题，系统已执行查询并得到下列 JSON 结果（可能仅包含部分行）。
请严格根据给定数据用简体中文直接回答用户问题；不得编造数据中不存在的数字、日期或事实。
若结果为空数组，说明可能无匹配数据，请简要说明。如果统计时遇到求和，均值时，字段类型不符，先使用 cast 类型转换。
若用户消息中注明「结果已截断」，请在回答中说明结论基于返回数据的前若干行。

【图表可视化（可选）】
如果你认为当前查询的数据结果非常适合用图表展示（例如时间趋势折线图、部门对比柱状图、占比饼图等），请在回答的最末尾，输出一段用于图表渲染的 JSON 格式配置代码块。
必须使用 ```json 包裹，且 JSON 必须严格包含以下字段：
{
  "chart_type": "line" | "bar" | "pie",
  "x_axis_col": "作为 X 轴维度展示的数据列名（必须是上述结果 columns 中的某一项）",
  "y_axis_cols": ["数据列名1", "数据列名2"], // 注意这里是一个数组，作为 Y 轴数值展示。数组里面必须是纯字符串。如果有多个对比指标（如东部销售额、西部销售额），请将所需列名全部放入此数组
  "title": "简短的一句话图表标题"
}
如果数据结构不适合图表展示（例如纯文本、单行单列的汇总数值，或者结果本身为空），【千万不要】输出图表配置代码块。"""


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


async def _ensure_session(
    session_id: str | None, db: AsyncSession, user: User
) -> str:
    """Create a chat session row if it doesn't exist; return the session_id."""
    sid = session_id or str(uuid.uuid4())
    existing = await db.execute(
        select(ChatSession).where(ChatSession.session_id == sid)
    )
    row = existing.scalar_one_or_none()
    if row:
        if row.user_id is None:
            # 无主会话（用户隔离前遗留）：自动归属当前用户
            # 用 flush 而非 commit，避免 expire 掉同一 session 中的 current_user，
            # 防止 event_generator 访问属性时触发 async 懒加载错误
            row.user_id = user.id
            await db.flush()
        elif row.user_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权访问该会话",
            )
        return sid
    db.add(ChatSession(session_id=sid, user_id=user.id))
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
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[ChatSessionSummary]:
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
    if _user_is_admin(current_user):
        # Admin sees their own sessions AND any unclaimed (NULL) legacy sessions
        stmt = stmt.where(
            or_(
                ChatSession.user_id == current_user.id,
                ChatSession.user_id.is_(None),
            )
        )
    else:
        stmt = stmt.where(ChatSession.user_id == current_user.id)

    try:
        result = await db.execute(stmt)
        rows = result.all()
    except Exception as exc:
        logger.exception("list_sessions query failed for user_id=%s: %s", current_user.id, exc)
        raise HTTPException(status_code=500, detail=f"查询会话列表失败：{exc}") from exc

    try:
        return [
            ChatSessionSummary(
                session_id=row.session_id,
                title=(row.title or "新会话")[:40] + ("..." if len(row.title or "") > 40 else ""),
                created_at=row.created_at,
                last_message_at=row.last_message_at,
            )
            for row in rows
        ]
    except Exception as exc:
        logger.exception("list_sessions serialization failed for user_id=%s: %s", current_user.id, exc)
        raise HTTPException(status_code=500, detail=f"会话列表序列化失败：{exc}") from exc


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
    assistant_elapsed_ms: int | None = None,
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
            elapsed_ms=assistant_elapsed_ms,
        )
    )
    await db.commit()


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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
    session_id = await _ensure_session(request.session_id, db, current_user)
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
    messages = rag.build_prompt(
        request.query,
        tables,
        request.sql_type,
        join_paths,
        current_user=current_user,
    )
    if history:
        messages = [messages[0]] + history + [messages[1]]
    prompt_ms = (time.perf_counter() - t) * 1000

    pre_stream_ms = (time.perf_counter() - t0) * 1000
    referenced = [qualified_table_label(t) for t in tables]
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
        t_stream_start = time.perf_counter()
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
            answer, _ = format_execution_error(e, _user_is_admin(current_user))
            err = {"type": "error", "message": answer}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n".encode()
            return

        stream_total_ms = (time.perf_counter() - t_stream) * 1000

        clean_sql = process_llm_output(full_response, request.sql_type)

        answer = ""
        executed = False
        exec_error: str | None = None
        result_preview: dict | None = None
        scope_applied = False
        scope_rewrite_note: str | None = None
        effective_sql = clean_sql if clean_sql else ""

        t_exec_block = time.perf_counter()
        
        if clean_sql is None:
            # Not a SQL query, it's just an informational answer
            answer = full_response.strip()
        elif not request.execute:
            answer = "已按设置跳过数据库执行，仅生成 SQL。"
        elif request.sql_type not in ("postgresql", "mysql"):
            answer = (
                f"当前为 {request.sql_type.upper()} 方言模式，系统未连接业务库执行查询，"
                "请在目标环境中自行运行下方 SQL。"
            )
        elif request.sql_type == "postgresql" and not await resolve_execute_url(
            db, "postgresql", request.execute_connection_id
        ):
            exec_error = (
                "指定的 PostgreSQL 执行连接无效或未配置：请在「设置 → 数据连接」选择或配置，"
                "或设置 DATABASE_URL / ANALYTICS_POSTGRES_URL。"
                if request.execute_connection_id is not None
                else (
                    "未配置可用的 PostgreSQL 执行连接：请在「设置 → 数据连接」填写，"
                    "或设置 DATABASE_URL / ANALYTICS_POSTGRES_URL。"
                )
            )
            answer = exec_error
        elif request.sql_type == "mysql" and not await resolve_execute_url(
            db, "mysql", request.execute_connection_id
        ):
            exec_error = (
                "指定的 MySQL 执行连接无效或未配置：请在「设置 → 数据连接」选择或配置，"
                "或设置 ANALYTICS_MYSQL_URL。"
                if request.execute_connection_id is not None
                else (
                    "未配置 MySQL 执行连接：请在「设置 → 数据连接」填写，或设置 ANALYTICS_MYSQL_URL。"
                )
            )
            answer = exec_error
        else:
            try:
                viewer_ctx = build_viewer_sql_context(current_user)
                for repair_round in range(_SQL_COLUMN_REPAIR_MAX_ROUNDS):
                    unknown_tables = find_unknown_tables(
                        clean_sql, tables, request.sql_type
                    )
                    if unknown_tables:
                        logger.info(
                            "chat_sql_table_repair round=%s unknown=%s",
                            repair_round + 1,
                            unknown_tables,
                        )
                        fixed_raw = await repair_sql_unknown_tables(
                            clean_sql,
                            unknown_tables,
                            tables,
                            join_paths,
                            request.sql_type,
                            llm,
                            db,
                            viewer_context=viewer_ctx,
                        )
                        new_sql = process_llm_output(fixed_raw, request.sql_type)
                        if new_sql:
                            clean_sql = new_sql
                        continue
                    unknown = find_unknown_columns(
                        clean_sql, tables, request.sql_type
                    )
                    if not unknown:
                        break
                    logger.info(
                        "chat_sql_column_repair round=%s unknown=%s",
                        repair_round + 1,
                        unknown,
                    )
                    fixed_raw = await repair_sql_unknown_columns(
                        clean_sql,
                        unknown,
                        tables,
                        join_paths,
                        request.sql_type,
                        llm,
                        db,
                        viewer_context=viewer_ctx,
                    )
                    new_sql = process_llm_output(fixed_raw, request.sql_type)
                    if new_sql:
                        clean_sql = new_sql
                still_tables = find_unknown_tables(
                    clean_sql, tables, request.sql_type
                )
                if still_tables:
                    logger.warning(
                        "chat_sql_table_repair still unknown after %s rounds: %s; executing anyway",
                        _SQL_COLUMN_REPAIR_MAX_ROUNDS,
                        still_tables,
                    )
                still = find_unknown_columns(clean_sql, tables, request.sql_type)
                if still:
                    logger.warning(
                        "chat_sql_column_repair still unknown after %s rounds: %s; executing anyway",
                        _SQL_COLUMN_REPAIR_MAX_ROUNDS,
                        still,
                    )
                scope = await resolve_user_scope(current_user, db)
                if settings.SCOPE_REWRITE_ENABLED:
                    rewrite = rewrite_sql_with_scope(
                        clean_sql, request.sql_type, scope, current_user
                    )
                    effective_sql = rewrite.sql
                    scope_applied = rewrite.scope_applied
                    scope_rewrite_note = rewrite.rewrite_note
                    if scope_applied:
                        logger.info(
                            "scope_rewrite_applied user_id=%s source=%s policy_ids=%s note=%s original_sql=%s effective_sql=%s",
                            current_user.id,
                            scope.source,
                            scope.policy_ids,
                            scope_rewrite_note,
                            clean_sql,
                            effective_sql,
                        )
                else:
                    effective_sql = clean_sql
                try:
                    qres = await run_analytics_query(
                        request.sql_type,
                        effective_sql,
                        db,
                        scope=scope,
                        connection_id=request.execute_connection_id,
                    )
                except (QueryExecutorError, Exception) as first_err:
                    # Auto-retry for Doris/StarRocks type-mismatch errors:
                    # e.g. "sum requires a numeric parameter: sum(ifnull(col, '0'))"
                    err_str = str(first_err).lower()
                    is_type_err = (
                        "requires a numeric parameter" in err_str
                        or "requires a decimal parameter" in err_str
                        or ("errcode" in err_str and "type" in err_str and "mismatch" in err_str)
                    )
                    if is_type_err:
                        fixed_sql = fix_ifnull_string_numerics(effective_sql)
                        if fixed_sql != effective_sql:
                            logger.info(
                                "doris_type_error_autofix: retrying after ifnull string→numeric fix"
                            )
                            effective_sql = fixed_sql
                            qres = await run_analytics_query(
                                request.sql_type,
                                effective_sql,
                                db,
                                scope=scope,
                                connection_id=request.execute_connection_id,
                            )
                        else:
                            raise
                    else:
                        raise
                if not scope.unrestricted:
                    scoped_rows = filter_rows_by_scope(qres.rows, scope)
                    qres = QueryResult(
                        columns=qres.columns,
                        rows=scoped_rows,
                        truncated=qres.truncated or (len(scoped_rows) < len(qres.rows)),
                    )
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
                    logger.exception("Summarizing query result failed: %s", sum_err)
                    answer, _ = format_execution_error(sum_err, _user_is_admin(current_user))
                    if _user_is_admin(current_user):
                        answer = f"查询已成功执行，但在生成自然语言总结时出现错误。原始信息：{sum_err}"
                    else:
                        answer = "查询已成功执行，但在生成总结时遇到一点小问题。您可以先查看下方的数据报表。"
            except QueryExecutorError as e:
                logger.warning("Query execution failed (QueryExecutorError): %s", e)
                answer, exec_error = format_execution_error(e, _user_is_admin(current_user))
            except Exception as e:
                logger.exception("Query execution failed (Unexpected Exception): %s", e)
                answer, exec_error = format_execution_error(e, _user_is_admin(current_user))

        if scope_rewrite_note:
            answer = (answer + "\n\n" + scope_rewrite_note).strip()

        exec_block_ms = (time.perf_counter() - t_exec_block) * 1000

        done = {
            "type": "done",
            # 与 run_analytics_query 一致：展示实际执行的 SQL（含列修复与省份范围改写）
            "sql": effective_sql,
            "effective_sql": effective_sql,
            "answer": answer,
            "executed": executed,
            "exec_error": exec_error,
            "result_preview": result_preview,
            "scope_applied": scope_applied,
            "scope_rewrite_note": scope_rewrite_note,
        }
        yield f"data: {json.dumps(done, ensure_ascii=False, default=str)}\n\n".encode()

        t_save = time.perf_counter()
        assistant_elapsed_ms = int((t_save - t_stream_start) * 1000)
        await _save_messages(
            session_id,
            request.query,
            answer,
            request.sql_type,
            db,
            generated_sql=effective_sql or None,
            executed=executed,
            exec_error=exec_error,
            result_preview=result_preview,
            assistant_elapsed_ms=assistant_elapsed_ms,
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
    current_user: User = Depends(get_current_active_user),
) -> list[dict]:
    """Fetch full chat history for a session."""
    await _get_session_for_user(session_id, db, current_user)
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
            "elapsed_ms": m.elapsed_ms,
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
    current_user: User = Depends(get_current_active_user),
) -> Response:
    """Delete a chat session and all its messages."""
    session = await _get_session_for_user(session_id, db, current_user)
    await db.delete(session)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── LLM model list / switch (accessible to all authenticated users) ───────────


@router.get("/models")
async def list_llm_models(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[dict]:
    """Return available LLM configs (type='llm') with id, name, model, is_active."""
    result = await db.execute(
        select(LLMConfig)
        .where(LLMConfig.config_type == "llm")
        .order_by(LLMConfig.is_active.desc(), LLMConfig.name)
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "model": r.model,
            "is_active": r.is_active,
        }
        for r in rows
    ]


@router.post("/models/{config_id}/activate")
async def activate_llm_model(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Switch the active LLM model. Deactivates others of same type."""
    row = await db.get(LLMConfig, config_id)
    if not row or row.config_type != "llm":
        raise HTTPException(status_code=404, detail="模型配置不存在")
    await db.execute(
        update(LLMConfig)
        .where(LLMConfig.config_type == "llm")
        .where(LLMConfig.id != config_id)
        .values(is_active=False)
    )
    row.is_active = True
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "name": row.name, "model": row.model, "is_active": True}

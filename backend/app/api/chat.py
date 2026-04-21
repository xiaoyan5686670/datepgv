# -*- coding: utf-8 -*-
"""
Chat endpoint with Server-Sent Events (SSE) streaming.
"""
from __future__ import annotations

import json
import logging
import re
import time
import traceback
import uuid
from typing import Any, AsyncGenerator
import litellm

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
from app.services.llm import LLMService, get_active_llm_extra_params, get_llm_service
from app.services.analytics_db_connection_service import resolve_execute_url
from app.core.config import settings
from app.models.user import User
from app.services.query_executor import QueryExecutorError, QueryResult, run_analytics_query
from app.services.org_hierarchy import filter_rows_by_scope, load_org_data, org_identity_names
from app.services.rag import RAGEngine, qualified_table_label
from app.services.sql_generator import (
    SQL_OUTPUT_MODE_KEY,
    fix_ifnull_string_numerics,
    process_llm_output,
)
from app.services.sql_column_repair import repair_sql_unknown_columns, repair_sql_unknown_tables, repair_sql_missing_joins
from app.services.sql_skill_service import choose_sql_skills, list_enabled_sql_skills
from app.services.viewer_sql_context import build_viewer_sql_context
from app.services.sql_metadata_guard import find_unknown_columns, find_unknown_tables, find_misplaced_columns, fuzzy_repair_sql_columns
from app.services.scope_policy_service import resolve_user_scope
from app.services.sql_scope_guard import rewrite_sql_with_scope
from app.services.error_formatter import format_execution_error
from app.services.scope_types import ResolvedScope
from app.services.province_alias_service import (
    canonical_province_name,
    province_canonicals_mentioned_in_text,
)

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


def _build_scope_block_message(scope_provinces: set[str], disallowed: list[str]) -> str:
    allowed = sorted([v for v in scope_provinces if v])
    if allowed:
        return (
            f"当前账号仅允许查询以下省份的数据：{'、'.join(allowed)}。"
            f"您本次请求包含未授权省份：{'、'.join(disallowed)}。"
            "请调整查询范围后重试。"
        )
    return (
        f"您本次请求包含未授权省份：{'、'.join(disallowed)}。"
        "当前账号无可用省份权限，无法执行该查询。"
    )


def _build_employee_scope_block_message(disallowed: list[str]) -> str:
    return (
        f"您本次请求包含未授权员工：{'、'.join(disallowed)}。"
        "普通员工仅允许查询本人数据，请调整查询条件后重试。"
    )


def _user_scope_precheck(
    user_query: str,
    scope: ResolvedScope,
    current_user: User,
) -> tuple[list[str], list[str]]:
    role_names = {r.name for r in current_user.roles} if current_user.roles else set()
    if "admin" in role_names:
        return [], []

    disallowed_provinces: list[str] = []
    disallowed_employees: list[str] = []
    query_text = (user_query or "").strip()
    if not query_text:
        return disallowed_provinces, disallowed_employees

    # Province precheck (works even when LLM does not produce SQL).
    allowed_provinces = {canonical_province_name(v) for v in scope.province_values if v}
    if not allowed_provinces and (current_user.employee_level or "staff").strip() == "staff":
        own_prov = canonical_province_name(current_user.province)
        if own_prov:
            allowed_provinces.add(own_prov)
    if allowed_provinces:
        mentioned = province_canonicals_mentioned_in_text(query_text)
        disallowed_provinces = sorted([p for p in mentioned if p not in allowed_provinces])

    # Employee / Entity precheck: block querying others if restricted.
    if not scope.unrestricted:
        # Base allowed set: scope values + own identity (name, username)
        allowed_employees = {str(v).strip() for v in scope.employee_values if str(v).strip()}
        org = load_org_data()
        
        # Merge self into allowed set for pre-check
        allowed_employees.update(org_identity_names(current_user, org))
        allowed_employees.add((current_user.username or "").strip())
        allowed_employees.add((current_user.full_name or "").strip())
        
        # 直接用 OrgData 中预排序的名单，无需每次重新 sorted()
        known_names = org.known_names_sorted or []
        mentions: set[str] = set()
        for name in known_names:
            if name in query_text:
                mentions.add(name)
        # ID-like mentions (e.g. XY001234)
        mentions.update(re.findall(r"\b[A-Za-z]{1,4}\d{3,}\b", query_text))
        
        disallowed_employees = sorted(
            [m for m in mentions if m and m not in allowed_employees]
        )

    return disallowed_provinces, disallowed_employees


def _build_personalized_waiting_tips(
    user_query: str,
    scope: ResolvedScope,
    history: list[dict[str, str]],
) -> list[dict[str, str]]:
    query = (user_query or "").strip()
    tips: list[dict[str, str]] = []
    lower_query = query.lower()

    def _add_tip(tip_id: str, text: str, rewrite_query: str) -> None:
        if not text.strip() or not rewrite_query.strip():
            return
        if any(t["id"] == tip_id for t in tips):
            return
        tips.append(
            {
                "id": tip_id,
                "text": text.strip(),
                "rewrite_query": rewrite_query.strip(),
            }
        )

    if not re.search(r"\d{4}|本月|上月|本周|上周|今年|去年|季度|q[1-4]|近\d+天", lower_query):
        _add_tip(
            "time_range",
            "补充时间范围会更快得到稳定结果，例如“最近30天”或“2026Q1”。",
            f"{query}，时间范围限定在最近30天",
        )

    if not re.search(r"省|市|区|县|大区|区域|团队|部门|产品|品类", query):
        _add_tip(
            "dimension",
            "建议指定分析维度（如省份/团队/产品），可以减少歧义。",
            f"{query}，按省份维度展示",
        )

    if re.search(r"业绩|销售|回款|金额|订单|gmv", lower_query) and not re.search(
        r"口径|签约|回款|实收|含税|不含税", query
    ):
        _add_tip(
            "metric_definition",
            "建议补充指标口径（如业绩=签约额或回款额），结论会更准确。",
            f"{query}，其中业绩口径按回款额统计",
        )

    if not re.search(r"top|前\d+|排序|升序|降序|最高|最低", lower_query):
        _add_tip(
            "ranking",
            "可补充排序和TopN，例如“按回款额降序取Top10”。",
            f"{query}，按回款额降序取Top10",
        )

    if not scope.unrestricted and scope.province_values:
        allowed = sorted([v for v in scope.province_values if v])
        allowed_text = "、".join(allowed[:5])
        _add_tip(
            "scope_hint",
            f"权限提示：当前账号可查询省份为 {allowed_text}。",
            f"{query}（仅查询{allowed_text}范围）",
        )

    recent_user_queries = [
        (h.get("content") or "").strip()
        for h in history
        if (h.get("role") == "user" and (h.get("content") or "").strip())
    ]
    if recent_user_queries:
        last_query = recent_user_queries[-1]
        _add_tip(
            "history_followup",
            f"可基于你上一问继续追问：{last_query[:30]}...",
            f"{last_query}，并给出同比变化",
        )

    if not tips:
        _add_tip(
            "default_refine",
            "可补充时间范围、统计口径和排序方式，通常会显著提升结果质量。",
            f"{query}，并补充时间范围与统计口径",
        )

    return tips[:6]


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
    decision_trace: dict | None = None,
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
            decision_trace=decision_trace,
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

    # Default so nested event_generator never sees UnboundLocalError if refactored
    llm_extra_params: dict[str, Any] = {}

    t = time.perf_counter()
    try:
        llm_extra_params = await get_active_llm_extra_params(db)
        expand_graph: bool | None = None
        effective_top_k = request.top_k
        if llm_extra_params.get("weak_model_rag") is True:
            expand_graph = False
            cap_raw = llm_extra_params.get("weak_model_rag_top_k", 2)
            try:
                cap_n = int(cap_raw)
            except (TypeError, ValueError):
                cap_n = 2
            cap_n = max(1, min(cap_n, 20))
            effective_top_k = min(request.top_k, cap_n)

        tables, join_paths = await rag.retrieve(
            request.query,
            request.sql_type,
            effective_top_k,
            expand_graph=expand_graph,
        )
        retrieve_ms = (time.perf_counter() - t) * 1000
        logger.info("PERF chat_stream phase=rag_retrieve ms=%.0f", retrieve_ms)
        if not tables:
            raise HTTPException(
                status_code=400,
                detail=f"未找到与 {request.sql_type.upper()} 相关的表结构。请先在「元数据管理」中导入该类型的表。",
            )

        t = time.perf_counter()
        history = await _load_history(session_id, db)
        history_ms = (time.perf_counter() - t) * 1000
        logger.info("PERF chat_stream phase=load_history ms=%.0f", history_ms)
        scope = await resolve_user_scope(current_user, db)
        precheck_disallowed_provinces, precheck_disallowed_employees = _user_scope_precheck(
            request.query, scope, current_user
        )
        precheck_block_message: str | None = None
        if precheck_disallowed_provinces:
            precheck_block_message = _build_scope_block_message(
                scope.province_values, precheck_disallowed_provinces
            )
        elif precheck_disallowed_employees:
            precheck_block_message = _build_employee_scope_block_message(
                precheck_disallowed_employees
            )
        personalized_waiting_tips = _build_personalized_waiting_tips(
            request.query, scope, history
        )

        t = time.perf_counter()
        available_skills = list(await list_enabled_sql_skills(db))
        selected_skills = choose_sql_skills(
            request.query,
            request.sql_type,
            tables,
            available_skills,
        )
        messages = rag.build_prompt(
            request.query,
            tables,
            request.sql_type,
            join_paths,
            current_user=current_user,
            selected_skills=selected_skills,
            available_skills=available_skills,
            sql_output_mode=str(llm_extra_params.get(SQL_OUTPUT_MODE_KEY, "markdown")),
        )
        if history:
            messages = [messages[0]] + history + [messages[1]]
        prompt_ms = (time.perf_counter() - t) * 1000

        pre_stream_ms = (time.perf_counter() - t0) * 1000
        referenced = [qualified_table_label(t) for t in tables]
        t = time.perf_counter()
        model_name = await llm.model_name(db)
        model_name_ms = (time.perf_counter() - t) * 1000

        pre_stream_ms = (time.perf_counter() - t0) * 1000
        # Log prompt size to diagnose TTFT bottleneck
        _prompt_chars = sum(len(m.get("content", "")) for m in messages)
        _prompt_breakdown = [(m.get("role", "?"), len(m.get("content", ""))) for m in messages]
        logger.info(
            "PERF chat_stream phase=prompt_size total_chars=%d num_messages=%d breakdown=%s",
            _prompt_chars, len(messages), _prompt_breakdown
        )
        logger.info("PERF chat_stream phase=pre_stream_total ms=%.0f (before LLM starts)", pre_stream_ms)

    except Exception as e:
        # 记录前期失败（如召回 0 张表），确保审计可见
        err_msg, _ = format_execution_error(e, _user_is_admin(current_user))
        full_trace = traceback.format_exc()
        await _save_messages(
            session_id,
            request.query,
            err_msg,
            request.sql_type,
            db,
            generated_sql=None,
            executed=False,
            exec_error=full_trace,
            assistant_elapsed_ms=int((time.perf_counter() - t0) * 1000),
            decision_trace={"error_phase": "pre_stream", "exception": str(e)},
        )
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=err_msg) from e

    async def event_generator() -> AsyncGenerator[bytes, None]:
        t_stream_start = time.perf_counter()
        full_response = ""
        token_count = 0
        tps = 0.0

        meta = {
            "type": "meta",
            "session_id": session_id,
            "referenced_tables": referenced,
            "model": model_name,
            "sql_type": request.sql_type,
            "waiting_tips": personalized_waiting_tips,
        }
        yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n".encode()

        if precheck_block_message:
            done = {
                "type": "done",
                "sql": "",
                "effective_sql": "",
                "answer": precheck_block_message,
                "executed": False,
                "exec_error": precheck_block_message,
                "result_preview": None,
                "scope_applied": False,
                "scope_rewrite_note": None,
                "scope_blocked": True,
                "scope_block_reason": precheck_block_message,
                "scope_disallowed_provinces": precheck_disallowed_provinces,
                "selected_skill_names": [s.name for s in selected_skills],
                "selected_skill_ids": [s.id for s in selected_skills if s.id is not None],
            }
            yield f"data: {json.dumps(done, ensure_ascii=False, default=str)}\n\n".encode()
            await _save_messages(
                session_id,
                request.query,
                precheck_block_message,
                request.sql_type,
                db,
                generated_sql=None,
                executed=False,
                exec_error=precheck_block_message,
                result_preview=None,
                assistant_elapsed_ms=int((time.perf_counter() - t_stream_start) * 1000),
                decision_trace={
                    "selected_skill_names": [s.name for s in selected_skills],
                    "selected_skill_ids": [s.id for s in selected_skills if s.id is not None],
                    "scope_applied": False,
                    "scope_blocked": True,
                    "sql_executed": False,
                    "execution_error_category": (
                        "scope_blocked_province"
                        if precheck_disallowed_provinces
                        else "scope_blocked_employee"
                    ),
                },
            )
            return

        t_stream = time.perf_counter()
        first_token_ms: float | None = None
        stream_error_occurred = False

        # --- Initialize state for saving/yielding 'done' ---
        answer = ""
        executed = False
        exec_error: str | None = None
        result_preview: dict | None = None
        scope_applied = False
        scope_rewrite_note: str | None = None
        clean_sql: str | None = None
        effective_sql: str | None = ""
        selected_skill_names = [s.name for s in selected_skills]
        selected_skill_ids = [s.id for s in selected_skills if s.id is not None]
        scope_blocked = False
        scope_block_reason: str | None = None
        blocked_disallowed_provinces: list[str] = []
        scope_is_comprehensive = False
        t_exec_block = 0.0 # Will be updated if reached

        try:
            async for token in llm.stream(messages, db):
                if first_token_ms is None:  # 只记录第一个 token 的到达时间
                    first_token_ms = (time.perf_counter() - t_stream) * 1000
                    logger.info("PERF chat_stream phase=llm_first_token ms=%.0f (TTFT from LLM call)", first_token_ms)
                full_response += token
                chunk = {"type": "token", "text": token}
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()
        except Exception as e:
            stream_error_occurred = True
            if timing:
                logger.info(
                    "chat_stream_timing rid=%s session_id=%s stream_failed_after_ms=%.1f error=%s",
                    timing_rid,
                    session_id,
                    (time.perf_counter() - t_stream) * 1000,
                    e,
                )
            answer, _ = format_execution_error(e, _user_is_admin(current_user))
            exec_error = traceback.format_exc()
            err = {"type": "error", "message": answer}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n".encode()

        stream_total_ms = (time.perf_counter() - t_stream) * 1000

        if not stream_error_occurred:
            clean_sql, nl_from_json = process_llm_output(
                full_response, request.sql_type, llm_extra_params
            )
            effective_sql = clean_sql if clean_sql else ""

            t_exec_block_start = time.perf_counter()
            if clean_sql is None:
                # Not a SQL query — plain text, or JSON mode kind=text
                answer = (
                    nl_from_json
                    if nl_from_json is not None
                    else full_response.strip()
                )
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
                            new_sql, _ = process_llm_output(
                                fixed_raw, request.sql_type, llm_extra_params
                            )
                            if new_sql:
                                clean_sql = new_sql
                            continue
                        misplaced = find_misplaced_columns(
                            clean_sql, tables, request.sql_type
                        )
                        if misplaced:
                            logger.info(
                                "chat_sql_missing_join_repair round=%s misplaced=%s",
                                repair_round + 1,
                                [(c, s) for c, s in misplaced],
                            )
                            fixed_raw = await repair_sql_missing_joins(
                                clean_sql,
                                misplaced,
                                tables,
                                join_paths,
                                request.sql_type,
                                llm,
                                db,
                                viewer_context=viewer_ctx,
                            )
                            new_sql, _ = process_llm_output(
                                fixed_raw, request.sql_type, llm_extra_params
                            )
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
                        new_sql, _ = process_llm_output(
                            fixed_raw, request.sql_type, llm_extra_params
                        )
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
                    still_misplaced = find_misplaced_columns(
                        clean_sql, tables, request.sql_type
                    )
                    if still_misplaced:
                        logger.warning(
                            "chat_sql_missing_join_repair still misplaced after %s rounds: %s; executing anyway",
                            _SQL_COLUMN_REPAIR_MAX_ROUNDS,
                            [(c, s) for c, s in still_misplaced],
                        )
                    still = find_unknown_columns(clean_sql, tables, request.sql_type)
                    if still:
                        logger.warning(
                            "chat_sql_column_repair still unknown after %s rounds: %s; trying fuzzy repair",
                            _SQL_COLUMN_REPAIR_MAX_ROUNDS,
                            still,
                        )
                        fuzzy_sql, fuzzy_map = fuzzy_repair_sql_columns(
                            clean_sql, tables, request.sql_type
                        )
                        if fuzzy_map:
                            logger.info(
                                "chat_sql_column_fuzzy_repair applied: %s",
                                fuzzy_map,
                            )
                            clean_sql = fuzzy_sql
                        else:
                            logger.warning(
                                "chat_sql_column_fuzzy_repair found no matches; executing with unknown columns"
                            )
                    if settings.SCOPE_REWRITE_ENABLED:
                        rewrite = rewrite_sql_with_scope(
                            clean_sql, request.sql_type, scope, current_user, tables
                        )
                        effective_sql = rewrite.sql
                        scope_applied = rewrite.scope_applied
                        scope_rewrite_note = rewrite.rewrite_note
                        scope_blocked = rewrite.should_block
                        scope_block_reason = rewrite.block_reason
                        blocked_disallowed_provinces = rewrite.mentioned_disallowed_provinces
                        scope_is_comprehensive = rewrite.is_comprehensive
                        logger.info(
                            "DEBUG_EXECUTION: scope_rewrite context user=%s scope_source=%s comprehensive=%s applied=%s sql_pasted=%s",
                            current_user.username,
                            scope.source,
                            scope_is_comprehensive,
                            scope_applied,
                            effective_sql[:200]
                        )
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
                        if scope_blocked:
                            answer = _build_scope_block_message(
                                scope.province_values, blocked_disallowed_provinces
                            )
                            exec_error = scope_block_reason or answer
                            logger.info(
                                "scope_rewrite_blocked user_id=%s source=%s policy_ids=%s disallowed=%s",
                                current_user.id,
                                scope.source,
                                scope.policy_ids,
                                blocked_disallowed_provinces,
                            )
                    else:
                        effective_sql = clean_sql
                    if not scope_blocked:
                        try:
                            qres = await run_analytics_query(
                                request.sql_type,
                                effective_sql,
                                db,
                                scope=scope,
                                connection_id=request.execute_connection_id,
                                skip_wrapper=scope_is_comprehensive,
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
                                        skip_wrapper=scope_is_comprehensive,
                                    )
                                else:
                                    raise
                            else:
                                raise
                        logger.info(
                            "DEBUG_EXECUTION: query_result user=%s raw_rows=%s columns=%s exec_sql=%s",
                            current_user.username,
                            len(qres.rows),
                            qres.columns,
                            effective_sql[:300]
                        )
                        if not scope.unrestricted and not scope_is_comprehensive:
                            scoped_rows = filter_rows_by_scope(qres.rows, scope)
                            logger.info(
                                "DEBUG_EXECUTION: scope_filter_applied user=%s before=%s after=%s",
                                current_user.username,
                                len(qres.rows),
                                len(scoped_rows)
                            )
                            qres = QueryResult(
                                columns=qres.columns,
                                rows=scoped_rows,
                                truncated=qres.truncated,
                            )
                        else:
                            if scope_is_comprehensive:
                                logger.info(
                                    "DEBUG_EXECUTION: skipping_post_filter user=%s reason=comprehensive",
                                    current_user.username
                                )
                        executed = True
                        result_preview = {
                            "columns": qres.columns,
                            "rows": qres.rows,
                            "truncated": qres.truncated,
                        }
                        try:
                            t_summary = time.perf_counter()
                            answer = await _summarize_query_result(
                                llm, db, request.query, qres
                            )
                            logger.info("PERF chat_stream phase=summarize_result ms=%.0f rows=%d", (time.perf_counter() - t_summary) * 1000, len(qres.rows))
                        except Exception as sum_err:
                            logger.exception("Summarizing query result failed: %s", sum_err)
                            answer, _ = format_execution_error(sum_err, _user_is_admin(current_user))
                            if _user_is_admin(current_user):
                                answer = f"查询已成功执行，但在生成自然语言总结时出现错误。原始信息：{sum_err}"
                            else:
                                answer = "查询已成功执行，但在生成总结时遇到一点小问题。您可以先查看下方的数据报表。"
                except QueryExecutorError as e:
                    logger.warning("Query execution failed (QueryExecutorError): %s", e)
                    answer, _ = format_execution_error(e, _user_is_admin(current_user))
                    exec_error = str(e) # Friendly but technical
                except Exception as e:
                    logger.exception("Query execution failed (Unexpected Exception): %s", e)
                    answer, _ = format_execution_error(e, _user_is_admin(current_user))
                    exec_error = traceback.format_exc()

                if scope_rewrite_note:
                    answer = (answer + "\n\n" + scope_rewrite_note).strip()

                t_exec_block = (time.perf_counter() - t_exec_block_start) * 1000

        exec_block_ms = t_exec_block

        # Only yield 'done' if we didn't already yield an 'error' event during streaming.
        # If stream_error_occurred is True, the client already received an 'error' event.
        if not stream_error_occurred:
            # Calculate token count and TPS
            try:
                # model_name might be like "dashscope/qwen-turbo" or "ollama/llama3"
                token_count = litellm.token_counter(model=model_name, text=full_response)
            except Exception:
                # Fallback to rough estimation or character count if tokenizer fails
                token_count = len(full_response)

            # TPS = tokens / 纯生成时间（去掉 TTFT，即首字到最后一字的时间）
            # 用总时间（含 TTFT）算出的 TPS 会因 Prefill 阶段严重偏低，无法反映显卡真实速度
            generation_ms = stream_total_ms - (first_token_ms or 0)
            if generation_ms > 100:  # 至少 100ms 的生成时间才计算，避免除以极小值
                tps = token_count / (generation_ms / 1000)
            elif stream_total_ms > 0:
                tps = token_count / (stream_total_ms / 1000)

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
                "scope_blocked": scope_blocked,
                "scope_block_reason": scope_block_reason,
                "scope_disallowed_provinces": blocked_disallowed_provinces,
                "selected_skill_names": selected_skill_names,
                "selected_skill_ids": selected_skill_ids,
                "token_count": token_count,
                "tps": tps,
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
            decision_trace={
                "selected_skill_names": selected_skill_names,
                "selected_skill_ids": selected_skill_ids,
                "scope_applied": scope_applied,
                "scope_blocked": scope_blocked,
                "scope_block_reason": scope_block_reason,
                "scope_disallowed_provinces": blocked_disallowed_provinces,
                "sql_generated": bool(clean_sql),
                "sql_executed": executed,
                "execution_error_category": (
                    "scope_blocked"
                    if scope_blocked
                    else ("query_error" if exec_error else None)
                ),
                "llm_model": model_name,
                "token_count": token_count,
                "tps": tps,
            },
        )
        save_ms = (time.perf_counter() - t_save) * 1000

        if timing:
            logger.info(
                "chat_stream_timing rid=%s session_id=%s pre_stream_ms=%.1f "
                "model_name_ms=%.1f first_sql_token_ms=%s stream_total_ms=%.1f "
                "exec_and_summarize_ms=%.1f save_ms=%.1f",
                timing_rid,
                session_id,
                pre_stream_ms,
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
            "llm_model": m.decision_trace.get("llm_model") if m.decision_trace else None,
            "token_count": m.decision_trace.get("token_count") if m.decision_trace else None,
            "tps": m.decision_trace.get("tps") if m.decision_trace else None,
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

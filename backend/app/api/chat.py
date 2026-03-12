"""
Chat endpoint with Server-Sent Events (SSE) streaming.
"""
from __future__ import annotations

import json
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.chat import ChatMessage, ChatSession
from app.models.schemas import ChatRequest
from app.services.embedding import get_embedding_service
from app.services.llm import get_llm_service
from app.services.rag import RAGEngine
from app.services.sql_generator import process_llm_output

router = APIRouter(prefix="/chat", tags=["chat"])


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
    return [{"role": m.role, "content": m.content} for m in msgs]


async def _save_messages(
    session_id: str,
    user_query: str,
    assistant_reply: str,
    sql_type: str,
    db: AsyncSession,
) -> None:
    db.add(ChatMessage(session_id=session_id, role="user", content=user_query))
    db.add(
        ChatMessage(
            session_id=session_id,
            role="assistant",
            content=assistant_reply,
            sql_type=sql_type,
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
    - `data: {"type": "done", "sql": "..."}` – final processed SQL
    - `data: {"type": "error", "message": "..."}` – on error
    """
    session_id = await _ensure_session(request.session_id, db)

    emb_svc = get_embedding_service()
    rag = RAGEngine(db, emb_svc)
    llm = get_llm_service()

    # Retrieve relevant tables
    tables = await rag.retrieve(request.query, request.sql_type, request.top_k)
    if not tables:
        raise HTTPException(
            status_code=404,
            detail="No relevant tables found. Please import table metadata first.",
        )

    # Load conversation history for multi-turn context
    history = await _load_history(session_id, db)

    # Build RAG prompt
    messages = rag.build_prompt(request.query, tables, request.sql_type)

    # Inject conversation history before the final user message
    if history:
        # Insert history between system and the new user message
        messages = [messages[0]] + history + [messages[1]]

    referenced = [t.table_name for t in tables]

    async def event_generator() -> AsyncGenerator[bytes, None]:
        full_response = ""

        # Send metadata event
        meta = {
            "type": "meta",
            "session_id": session_id,
            "referenced_tables": referenced,
            "model": await llm.model_name(db),
            "sql_type": request.sql_type,
        }
        yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n".encode()

        # Stream tokens
        try:
            async for token in llm.stream(messages, db):
                full_response += token
                chunk = {"type": "token", "text": token}
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()
        except Exception as e:
            err = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n".encode()
            return

        # Post-process and send final SQL
        clean_sql = process_llm_output(full_response, request.sql_type)
        done = {"type": "done", "sql": clean_sql}
        yield f"data: {json.dumps(done, ensure_ascii=False)}\n\n".encode()

        # Persist to DB (fire and forget via separate session would be cleaner,
        # but acceptable here since it's after stream completes)
        await _save_messages(
            session_id, request.query, clean_sql, request.sql_type, db
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
            "created_at": m.created_at.isoformat(),
        }
        for m in msgs
    ]


@router.get("/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List chat sessions with basic summary info."""
    result = await db.execute(
        select(
            ChatSession.session_id,
            func.min(ChatMessage.created_at).label("first_message_at"),
            func.max(ChatMessage.created_at).label("last_message_at"),
            func.coalesce(
                func.min(
                    func.nullif(ChatMessage.content, "")
                ),
                ""
            ).label("title"),
        )
        .join(ChatMessage, ChatMessage.session_id == ChatSession.session_id)
        .group_by(ChatSession.session_id)
        .order_by(func.max(ChatMessage.created_at).desc())
    )
    rows = result.all()
    sessions: list[dict] = []
    for row in rows:
        title = (row.title or "").strip()
        if not title:
            title = "新会话"
        if len(title) > 40:
            title = title[:40] + "..."
        sessions.append(
            {
                "session_id": row.session_id,
                "title": title,
                "first_message_at": row.first_message_at.isoformat()
                if row.first_message_at
                else None,
                "last_message_at": row.last_message_at.isoformat()
                if row.last_message_at
                else None,
            }
        )
    return sessions

@router.delete("/sessions/{session_id}", status_code=200)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a chat session and all its messages."""
    result = await db.execute(
        select(ChatSession).where(ChatSession.session_id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()
    return {"detail": "deleted"}

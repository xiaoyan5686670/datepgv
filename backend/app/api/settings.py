"""
App-level settings (embedding dimension, etc.) editable from the UI.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.embedding_dim import get_embedding_dim

router = APIRouter(prefix="/settings", tags=["settings"])

ALLOWED_EMBEDDING_DIMS = (768, 1536, 3072)


class EmbeddingDimResponse(BaseModel):
    embedding_dim: int


class EmbeddingDimUpdate(BaseModel):
    embedding_dim: int


@router.get("/embedding-dim", response_model=EmbeddingDimResponse)
async def get_embedding_dim_setting(
    db: AsyncSession = Depends(get_db),
) -> EmbeddingDimResponse:
    """Current embedding dimension (from DB; used by backend after restart)."""
    try:
        r = await db.execute(text("SELECT value FROM app_settings WHERE key = 'embedding_dim'"))
        row = r.fetchone()
        if row:
            return EmbeddingDimResponse(embedding_dim=int(row[0]))
    except Exception:
        pass
    return EmbeddingDimResponse(embedding_dim=get_embedding_dim())


@router.post("/embedding-dim", response_model=EmbeddingDimResponse)
async def update_embedding_dim(
    payload: EmbeddingDimUpdate,
    db: AsyncSession = Depends(get_db),
) -> EmbeddingDimResponse:
    """
    Set embedding dimension and migrate DB column. Valid values: 768, 1536, 3072.
    After success, restart the backend and run "全部重新向量化" in Admin.
    """
    dim = payload.embedding_dim
    if dim not in ALLOWED_EMBEDDING_DIMS:
        raise HTTPException(
            status_code=400,
            detail=f"embedding_dim must be one of {ALLOWED_EMBEDDING_DIMS}",
        )
    current = get_embedding_dim()
    if dim == current:
        return EmbeddingDimResponse(embedding_dim=dim)

    # Ensure app_settings exists
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)
    """))
    await db.execute(
        text("INSERT INTO app_settings (key, value) VALUES ('embedding_dim', :v) ON CONFLICT (key) DO UPDATE SET value = :v"),
        {"v": str(dim)},
    )

    # Migrate table_metadata.embedding column
    await db.execute(text("DROP INDEX IF EXISTS table_metadata_embedding_idx"))
    await db.execute(text("ALTER TABLE table_metadata DROP COLUMN IF EXISTS embedding"))
    await db.execute(text(f"ALTER TABLE table_metadata ADD COLUMN embedding vector({dim})"))
    # pgvector IVFFlat index supports at most 2000 dimensions; skip index when dim > 2000 (sequential scan)
    if dim <= 2000:
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS table_metadata_embedding_idx
            ON table_metadata USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
        """))
    await db.commit()

    # In-memory value stays old until backend restart; then bootstrap will read new dim from DB
    return EmbeddingDimResponse(embedding_dim=dim)

"""
Vector store abstraction for table metadata embeddings.
Supports multiple backends (pgvector by default; future: Milvus, Qdrant, etc.)
selected via config VECTOR_STORE.
"""
from __future__ import annotations

from typing import Literal, Protocol

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.metadata import TableMetadata

SQLType = Literal["hive", "postgresql", "all"]


class VectorStore(Protocol):
    """Interface for vector search and upsert of table metadata embeddings."""

    async def search(
        self,
        db: AsyncSession,
        query_embedding: list[float],
        top_k: int,
        db_type: SQLType,
    ) -> list[TableMetadata]:
        """Return table metadata rows ordered by similarity to query_embedding."""
        ...

    async def upsert_embedding(
        self,
        db: AsyncSession,
        metadata_id: int,
        embedding: list[float],
    ) -> None:
        """Write or update the embedding for the given table metadata row."""
        ...


class PgVectorStore:
    """PostgreSQL + pgvector implementation; vectors stored in table_metadata.embedding."""

    async def search(
        self,
        db: AsyncSession,
        query_embedding: list[float],
        top_k: int,
        db_type: SQLType,
    ) -> list[TableMetadata]:
        stmt = (
            select(TableMetadata)
            .order_by(TableMetadata.embedding.cosine_distance(query_embedding))
            .limit(top_k)
            .where(TableMetadata.embedding.is_not(None))
        )
        if db_type != "all":
            stmt = stmt.where(TableMetadata.db_type == db_type)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def upsert_embedding(
        self,
        db: AsyncSession,
        metadata_id: int,
        embedding: list[float],
    ) -> None:
        await db.execute(
            update(TableMetadata)
            .where(TableMetadata.id == metadata_id)
            .values(embedding=embedding)
        )
        await db.flush()


def get_vector_store() -> VectorStore:
    """Return the vector store implementation for the configured VECTOR_STORE."""
    if settings.VECTOR_STORE == "pgvector":
        return PgVectorStore()
    raise ValueError(f"Unsupported VECTOR_STORE: {settings.VECTOR_STORE}")

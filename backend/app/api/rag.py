from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.rag_abac import get_user_permission
from app.models.rag_abac import RagSearchHit, RagSearchRequest, RagSearchResponse, UserPermission
from app.services.embedding import get_embedding_service
from app.services.hierarchical_vector_search import hierarchical_vector_search

router = APIRouter(prefix="/rag", tags=["rag"])


@router.post("/search", response_model=RagSearchResponse)
async def rag_hierarchical_search(
    body: RagSearchRequest,
    db: AsyncSession = Depends(get_db),
    permission: UserPermission = Depends(get_user_permission),
) -> RagSearchResponse:
    """Vector search over ``rag_chunks`` with mandatory hierarchy_path ABAC filter."""
    emb = get_embedding_service()
    raw_hits = await hierarchical_vector_search(
        db,
        emb,
        body.query,
        permission,
        top_k=body.top_k,
    )
    hits = [
        RagSearchHit(
            id=int(h["id"]),
            content=str(h["content"]),
            metadata=dict(h["metadata"] or {}),
            distance=float(h["distance"]),
        )
        for h in raw_hits
    ]
    return RagSearchResponse(hits=hits, permission=permission)

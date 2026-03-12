"""
Table metadata CRUD + DDL import + CSV bulk import + DB auto-sync endpoints.
"""
from __future__ import annotations

import io
from typing import Any, Literal

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.metadata import TableMetadata
from app.models.schemas import (
    ColumnInfo,
    DDLImportRequest,
    SearchRequest,
    TableMetadataCreate,
    TableMetadataResponse,
    TableMetadataUpdate,
)
from app.services.ddl_parser import parse_ddl
from app.services.embedding import build_table_text, get_embedding_service

router = APIRouter(prefix="/metadata", tags=["metadata"])


async def _upsert_with_embedding(
    db: AsyncSession,
    payload: TableMetadataCreate,
) -> TableMetadata:
    """Create or update a table metadata row and generate its embedding."""
    emb_svc = get_embedding_service()
    text = build_table_text(payload.model_dump())
    embedding = await emb_svc.embed(text, db)

    # Check for existing row
    stmt = select(TableMetadata).where(
        TableMetadata.db_type == payload.db_type,
        TableMetadata.table_name == payload.table_name,
        TableMetadata.database_name == payload.database_name,
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    cols_json = [c.model_dump() for c in payload.columns]

    if existing:
        existing.table_comment = payload.table_comment
        existing.columns = cols_json
        existing.sample_data = payload.sample_data
        existing.tags = payload.tags
        existing.schema_name = payload.schema_name
        existing.embedding = embedding
        await db.commit()
        await db.refresh(existing)
        return existing

    row = TableMetadata(
        db_type=payload.db_type,
        database_name=payload.database_name,
        schema_name=payload.schema_name,
        table_name=payload.table_name,
        table_comment=payload.table_comment,
        columns=cols_json,
        sample_data=payload.sample_data,
        tags=payload.tags,
        embedding=embedding,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _row_to_response(row: TableMetadata) -> TableMetadataResponse:
    data = {
        "id": row.id,
        "db_type": row.db_type,
        "database_name": row.database_name,
        "schema_name": row.schema_name,
        "table_name": row.table_name,
        "table_comment": row.table_comment,
        "columns": row.columns or [],
        "sample_data": row.sample_data,
        "tags": row.tags,
        "has_embedding": row.embedding is not None,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    return TableMetadataResponse(**data)


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[TableMetadataResponse])
async def list_metadata(
    db_type: Literal["hive", "postgresql", "oracle", "all"] = Query("all"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> list[TableMetadataResponse]:
    stmt = select(TableMetadata).offset(skip).limit(limit).order_by(TableMetadata.id.desc())
    if db_type != "all":
        stmt = stmt.where(TableMetadata.db_type == db_type)
    result = await db.execute(stmt)
    return [_row_to_response(r) for r in result.scalars().all()]


@router.get("/{metadata_id}", response_model=TableMetadataResponse)
async def get_metadata(
    metadata_id: int,
    db: AsyncSession = Depends(get_db),
) -> TableMetadataResponse:
    row = await db.get(TableMetadata, metadata_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return _row_to_response(row)


@router.post("/", response_model=TableMetadataResponse, status_code=201)
async def create_metadata(
    payload: TableMetadataCreate,
    db: AsyncSession = Depends(get_db),
) -> TableMetadataResponse:
    row = await _upsert_with_embedding(db, payload)
    return _row_to_response(row)


@router.put("/{metadata_id}", response_model=TableMetadataResponse)
async def update_metadata(
    metadata_id: int,
    payload: TableMetadataUpdate,
    db: AsyncSession = Depends(get_db),
) -> TableMetadataResponse:
    row = await db.get(TableMetadata, metadata_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "columns" in update_data and update_data["columns"] is not None:
        update_data["columns"] = [c.model_dump() for c in payload.columns]

    for field, value in update_data.items():
        setattr(row, field, value)

    # Re-generate embedding after update
    emb_svc = get_embedding_service()
    row_dict = {
        "database_name": row.database_name,
        "schema_name": row.schema_name,
        "table_name": row.table_name,
        "table_comment": row.table_comment,
        "columns": row.columns,
        "tags": row.tags,
    }
    row.embedding = await emb_svc.embed(build_table_text(row_dict), db)
    await db.commit()
    await db.refresh(row)
    return _row_to_response(row)


@router.delete(
    "/{metadata_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_metadata(
    metadata_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = await db.get(TableMetadata, metadata_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── DDL Import ────────────────────────────────────────────────────────────────

@router.post("/import/ddl", response_model=list[TableMetadataResponse], status_code=201)
async def import_from_ddl(
    payload: DDLImportRequest,
    db: AsyncSession = Depends(get_db),
) -> list[TableMetadataResponse]:
    """Parse one or more CREATE TABLE statements and import them."""
    tables = parse_ddl(payload.ddl, payload.db_type, payload.database_name)
    if not tables:
        raise HTTPException(status_code=400, detail="No valid CREATE TABLE found in DDL")
    results = []
    for t in tables:
        row = await _upsert_with_embedding(db, t)
        results.append(_row_to_response(row))
    return results


# ── CSV / Excel Bulk Import ───────────────────────────────────────────────────

@router.post("/import/csv", response_model=list[TableMetadataResponse], status_code=201)
async def import_from_csv(
    file: UploadFile = File(...),
    db_type: Literal["hive", "postgresql", "oracle"] = Form("hive"),
    database_name: str = Form(""),
    db: AsyncSession = Depends(get_db),
) -> list[TableMetadataResponse]:
    """
    Bulk import from CSV/Excel.
    Required columns: table_name, column_name, column_type
    Optional columns: table_comment, column_comment, nullable, is_partition_key, tags
    """
    content = await file.read()
    try:
        if file.filename and file.filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File parse error: {e}")

    required_cols = {"table_name", "column_name", "column_type"}
    if not required_cols.issubset(set(df.columns)):
        raise HTTPException(
            status_code=400,
            detail=f"CSV must contain columns: {required_cols}",
        )

    # Group by table
    grouped: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        tname = str(row["table_name"]).strip()
        if tname not in grouped:
            grouped[tname] = {
                "table_comment": str(row.get("table_comment", "") or ""),
                "tags": [t.strip() for t in str(row.get("tags", "") or "").split(",") if t.strip()],
                "columns": [],
            }
        grouped[tname]["columns"].append(
            ColumnInfo(
                name=str(row["column_name"]).strip(),
                type=str(row["column_type"]).strip(),
                comment=str(row.get("column_comment", "") or ""),
                nullable=str(row.get("nullable", "true")).lower() != "false",
                is_partition_key=str(row.get("is_partition_key", "false")).lower() == "true",
            )
        )

    results = []
    for tname, info in grouped.items():
        payload = TableMetadataCreate(
            db_type=db_type,
            database_name=database_name or None,
            table_name=tname,
            table_comment=info["table_comment"] or None,
            columns=info["columns"],
            tags=info["tags"] or None,
        )
        row_obj = await _upsert_with_embedding(db, payload)
        results.append(_row_to_response(row_obj))
    return results


# ── DB Auto-Sync ──────────────────────────────────────────────────────────────

@router.post("/sync/postgresql", response_model=list[TableMetadataResponse], status_code=201)
async def sync_from_postgresql(
    dsn: str = Form(..., description="Target PostgreSQL connection string"),
    schema: str = Form("public"),
    db: AsyncSession = Depends(get_db),
) -> list[TableMetadataResponse]:
    """
    Auto-introspect a PostgreSQL database's information_schema
    and import all table/column metadata.
    """
    import asyncpg

    try:
        conn = await asyncpg.connect(dsn)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {e}")

    try:
        rows = await conn.fetch(
            """
            SELECT
                c.table_name,
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.column_default,
                pgd.description AS column_comment,
                obj_description(pgc.oid, 'pg_class') AS table_comment
            FROM information_schema.columns c
            JOIN pg_class pgc ON pgc.relname = c.table_name
            LEFT JOIN pg_description pgd
                ON pgd.objoid = pgc.oid AND pgd.objsubid = c.ordinal_position
            WHERE c.table_schema = $1
            ORDER BY c.table_name, c.ordinal_position
            """,
            schema,
        )
    finally:
        await conn.close()

    grouped: dict[str, dict[str, Any]] = {}
    for r in rows:
        tname = r["table_name"]
        if tname not in grouped:
            grouped[tname] = {
                "table_comment": r["table_comment"],
                "columns": [],
            }
        grouped[tname]["columns"].append(
            ColumnInfo(
                name=r["column_name"],
                type=r["data_type"],
                comment=r["column_comment"] or "",
                nullable=r["is_nullable"] == "YES",
                is_partition_key=False,
            )
        )

    results = []
    for tname, info in grouped.items():
        payload = TableMetadataCreate(
            db_type="postgresql",
            schema_name=schema,
            table_name=tname,
            table_comment=info["table_comment"],
            columns=info["columns"],
        )
        row_obj = await _upsert_with_embedding(db, payload)
        results.append(_row_to_response(row_obj))
    return results


# ── Semantic Search ───────────────────────────────────────────────────────────

@router.post("/search", response_model=list[TableMetadataResponse])
async def search_metadata(
    payload: SearchRequest,
    db: AsyncSession = Depends(get_db),
) -> list[TableMetadataResponse]:
    """Semantic search for relevant tables given a natural language query."""
    from app.services.rag import RAGEngine

    emb_svc = get_embedding_service()
    engine = RAGEngine(db, emb_svc)
    sql_type = payload.db_type if payload.db_type != "all" else "hive"
    tables = await engine.retrieve(payload.query, sql_type, payload.top_k)
    return [_row_to_response(t) for t in tables]


# ── Re-embed all ──────────────────────────────────────────────────────────────

@router.post("/reembed", status_code=202)
async def reembed_all(db: AsyncSession = Depends(get_db)) -> dict:
    """Re-generate embeddings for all table metadata rows."""
    emb_svc = get_embedding_service()
    result = await db.execute(select(TableMetadata))
    rows = result.scalars().all()
    count = 0
    for row in rows:
        row_dict = {
            "database_name": row.database_name,
            "schema_name": row.schema_name,
            "table_name": row.table_name,
            "table_comment": row.table_comment,
            "columns": row.columns,
            "tags": row.tags,
        }
        row.embedding = await emb_svc.embed(build_table_text(row_dict), db)
        count += 1
    await db.commit()
    return {"reembedded": count}

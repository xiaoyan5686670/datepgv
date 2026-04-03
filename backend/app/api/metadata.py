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
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.metadata import TableMetadata, TableMetadataEdge
from app.models.schemas import (
    ColumnInfo,
    DDLImportRequest,
    SearchRequest,
    TableMetadataCreate,
    TableMetadataEdgeCreate,
    TableMetadataEdgeResponse,
    TableMetadataResponse,
    TableMetadataUpdate,
)
from app.services.ddl_parser import parse_ddl
from app.services.embedding import build_table_text, get_embedding_service

router = APIRouter(prefix="/metadata", tags=["metadata"])

_DDL_FILE_EXTENSIONS = (".sql", ".ddl", ".txt")


def _decode_ddl_bytes(raw: bytes) -> str:
    """Decode uploaded DDL file bytes with fallback encodings."""
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("ddl", raw, 0, 1, "unsupported encoding")


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


def _table_display_label(row: TableMetadata) -> str:
    parts = [row.database_name, row.schema_name, row.table_name]
    return ".".join(p for p in parts if p) or row.table_name


def _edge_to_response(
    edge: TableMetadataEdge, from_row: TableMetadata, to_row: TableMetadata
) -> TableMetadataEdgeResponse:
    return TableMetadataEdgeResponse(
        id=edge.id,
        from_metadata_id=edge.from_metadata_id,
        to_metadata_id=edge.to_metadata_id,
        from_label=_table_display_label(from_row),
        to_label=_table_display_label(to_row),
        from_db_type=from_row.db_type,
        to_db_type=to_row.db_type,
        relation_type=edge.relation_type,
        from_column=edge.from_column,
        to_column=edge.to_column,
        note=edge.note,
        created_at=edge.created_at,
    )


# ── Table relations (must be registered before /{metadata_id}) ────────────────


@router.get("/edges", response_model=list[TableMetadataEdgeResponse])
async def list_table_edges(
    db: AsyncSession = Depends(get_db),
) -> list[TableMetadataEdgeResponse]:
    """List all schema-graph edges with human-readable table names."""
    try:
        result = await db.execute(select(TableMetadataEdge).order_by(TableMetadataEdge.id))
        edges = list(result.scalars().all())
    except ProgrammingError:
        await db.rollback()
        return []

    if not edges:
        return []

    ids: set[int] = set()
    for e in edges:
        ids.add(e.from_metadata_id)
        ids.add(e.to_metadata_id)
    meta_res = await db.execute(select(TableMetadata).where(TableMetadata.id.in_(ids)))
    by_id = {r.id: r for r in meta_res.scalars().all()}

    out: list[TableMetadataEdgeResponse] = []
    for e in edges:
        fr = by_id.get(e.from_metadata_id)
        to = by_id.get(e.to_metadata_id)
        if fr is None or to is None:
            continue
        out.append(_edge_to_response(e, fr, to))
    return out


@router.post(
    "/edges",
    response_model=TableMetadataEdgeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_table_edge(
    payload: TableMetadataEdgeCreate,
    db: AsyncSession = Depends(get_db),
) -> TableMetadataEdgeResponse:
    if payload.from_metadata_id == payload.to_metadata_id:
        raise HTTPException(
            status_code=400,
            detail="请选择两张不同的表，不能将同一张表连自己。",
        )

    from_row = await db.get(TableMetadata, payload.from_metadata_id)
    to_row = await db.get(TableMetadata, payload.to_metadata_id)
    if not from_row or not to_row:
        raise HTTPException(status_code=404, detail="找不到对应的表，请先在「表目录」里添加元数据。")

    edge = TableMetadataEdge(
        from_metadata_id=payload.from_metadata_id,
        to_metadata_id=payload.to_metadata_id,
        relation_type=payload.relation_type,
        from_column=payload.from_column,
        to_column=payload.to_column,
        note=payload.note,
    )
    db.add(edge)
    try:
        await db.commit()
        await db.refresh(edge)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="这条关系已经存在（同一种类型不能重复添加）。",
        ) from None
    except ProgrammingError:
        await db.rollback()
        raise HTTPException(
            status_code=503,
            detail="数据库尚未创建「表关系」表。请联系管理员执行 init-db/02-table_metadata_edges.sql。",
        ) from None

    return _edge_to_response(edge, from_row, to_row)


@router.delete(
    "/edges/{edge_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_table_edge(
    edge_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        row = await db.get(TableMetadataEdge, edge_id)
        if not row:
            raise HTTPException(status_code=404, detail="这条关系不存在或已删除。")
        await db.delete(row)
        await db.commit()
    except HTTPException:
        raise
    except ProgrammingError:
        await db.rollback()
        raise HTTPException(
            status_code=503,
            detail="数据库尚未创建「表关系」表。请联系管理员执行 init-db/02-table_metadata_edges.sql。",
        ) from None

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[TableMetadataResponse])
async def list_metadata(
    db_type: Literal["hive", "postgresql", "oracle", "mysql", "all"] = Query("all"),
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
    ddl_text = payload.ddl.strip()
    if not ddl_text:
        raise HTTPException(status_code=400, detail="DDL 内容不能为空")
    tables = parse_ddl(ddl_text, payload.db_type, payload.database_name)
    if not tables:
        raise HTTPException(
            status_code=400,
            detail="未找到可解析的 CREATE TABLE 语句，请确认方言类型与语法是否匹配",
        )
    results = []
    for t in tables:
        row = await _upsert_with_embedding(db, t)
        results.append(_row_to_response(row))
    return results


@router.post("/import/ddl-file", response_model=list[TableMetadataResponse], status_code=201)
async def import_from_ddl_file(
    file: UploadFile = File(...),
    db_type: Literal["hive", "postgresql", "oracle", "mysql"] = Form("hive"),
    database_name: str = Form(""),
    db: AsyncSession = Depends(get_db),
) -> list[TableMetadataResponse]:
    """Parse uploaded DDL file and import one or more CREATE TABLE statements."""
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="请上传 DDL 文件")
    lowered = filename.lower()
    if not lowered.endswith(_DDL_FILE_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail="仅支持 .sql/.ddl/.txt 文件",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空，无法导入")

    try:
        ddl_text = _decode_ddl_bytes(raw).strip()
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="文件编码不受支持，请使用 UTF-8 或 GB18030 编码",
        )

    if not ddl_text:
        raise HTTPException(status_code=400, detail="文件内容为空，无法导入")

    tables = parse_ddl(ddl_text, db_type, database_name or None)
    if not tables:
        raise HTTPException(
            status_code=400,
            detail="未找到可解析的 CREATE TABLE 语句，请确认方言类型与语法是否匹配",
        )

    results = []
    for table in tables:
        row = await _upsert_with_embedding(db, table)
        results.append(_row_to_response(row))
    return results


# ── CSV / Excel Bulk Import ───────────────────────────────────────────────────

@router.post("/import/csv", response_model=list[TableMetadataResponse], status_code=201)
async def import_from_csv(
    file: UploadFile = File(...),
    db_type: Literal["hive", "postgresql", "oracle", "mysql"] = Form("hive"),
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
    tables, _ = await engine.retrieve(payload.query, sql_type, payload.top_k)
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

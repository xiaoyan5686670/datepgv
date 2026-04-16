from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import require_admin
from app.models.schemas import SQLSkillCreate, SQLSkillResponse, SQLSkillUpdate
from app.models.sql_skill import SQLSkill
from app.models.user import User
from app.services.sql_skill_service import invalidate_sql_skill_cache

router = APIRouter(
    prefix="/sql-skills",
    tags=["sql-skills"],
    dependencies=[Depends(require_admin)],
)


@router.get("/", response_model=list[SQLSkillResponse])
async def list_sql_skills(
    db: AsyncSession = Depends(get_db),
    enabled: bool | None = Query(None),
    keyword: str | None = Query(None, max_length=80),
) -> list[SQLSkillResponse]:
    stmt = select(SQLSkill).order_by(
        SQLSkill.enabled.desc(),
        SQLSkill.priority.asc(),
        SQLSkill.id.asc(),
    )
    if enabled is not None:
        stmt = stmt.where(SQLSkill.enabled.is_(enabled))
    if keyword:
        kw = keyword.strip()
        if kw:
            stmt = stmt.where(SQLSkill.name.ilike(f"%{kw}%"))
    rows = await db.execute(stmt)
    return [SQLSkillResponse.model_validate(r) for r in rows.scalars().all()]


@router.post("/", response_model=SQLSkillResponse, status_code=status.HTTP_201_CREATED)
async def create_sql_skill(
    payload: SQLSkillCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> SQLSkillResponse:
    exists = await db.execute(select(SQLSkill).where(SQLSkill.name == payload.name))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="技能名称已存在")
    row = SQLSkill(
        name=payload.name,
        description=payload.description,
        content=payload.content,
        keywords=payload.keywords,
        sql_types=payload.sql_types,
        priority=payload.priority,
        enabled=payload.enabled,
        updated_by=current_user.username,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    invalidate_sql_skill_cache()
    return SQLSkillResponse.model_validate(row)


@router.patch("/{skill_id}", response_model=SQLSkillResponse)
async def update_sql_skill(
    skill_id: int,
    payload: SQLSkillUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> SQLSkillResponse:
    row = await db.get(SQLSkill, skill_id)
    if not row:
        raise HTTPException(status_code=404, detail="技能不存在")
    data = payload.model_dump(exclude_unset=True)
    new_name = data.get("name")
    if isinstance(new_name, str) and new_name != row.name:
        exists = await db.execute(select(SQLSkill).where(SQLSkill.name == new_name))
        if exists.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="技能名称已存在")
    data["updated_by"] = current_user.username
    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    invalidate_sql_skill_cache()
    return SQLSkillResponse.model_validate(row)


@router.post("/{skill_id}/enable", response_model=SQLSkillResponse)
async def enable_sql_skill(
    skill_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> SQLSkillResponse:
    row = await db.get(SQLSkill, skill_id)
    if not row:
        raise HTTPException(status_code=404, detail="技能不存在")
    row.enabled = True
    row.updated_by = current_user.username
    await db.commit()
    await db.refresh(row)
    invalidate_sql_skill_cache()
    return SQLSkillResponse.model_validate(row)


@router.post("/{skill_id}/disable", response_model=SQLSkillResponse)
async def disable_sql_skill(
    skill_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> SQLSkillResponse:
    row = await db.get(SQLSkill, skill_id)
    if not row:
        raise HTTPException(status_code=404, detail="技能不存在")
    row.enabled = False
    row.updated_by = current_user.username
    await db.commit()
    await db.refresh(row)
    invalidate_sql_skill_cache()
    return SQLSkillResponse.model_validate(row)


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_sql_skill(
    skill_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = await db.get(SQLSkill, skill_id)
    if not row:
        raise HTTPException(status_code=404, detail="技能不存在")
    await db.delete(row)
    await db.commit()
    invalidate_sql_skill_cache()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

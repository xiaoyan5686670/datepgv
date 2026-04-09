"""
User management API.
Supports CRUD, bulk import (CSV/JSON for integration with other systems), and hierarchical access control:
- admin: full access
- province_manager: can view/manage users in their province (and district data)
- staff: limited to self
"""
from __future__ import annotations

import csv
import io
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_password_hash
from app.deps.auth import get_current_active_user, require_admin
from app.models.schemas import (
    UserCreate,
    UserImportRequest,
    UserImportResponse,
    UserResponse,
    UserUpdate,
)
from app.models.user import Role, User
from app.services.org_hierarchy import get_org_graph_payload, load_org_data

router = APIRouter(prefix="/users", tags=["users"])


def _user_to_response(user: User, roles: list[str] | None = None) -> UserResponse:
    """Convert SQLAlchemy User to Pydantic response."""
    if roles is None:
        roles = [r.name for r in user.roles] if hasattr(user, "roles") and user.roles else []
    return UserResponse(
        id=user.id,
        username=user.username,
        is_active=user.is_active,
        province=user.province,
        employee_level=user.employee_level,
        district=user.district,
        full_name=user.full_name,
        roles=roles,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get("/org-graph")
async def get_org_graph(
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> dict[str, Any]:
    """Organization graph built from 业务经理通讯录.csv."""
    return get_org_graph_payload()


def _build_users_from_org_rows() -> list[dict[str, Any]]:
    org = load_org_data()
    rows = org.rows

    def clean(v: Any) -> str:
        s = str(v or "").strip()
        return "" if s in {"", "/", "-", "无"} else s

    def upsert_candidate(
        out: dict[str, dict[str, Any]],
        *,
        key: str,
        full_name: str,
        province: str,
        district: str,
        employee_level: str,
        active: bool,
    ) -> None:
        if not key:
            return
        cur = out.get(key)
        if not cur:
            out[key] = {
                "username": key,
                "full_name": full_name or None,
                "province": province or None,
                "district": district or None,
                "employee_level": employee_level,
                "is_active": active,
            }
            return
        # Keep manager level if any source row marks it.
        if cur["employee_level"] != "province_manager" and employee_level == "province_manager":
            cur["employee_level"] = "province_manager"
        if not cur.get("province") and province:
            cur["province"] = province
        if not cur.get("district") and district:
            cur["district"] = district
        cur["is_active"] = bool(cur["is_active"] and active)

    candidates: dict[str, dict[str, Any]] = {}
    for r in rows:
        province = clean(r.get("shengfen"))
        district = clean(r.get("quyud"))
        active = clean(r.get("shifoulizhi")) != "是"

        manager_name = clean(r.get("yewujingli"))
        manager_code = clean(r.get("renyuanbianma"))
        manager_key = manager_code or manager_name
        upsert_candidate(
            candidates,
            key=manager_key,
            full_name=manager_name or manager_key,
            province=province,
            district=district,
            employee_level="staff",
            active=active,
        )

        for leader_col in ("daquzong", "shengzong", "quyuzong"):
            leader_name = clean(r.get(leader_col))
            upsert_candidate(
                candidates,
                key=leader_name,
                full_name=leader_name,
                province=province,
                district=district,
                employee_level="province_manager",
                active=True,
            )

    # Ensure username uniqueness (same leader name may repeat, but key-based de-dup already handles).
    return list(candidates.values())


@router.post("/sync/org-csv")
async def sync_users_from_org_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
    overwrite_existing: bool = Query(False),
    default_password: str = Query("123456", min_length=6, max_length=128),
) -> dict[str, Any]:
    """
    Sync users table from 业务经理通讯录.csv.
    - manager username prefers 人员编码(renyuanbianma), fallback 姓名
    - leaders (大区总/省总/区域总) create province_manager accounts with username=姓名
    """
    candidates = _build_users_from_org_rows()
    if not candidates:
        return {"total": 0, "created": 0, "updated": 0, "skipped": 0}

    hashed_default = get_password_hash(default_password)
    created = 0
    updated = 0
    skipped = 0

    role_user = (await db.execute(select(Role).where(Role.name == "user"))).scalar_one_or_none()
    role_pm = (await db.execute(select(Role).where(Role.name == "province_manager"))).scalar_one_or_none()

    for row in candidates:
        username = row["username"]
        result = await db.execute(select(User).where(User.username == username))
        existing = result.scalar_one_or_none()

        if existing:
            if not overwrite_existing:
                skipped += 1
                continue
            existing.full_name = row["full_name"]
            existing.province = row["province"]
            existing.district = row["district"]
            existing.employee_level = row["employee_level"]
            existing.is_active = row["is_active"]
            if row["employee_level"] == "province_manager" and role_pm:
                existing.roles = [role_pm]
            elif row["employee_level"] == "staff" and role_user:
                existing.roles = [role_user]
            updated += 1
            continue

        user = User(
            username=username,
            password_hash=hashed_default,
            is_active=row["is_active"],
            province=row["province"],
            employee_level=row["employee_level"],
            district=row["district"],
            full_name=row["full_name"],
        )
        if row["employee_level"] == "province_manager" and role_pm:
            user.roles.append(role_pm)
        elif row["employee_level"] == "staff" and role_user:
            user.roles.append(role_user)
        db.add(user)
        created += 1

    await db.commit()
    return {"total": len(candidates), "created": created, "updated": updated, "skipped": skipped}


@router.get("/", response_model=list[UserResponse])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    province: str | None = Query(None, description="Filter by province (for province_manager)"),
    employee_level: str | None = Query(None, description="Filter by employee_level"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> list[UserResponse]:
    """List users. Admins see all; province_managers see their province; staff see only self."""
    from sqlalchemy.orm import selectinload
    current_roles = {r.name for r in current_user.roles} if current_user.roles else set()

    stmt = select(User).options(selectinload(User.roles))

    if "admin" not in current_roles:
        if "province_manager" in current_roles and current_user.province:
            # Province manager can see users in their province
            stmt = stmt.where(User.province == current_user.province)
        else:
            # Regular staff can only see themselves
            stmt = stmt.where(User.id == current_user.id)

    if province:
        stmt = stmt.where(User.province == province)
    if employee_level:
        stmt = stmt.where(User.employee_level == employee_level)

    stmt = stmt.offset(skip).limit(limit).order_by(User.id.desc())

    result = await db.execute(stmt)
    users = result.scalars().all()

    return [_user_to_response(u) for u in users]


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
) -> UserResponse:
    """Create new user (admin only)."""
    # Check duplicate
    existing = await db.execute(select(User).where(User.username == payload.username))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="用户名已存在",
        )

    hashed_password = get_password_hash(payload.password)

    user = User(
        username=payload.username,
        password_hash=hashed_password,
        is_active=payload.is_active,
        province=payload.province,
        employee_level=payload.employee_level,
        district=payload.district,
        full_name=payload.full_name,
    )

    # Add default role if not admin
    if payload.employee_level == "admin":
        role_result = await db.execute(select(Role).where(Role.name == "admin"))
        role = role_result.scalar_one_or_none()
        if role:
            user.roles.append(role)
    else:
        role_name = "user" if payload.employee_level == "staff" else "province_manager"
        role_result = await db.execute(select(Role).where(Role.name == role_name))
        role = role_result.scalar_one_or_none()
        if role:
            user.roles.append(role)

    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_to_response(user)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> UserResponse:
    """Get user by ID with access control."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    current_roles = {r.name for r in current_user.roles} if current_user.roles else set()
    if user.id != current_user.id and "admin" not in current_roles:
        if not ("province_manager" in current_roles and current_user.province and user.province == current_user.province):
            raise HTTPException(status_code=403, detail="无权查看此用户")

    return _user_to_response(user)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> UserResponse:
    """Update user (self or admin)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    current_roles = {r.name for r in current_user.roles} if current_user.roles else set()
    is_admin = "admin" in current_roles
    if user.id != current_user.id and not is_admin:
        raise HTTPException(status_code=403, detail="无权修改此用户")

    # Update fields
    update_data = payload.model_dump(exclude_unset=True)
    if "password" in update_data and update_data["password"]:
        user.password_hash = get_password_hash(update_data["password"])
        del update_data["password"]

    for field, value in update_data.items():
        if value is not None:
            setattr(user, field, value)

    await db.commit()
    await db.refresh(user)
    return _user_to_response(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_user(
    user_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
) -> Response:
    """Delete user (admin only)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.username == "admin":  # protect default admin
        raise HTTPException(status_code=400, detail="不能删除默认管理员")

    await db.delete(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/import", response_model=UserImportResponse)
async def import_users(
    payload: UserImportRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
) -> UserImportResponse:
    """Bulk import users from other systems (CSV/JSON compatible). Supports overwrite."""
    created = 0
    updated = 0
    skipped = 0
    errors: list[str] = []

    for idx, row in enumerate(payload.users):
        try:
            # Check existing
            result = await db.execute(
                select(User).where(User.username == row.username)
            )
            existing = result.scalar_one_or_none()

            hashed_pw = get_password_hash(row.password or "default123") if row.password else None

            if existing:
                if payload.overwrite_existing:
                    existing.is_active = row.is_active
                    existing.province = row.province
                    existing.employee_level = row.employee_level
                    existing.district = row.district
                    existing.full_name = row.full_name
                    if hashed_pw:
                        existing.password_hash = hashed_pw
                    updated += 1
                else:
                    skipped += 1
                    continue
            else:
                user = User(
                    username=row.username,
                    password_hash=hashed_pw or get_password_hash("default123"),
                    is_active=row.is_active,
                    province=row.province,
                    employee_level=row.employee_level,
                    district=row.district,
                    full_name=row.full_name,
                )
                db.add(user)
                created += 1

        except Exception as e:
            errors.append(f"行 {idx+1} ({row.username}): {str(e)}")
            skipped += 1

    await db.commit()
    return UserImportResponse(
        total=len(payload.users),
        created=created,
        updated=updated,
        skipped=skipped,
        errors=errors,
    )


@router.post("/import/csv", response_model=UserImportResponse)
async def import_users_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_admin)],
    file: UploadFile = File(...),
    overwrite_existing: bool = Query(False),
) -> UserImportResponse:
    """Import users from CSV file (for easy integration with other systems)."""
    if not file.filename or not file.filename.lower().endswith((".csv",)):
        raise HTTPException(status_code=400, detail="仅支持 CSV 文件")

    content = await file.read()
    try:
        # Try different encodings
        for encoding in ("utf-8-sig", "utf-8", "gb18030"):
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError("无法解码文件")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件读取失败: {e}") from e

    csv_reader = csv.DictReader(io.StringIO(text))
    import_rows = []

    for row in csv_reader:
        try:
            import_rows.append(
                {
                    "username": row.get("username", "").strip(),
                    "password": row.get("password", "").strip() or None,
                    "full_name": row.get("full_name", "").strip() or None,
                    "province": row.get("province", "").strip() or None,
                    "employee_level": row.get("employee_level", "staff").strip(),
                    "district": row.get("district", "").strip() or None,
                    "is_active": row.get("is_active", "true").lower() in ("true", "1", "yes"),
                }
            )
        except Exception as e:
            # Skip bad rows
            continue

    if not import_rows:
        raise HTTPException(status_code=400, detail="CSV 中没有有效用户数据")

    # Convert to Pydantic and delegate to main import
    from app.models.schemas import UserImportRow, UserImportRequest

    pydantic_rows = [UserImportRow(**r) for r in import_rows if r["username"]]
    request = UserImportRequest(users=pydantic_rows, overwrite_existing=overwrite_existing)

    return await import_users(request, db, current_user)

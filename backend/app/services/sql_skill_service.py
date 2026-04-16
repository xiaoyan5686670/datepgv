from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.metadata import TableMetadata
from app.models.sql_skill import SQLSkill as SQLSkillModel


@dataclass(frozen=True)
class SQLSkill:
    id: int | None
    name: str
    description: str
    content: str
    keywords: tuple[str, ...] = ()
    sql_types: tuple[str, ...] = ()
    priority: int = 100
    enabled: bool = True


_DEFAULT_SQL_SKILLS: tuple[SQLSkill, ...] = (
    SQLSkill(
        id=None,
        name="province_filtering",
        description="省份过滤与同义词规范（禁止省份字段 LIKE）",
        keywords=("省", "省份", "地区", "区域", "大区", "内蒙", "广西", "广东", "河南"),
        content=(
            "## Skill: province_filtering\n"
            "- 省份过滤必须使用等值（= / IN），禁止在省份字段上使用 LIKE 模糊匹配或 LIKE 关联。\n"
            "- 省份值优先使用规范名称；必要时可在 IN 中包含规范值与常见别名。\n"
            "- 若用户请求包含未授权省份，不要放宽条件。"
        ),
    ),
    SQLSkill(
        id=None,
        name="scope_and_identity",
        description="按登录用户范围裁剪（人员/区域/省份）",
        keywords=("我的", "本人", "我", "下级", "团队", "辖区", "范围", "权限", "员工", "经理"),
        content=(
            "## Skill: scope_and_identity\n"
            "- 若表中存在人员、工号、区域、省份字段，优先将查询限制在当前登录用户可见范围。\n"
            "- 当用户请求跨越其授权范围时，不能通过模糊条件绕过权限限制。\n"
            "- 仅使用已提供表结构中的字段表达范围，不得臆造列名。"
        ),
    ),
    SQLSkill(
        id=None,
        name="aggregation_safety",
        description="聚合类型安全（避免 IFNULL/COALESCE 数值转字符串）",
        keywords=("sum", "avg", "汇总", "合计", "总额", "均值", "同比", "环比", "增长率"),
        content=(
            "## Skill: aggregation_safety\n"
            "- 数值聚合时保持类型安全，避免 IFNULL(col, '0') / COALESCE(col, '0.0')。\n"
            "- 数值默认值应使用无引号字面量（如 0、0.0），必要时显式 CAST。\n"
            "- 统计口径要在 SQL 中可验证（例如已完成订单、指定时间范围）。"
        ),
    ),
)


_CACHE_TTL_SEC = 45.0
_cache_value: tuple[SQLSkill, ...] | None = None
_cache_expire_at: float = 0.0


def _normalize_list(raw: object) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    out: list[str] = []
    for item in raw:
        text = str(item or "").strip()
        if text:
            out.append(text)
    return tuple(out)


def _to_dataclass(row: SQLSkillModel) -> SQLSkill:
    return SQLSkill(
        id=row.id,
        name=row.name,
        description=row.description,
        content=row.content,
        keywords=_normalize_list(row.keywords),
        sql_types=_normalize_list(row.sql_types),
        priority=int(row.priority),
        enabled=bool(row.enabled),
    )


def invalidate_sql_skill_cache() -> None:
    global _cache_value, _cache_expire_at
    _cache_value = None
    _cache_expire_at = 0.0


async def list_enabled_sql_skills(
    db: AsyncSession,
    *,
    force_reload: bool = False,
) -> tuple[SQLSkill, ...]:
    global _cache_value, _cache_expire_at
    now = time.monotonic()
    if not force_reload and _cache_value is not None and now < _cache_expire_at:
        return _cache_value

    result = await db.execute(
        select(SQLSkillModel)
        .where(SQLSkillModel.enabled.is_(True))
        .order_by(SQLSkillModel.priority.asc(), SQLSkillModel.id.asc())
    )
    rows = result.scalars().all()
    if rows:
        _cache_value = tuple(_to_dataclass(r) for r in rows)
    else:
        _cache_value = _DEFAULT_SQL_SKILLS
    _cache_expire_at = now + _CACHE_TTL_SEC
    return _cache_value


def list_skill_descriptions(skills: Sequence[SQLSkill]) -> list[str]:
    return [f"- {s.name}: {s.description}" for s in skills]


def choose_sql_skills(
    query: str,
    sql_type: str,
    tables: list[TableMetadata],
    skills: Sequence[SQLSkill],
    *,
    limit: int = 2,
) -> list[SQLSkill]:
    text = (query or "").lower()
    table_text = " ".join(
        f"{(t.table_name or '').lower()} {(t.table_comment or '').lower()}" for t in tables
    )
    scored: list[tuple[int, SQLSkill]] = []
    for skill in skills:
        if skill.sql_types and sql_type not in skill.sql_types:
            continue
        score = 0
        for kw in skill.keywords:
            if kw.lower() in text:
                score += 3
            elif kw.lower() in table_text:
                score += 1
        if score > 0:
            scored.append((score, skill))

    scored.sort(key=lambda x: (-x[0], x[1].name))
    selected = [s for _, s in scored[: max(0, limit)]]
    return selected


def render_loaded_skills(skills: list[SQLSkill]) -> str:
    if not skills:
        return ""
    return "\n\n".join(s.content for s in skills)

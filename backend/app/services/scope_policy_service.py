from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.data_scope_policy import DataScopePolicy
from app.models.user import User
from app.services.org_hierarchy import get_user_scope_codes
from app.services.scope_types import ResolvedScope

_CANONICAL_TO_ALIASES: dict[str, tuple[str, ...]] = {
    "北京": ("北京", "北京市"),
    "天津": ("天津", "天津市"),
    "上海": ("上海", "上海市"),
    "重庆": ("重庆", "重庆市"),
    "河北": ("河北", "河北省"),
    "山西": ("山西", "山西省"),
    "辽宁": ("辽宁", "辽宁省"),
    "吉林": ("吉林", "吉林省"),
    "黑龙江": ("黑龙江", "黑龙江省"),
    "江苏": ("江苏", "江苏省"),
    "浙江": ("浙江", "浙江省"),
    "安徽": ("安徽", "安徽省"),
    "福建": ("福建", "福建省"),
    "江西": ("江西", "江西省"),
    "山东": ("山东", "山东省"),
    "河南": ("河南", "河南省"),
    "湖北": ("湖北", "湖北省"),
    "湖南": ("湖南", "湖南省"),
    "广东": ("广东", "广东省"),
    "海南": ("海南", "海南省"),
    "四川": ("四川", "四川省"),
    "贵州": ("贵州", "贵州省"),
    "云南": ("云南", "云南省"),
    "陕西": ("陕西", "陕西省"),
    "甘肃": ("甘肃", "甘肃省"),
    "青海": ("青海", "青海省"),
    "台湾": ("台湾", "台湾省"),
    "内蒙古": ("内蒙古", "内蒙古自治区"),
    "广西": ("广西", "广西壮族自治区"),
    "西藏": ("西藏", "西藏自治区"),
    "宁夏": ("宁夏", "宁夏回族自治区"),
    "新疆": ("新疆", "新疆维吾尔自治区"),
    "香港": ("香港", "香港特别行政区"),
    "澳门": ("澳门", "澳门特别行政区"),
}
_ALIAS_TO_CANONICAL: dict[str, str] = {
    alias: canonical
    for canonical, aliases in _CANONICAL_TO_ALIASES.items()
    for alias in aliases
}


def canonical_province_name(raw: str | None) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    return _ALIAS_TO_CANONICAL.get(text, text)


def is_known_province_literal(raw: str | None) -> bool:
    return canonical_province_name(raw) in _CANONICAL_TO_ALIASES


def normalize_region_name(raw: str | None) -> str:
    return str(raw or "").strip()


def normalize_district_name(raw: str | None) -> str:
    return str(raw or "").strip()


def _apply_policy_values(
    current: set[str], allow: set[str], deny: set[str], merge_mode: str
) -> set[str]:
    mode = (merge_mode or "union").strip().lower()
    if mode == "replace":
        out = set(allow)
    else:
        out = set(current) | set(allow)
    if deny:
        out -= set(deny)
    return out


async def resolve_user_scope(user: User, db: AsyncSession) -> ResolvedScope:
    role_names = {r.name for r in user.roles} if user.roles else set()
    if "admin" in role_names:
        return ResolvedScope(unrestricted=True, source="admin")

    subject_pairs: list[tuple[str, str]] = [
        ("user_id", str(user.id)),
        ("user_name", user.username),
        ("level", (user.employee_level or "staff").strip()),
    ]
    for r in sorted(role_names):
        subject_pairs.append(("role", r))

    conds = [
        (DataScopePolicy.subject_type == st) & (DataScopePolicy.subject_key == sk)
        for st, sk in subject_pairs
        if sk
    ]
    policies: list[DataScopePolicy] = []
    if conds:
        stmt = (
            select(DataScopePolicy)
            .where(DataScopePolicy.enabled.is_(True))
            .where(or_(*conds))
        )
        rows = await db.execute(stmt)
        policies = rows.scalars().all()

    if not policies:
        if settings.SCOPE_POLICY_CSV_FALLBACK_ENABLED:
            fallback_codes = get_user_scope_codes(user)
            if fallback_codes is None:
                return ResolvedScope(unrestricted=True, source="csv_fallback_admin")
            prov = canonical_province_name(user.province)
            region = normalize_region_name(user.org_region)
            district = normalize_district_name(user.district)
            province_values = {prov} if prov else set()
            region_values = {region} if region else set()
            district_values = {district} if district else set()
            return ResolvedScope(
                unrestricted=False,
                province_values=province_values,
                employee_values=set(fallback_codes),
                region_values=region_values,
                district_values=district_values,
                source="csv_fallback",
            )
        # Policy-only mode: no matching policy means no data visibility.
        return ResolvedScope(unrestricted=False, source="policy_empty")

    policies = sorted(policies, key=lambda p: (p.priority, p.id))
    out = ResolvedScope(unrestricted=False, source="policy")

    for p in policies:
        out.policy_ids.append(p.id)
        allow_raw = set((p.allowed_values or []))
        deny_raw = set((p.deny_values or []))
        if p.dimension == "province":
            allow = {canonical_province_name(v) for v in allow_raw if canonical_province_name(v)}
            deny = {canonical_province_name(v) for v in deny_raw if canonical_province_name(v)}
            out.province_values = _apply_policy_values(
                out.province_values, allow, deny, p.merge_mode
            )
        elif p.dimension == "employee":
            allow = {str(v).strip() for v in allow_raw if str(v).strip()}
            deny = {str(v).strip() for v in deny_raw if str(v).strip()}
            out.employee_values = _apply_policy_values(
                out.employee_values, allow, deny, p.merge_mode
            )
        elif p.dimension == "region":
            allow = {normalize_region_name(v) for v in allow_raw if normalize_region_name(v)}
            deny = {normalize_region_name(v) for v in deny_raw if normalize_region_name(v)}
            out.region_values = _apply_policy_values(
                out.region_values, allow, deny, p.merge_mode
            )
        elif p.dimension == "district":
            allow = {
                normalize_district_name(v)
                for v in allow_raw
                if normalize_district_name(v)
            }
            deny = {
                normalize_district_name(v)
                for v in deny_raw
                if normalize_district_name(v)
            }
            out.district_values = _apply_policy_values(
                out.district_values, allow, deny, p.merge_mode
            )

    return out

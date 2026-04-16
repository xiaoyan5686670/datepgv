from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.data_scope_policy import DataScopePolicy
from app.models.user import User
from app.services.org_hierarchy import get_user_scope_codes
from app.services.scope_types import ResolvedScope

from app.services.province_alias_service import canonical_province_name

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


def _apply_staff_peer_isolated_scope(user: User, scope: ResolvedScope) -> None:
    """
    业务经理（staff）：仅本人标识可见；地理维度不得与同省同事 OR 放宽。
    在 scope 上就地修改。
    """
    if (user.employee_level or "staff").strip() != "staff":
        return
    own = get_user_scope_codes(user)
    if own is None:
        return
    scope.province_values.clear()
    scope.region_values.clear()
    scope.district_values.clear()
    if scope.employee_values:
        scope.employee_values = scope.employee_values & own
    else:
        scope.employee_values = set(own)


async def resolve_user_scope(user: User, db: AsyncSession) -> ResolvedScope:
    role_names = {r.name for r in user.roles} if user.roles else set()
    if "admin" in role_names:
        return ResolvedScope(unrestricted=True, source="admin")

    uname = (user.username or "").strip()
    subject_pairs: list[tuple[str, str]] = [
        ("user_id", str(user.id)),
    ]
    # Policies may use subject_type=user_id with business login / 工号 (e.g. XY001475), not only DB id.
    if uname:
        subject_pairs.append(("user_id", uname))
    subject_pairs.extend(
        [
            ("user_name", uname),
            ("level", (user.employee_level or "staff").strip()),
        ]
    )
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
            fb_scope = ResolvedScope(
                unrestricted=False,
                province_values=province_values,
                employee_values=set(fallback_codes),
                region_values=region_values,
                district_values=district_values,
                source="csv_fallback",
            )
            _apply_staff_peer_isolated_scope(user, fb_scope)
            return fb_scope
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

    _apply_staff_peer_isolated_scope(user, out)
    return out

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import text

# Fallback defaults to keep service available before DB cache warms up.
_DEFAULT_CANONICAL_TO_ALIASES: dict[str, tuple[str, ...]] = {
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
    "内蒙古": ("内蒙古", "内蒙古自治区", "内蒙"),
    "广西": ("广西", "广西壮族自治区"),
    "西藏": ("西藏", "西藏自治区"),
    "宁夏": ("宁夏", "宁夏回族自治区"),
    "新疆": ("新疆", "新疆维吾尔自治区"),
    "香港": ("香港", "香港特别行政区"),
    "澳门": ("澳门", "澳门特别行政区"),
}


def _build_alias_index(
    canonical_to_aliases: dict[str, tuple[str, ...]]
) -> dict[str, str]:
    out: dict[str, str] = {}
    for canonical, aliases in canonical_to_aliases.items():
        out[canonical] = canonical
        for alias in aliases:
            if alias:
                out[alias] = canonical
    return out


_cached_canonical_to_aliases: dict[str, tuple[str, ...]] = dict(_DEFAULT_CANONICAL_TO_ALIASES)
_cached_alias_to_canonical: dict[str, str] = _build_alias_index(_cached_canonical_to_aliases)


def _normalize_pairs(rows: Iterable[tuple[str, str]]) -> dict[str, tuple[str, ...]]:
    grouped: dict[str, list[str]] = {}
    seen: dict[str, set[str]] = {}
    for canonical_name, alias in rows:
        canonical = str(canonical_name or "").strip()
        ali = str(alias or "").strip()
        if not canonical or not ali:
            continue
        if canonical not in grouped:
            grouped[canonical] = []
            seen[canonical] = set()
        if ali not in seen[canonical]:
            seen[canonical].add(ali)
            grouped[canonical].append(ali)
        if canonical not in seen[canonical]:
            seen[canonical].add(canonical)
            grouped[canonical].append(canonical)
    return {k: tuple(v) for k, v in grouped.items()}


async def reload_province_alias_cache(conn: Any) -> None:  # type: ignore[type-arg]
    row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'province_aliases' LIMIT 1"
        )
    )
    if row.scalar() is None:
        return

    res = await conn.execute(
        text(
            "SELECT canonical_name, alias "
            "FROM province_aliases "
            "WHERE enabled = TRUE "
            "ORDER BY priority ASC, id ASC"
        )
    )
    rows = [(r[0], r[1]) for r in res.fetchall()]
    if not rows:
        return

    canonical_to_aliases = _normalize_pairs(rows)
    if not canonical_to_aliases:
        return

    global _cached_canonical_to_aliases, _cached_alias_to_canonical
    _cached_canonical_to_aliases = canonical_to_aliases
    _cached_alias_to_canonical = _build_alias_index(canonical_to_aliases)


def canonical_province_name(raw: str | None) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    return _cached_alias_to_canonical.get(text, text)


def is_known_province_literal(raw: str | None) -> bool:
    return canonical_province_name(raw) in _cached_canonical_to_aliases


def province_canonicals_mentioned_in_text(text: str) -> set[str]:
    if not text:
        return set()
    out: set[str] = set()
    for alias in sorted(_cached_alias_to_canonical.keys(), key=len, reverse=True):
        if len(alias) < 2:
            continue
        if alias in text:
            out.add(_cached_alias_to_canonical[alias])
    for canon in _cached_canonical_to_aliases:
        if len(canon) >= 2 and canon in text:
            out.add(canon)
    return out


def province_alias_literals_for_canonicals(canonicals: set[str]) -> set[str]:
    out: set[str] = set()
    for c in canonicals:
        canon = canonical_province_name(c)
        if not canon:
            continue
        aliases = _cached_canonical_to_aliases.get(canon)
        if aliases:
            out.update(a for a in aliases if a)
        out.add(canon)
    return out

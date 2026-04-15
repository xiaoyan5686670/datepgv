"""
Read-only execution of generated SQL against optional analytics databases (PostgreSQL / MySQL).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time
from decimal import Decimal
from typing import Any, Literal
from urllib.parse import unquote, urlparse
from uuid import UUID

import asyncpg
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.analytics_db_connection_service import resolve_execute_url
from app.services.scope_types import ResolvedScope

SqlEngine = Literal["postgresql", "mysql"]

logger = logging.getLogger(__name__)

_SCOPE_CODE_COLUMNS = (
    "renyuanbianma",
    "employee_code",
    "owner_code",
    "sales_code",
    "manager_code",
    "user_code",
)
_SCOPE_NAME_COLUMNS = (
    "yewujingli",
    "full_name",
    "owner",
    "sales_name",
    "manager_name",
    "mgr_name",
    "username",
)
_SCOPE_PROVINCE_COLUMNS = (
    "shengfen",
    "province",
    "province_name",
    "prov",
    "prov_name",
)
_SCOPE_REGION_COLUMNS = (
    "daqua",
    "org_region",
    "region",
    "region_name",
)
_SCOPE_DISTRICT_COLUMNS = (
    "quyud",
    "district",
    "district_name",
    "area_name",
)


class QueryExecutorError(Exception):
    """User-facing execution error (safe message)."""


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    truncated: bool


_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|"
    r"REPLACE|MERGE|CALL|EXEC|EXECUTE|COPY|VACUUM)\b",
    re.IGNORECASE | re.DOTALL,
)


def _strip_trailing_semicolon(sql: str) -> str:
    return sql.strip().rstrip().rstrip(";")


def assert_single_read_statement(sql: str) -> str:
    """
    Basic safety: one statement, intended read-only (SELECT / WITH).
    """
    s = _strip_trailing_semicolon(sql)
    if not s:
        raise QueryExecutorError("SQL 为空，无法执行")
    core = s
    if ";" in core:
        raise QueryExecutorError("不允许一次执行多条 SQL")
    if _FORBIDDEN.search(core):
        raise QueryExecutorError("仅允许只读查询（SELECT / WITH 等）")
    probe = core.lstrip()
    while probe.startswith("--"):
        next_nl = probe.find("\n")
        if next_nl == -1:
            probe = ""
            break
        probe = probe[next_nl + 1 :].lstrip()
    if not probe:
        raise QueryExecutorError("SQL 无有效语句")
    upper = probe.upper()
    if upper.startswith("SELECT") or upper.startswith("WITH") or upper.startswith("("):
        return s
    raise QueryExecutorError("仅支持以 SELECT 或 WITH 开头的查询")


def _truncate_cell(val: Any) -> Any:
    if val is None:
        return None
    # Drivers return Decimal / datetime / UUID etc.; JSONB + json.dumps need JSON-native scalars.
    if isinstance(val, Decimal):
        val = float(val)
    elif isinstance(val, datetime):
        val = val.isoformat()
    elif isinstance(val, date):
        val = val.isoformat()
    elif isinstance(val, dt_time):
        val = val.isoformat()
    elif isinstance(val, UUID):
        val = str(val)
    if isinstance(val, (bytes, bytearray)):
        s = val.decode("utf-8", errors="replace")
    else:
        s = str(val)
    cap = settings.ANALYTICS_MAX_CELL_CHARS
    if len(s) > cap:
        return s[:cap] + "…"
    return val


def _normalize_postgres_dsn(url: str) -> str:
    u = url.strip()
    if "://" in u:
        scheme_part = u.split("://", 1)[0]
        if "+asyncpg" in scheme_part:
            u = u.replace("postgresql+asyncpg://", "postgresql://", 1)
    return u


def _parse_mysql_url(url: str) -> dict[str, Any]:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("mysql", "mariadb"):
        raise QueryExecutorError("MySQL 连接须为 mysql:// 或 mariadb://")
    db = (parsed.path or "").lstrip("/").split("/")[0] or None
    if not db:
        raise QueryExecutorError("MySQL URL 须包含数据库名")
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "db": db,
    }


def _quote_pg_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _quote_mysql_ident(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def _quote_sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _build_scoped_wrapped_sql(
    engine: SqlEngine,
    sql: str,
    visible_columns: list[str],
    scope: ResolvedScope | None,
) -> str:
    if scope is None or scope.unrestricted:
        return sql

    if not scope.has_any_constraint:
        # No visible identity means no rows should be readable.
        return f"SELECT * FROM ({sql}) __scope_base WHERE 1=0"

    visible_lower_to_raw = {c.lower(): c for c in visible_columns}
    predicates: list[str] = []

    def _add_predicates(
        columns: tuple[str, ...], values: set[str], *, is_pg: bool
    ) -> None:
        scoped_values = sorted({v for v in values if str(v).strip()})
        if not scoped_values:
            return
        matched_cols = [visible_lower_to_raw[c] for c in columns if c in visible_lower_to_raw]
        if not matched_cols:
            return
        in_list = ", ".join(_quote_sql_str(v) for v in scoped_values)
        for col in matched_cols:
            if is_pg:
                predicates.append(f"CAST({_quote_pg_ident(col)} AS TEXT) IN ({in_list})")
            else:
                predicates.append(f"CAST({_quote_mysql_ident(col)} AS CHAR) IN ({in_list})")

    if engine == "postgresql":
        _add_predicates(
            _SCOPE_CODE_COLUMNS + _SCOPE_NAME_COLUMNS,
            set(scope.employee_values),
            is_pg=True,
        )
        _add_predicates(
            _SCOPE_PROVINCE_COLUMNS,
            set(scope.province_values),
            is_pg=True,
        )
        _add_predicates(
            _SCOPE_REGION_COLUMNS,
            set(scope.region_values),
            is_pg=True,
        )
        _add_predicates(
            _SCOPE_DISTRICT_COLUMNS,
            set(scope.district_values),
            is_pg=True,
        )
    else:
        _add_predicates(
            _SCOPE_CODE_COLUMNS + _SCOPE_NAME_COLUMNS,
            set(scope.employee_values),
            is_pg=False,
        )
        _add_predicates(
            _SCOPE_PROVINCE_COLUMNS,
            set(scope.province_values),
            is_pg=False,
        )
        _add_predicates(
            _SCOPE_REGION_COLUMNS,
            set(scope.region_values),
            is_pg=False,
        )
        _add_predicates(
            _SCOPE_DISTRICT_COLUMNS,
            set(scope.district_values),
            is_pg=False,
        )
    if not predicates:
        # Query result doesn't expose identity columns; block data by default.
        return f"SELECT * FROM ({sql}) __scope_base WHERE 1=0"
    where_expr = " OR ".join(predicates)
    return f"SELECT * FROM ({sql}) __scope_base WHERE ({where_expr})"


async def _probe_postgresql_columns(conn: asyncpg.Connection, sql: str) -> list[str]:
    try:
        stmt = await conn.prepare(f"SELECT * FROM ({sql}) __scope_probe LIMIT 0")
        return [a.name for a in stmt.get_attributes()]
    except Exception as e:
        raise QueryExecutorError(
            f"SQL 预编译失败（可能存在类型不匹配或语法错误）：{e}"
        ) from e


async def _run_postgresql(
    dsn: str, sql: str, scope: ResolvedScope | None = None
) -> QueryResult:
    dsn = _normalize_postgres_dsn(dsn)
    timeout = float(settings.ANALYTICS_QUERY_TIMEOUT_SEC)
    max_rows = settings.ANALYTICS_MAX_ROWS
    conn = await asyncpg.connect(dsn, command_timeout=timeout)
    try:
        async with conn.transaction(readonly=True):
            ms = max(1000, int(timeout * 1000))
            await conn.execute(f"SET LOCAL statement_timeout = {ms}")
            probe_columns = await _probe_postgresql_columns(conn, sql)
            scoped_sql = _build_scoped_wrapped_sql(
                "postgresql", sql, probe_columns, scope
            )
            rows_out: list[dict[str, Any]] = []
            truncated = False
            async for rec in conn.cursor(scoped_sql, timeout=timeout):
                if len(rows_out) >= max_rows:
                    truncated = True
                    break
                d = {k: _truncate_cell(rec[k]) for k in rec.keys()}
                rows_out.append(d)
            if not rows_out:
                return QueryResult(columns=[], rows=[], truncated=False)
            columns = list(rows_out[0].keys())
            return QueryResult(columns=columns, rows=rows_out, truncated=truncated)
    finally:
        await conn.close()


def mysql_err_code_from_exception(e: BaseException) -> int | None:
    args = getattr(e, "args", None)
    if args and isinstance(args[0], int):
        return args[0]
    # aiomysql 有时只把 (2013, '...') 放在 str 里
    s = str(e)
    if s.startswith("(") and "," in s:
        inner = s.split(",", 1)[0].strip("(").strip()
        if inner.isdigit():
            return int(inner)
    return None


def friendly_mysql_access_error(exc: BaseException) -> str | None:
    """Map common MySQL / PyMySQL error codes to actionable Chinese messages."""
    candidates: list[BaseException] = [exc]
    if getattr(exc, "__cause__", None) is not None:
        candidates.append(exc.__cause__)  # type: ignore[arg-type]

    codes: list[int] = []
    for e in candidates:
        c = mysql_err_code_from_exception(e)
        if c is not None:
            codes.append(c)
    if not codes:
        blob = " ".join(str(c) for c in candidates)
        if "2013" in blob or "Lost connection to MySQL server" in blob:
            codes.append(2013)
        elif "2006" in blob and "MySQL server has gone away" in blob:
            codes.append(2006)

    # Doris / StarRocks (MySQL protocol): parse errors often look like
    # (1105, "errCode = 2, detailMessage = Please check your sql ...")
    blob_all = " ".join(str(c) for c in candidates)
    blob_lower = blob_all.lower()
    if "detailmessage" in blob_lower and "check your sql" in blob_lower:
        return (
            "分析库返回 SQL 解析错误（含 errCode/detailMessage 时，常见于 Apache Doris、"
            "StarRocks 等兼容 MySQL 协议的引擎，错误码多为 1105）。"
            "请核对生成的 SQL 是否被该引擎支持：函数名、保留字、子查询/CTE、LIMIT、字符串引号等。"
            "可在目标库的客户端中对同一条 SQL 直接执行以定位语法问题。"
            f" 原始信息：{blob_all[:400]}"
        )

    for code in codes:
        if code == 1044:
            return (
                "MySQL 错误 1044：该账号没有访问 URL 中所指定「数据库」的权限。"
                "请在 MySQL 上由管理员执行（按需替换库名、账号与主机）："
                "GRANT SELECT ON `你的库名`.* TO '你的用户'@'%'; FLUSH PRIVILEGES; "
                "（本系统只做只读查询，给 SELECT 即可；'%' 表示任意客户端主机，可按安全策略改为固定 IP。）"
            )
        if code == 1045:
            return (
                "MySQL 错误 1045：用户名或密码错误，或该用户不允许从你当前网络位置连接。"
            )
        if code == 1049:
            return (
                "MySQL 错误 1049：URL 中的数据库名不存在，请检查路径里的库名拼写。"
            )
        if code == 2003:
            return (
                "MySQL 错误 2003：无法连上服务器（地址/端口错误或 MySQL 未监听外网）。"
            )
        if code in (2006, 2013):
            return (
                "MySQL 错误 "
                f"{code}：查询过程中与服务器断开（网络抖动、网关超时、或 SQL/结果过大导致读超时）。"
                "可尝试：1）给 SQL 加 LIMIT、缩小时间范围；2）检查应用与 MySQL 之间是否有负载均衡/防火墙空闲超时；"
                "3）在 MySQL 上适当增大 wait_timeout、net_read_timeout、max_allowed_packet；"
                f"4）在后端 .env 增大 ANALYTICS_QUERY_TIMEOUT_SEC（当前 {settings.ANALYTICS_QUERY_TIMEOUT_SEC}s）后重启。"
            )
    return None


def _require_aiomysql():
    try:
        import aiomysql
    except ImportError as e:
        raise QueryExecutorError(
            "后端未安装 aiomysql。请在 backend 目录执行：pip install -r requirements.txt"
        ) from e
    return aiomysql


async def _probe_mysql_columns(cur: Any, sql: str, timeout: float) -> list[str]:
    await asyncio.wait_for(cur.execute(f"SELECT * FROM ({sql}) __scope_probe LIMIT 0"), timeout=timeout)
    return [str(d[0]) for d in (cur.description or [])]


async def _run_mysql(
    dsn: str, sql: str, scope: ResolvedScope | None = None
) -> QueryResult:
    aiomysql = _require_aiomysql()

    params = _parse_mysql_url(dsn)
    timeout = settings.ANALYTICS_QUERY_TIMEOUT_SEC
    max_rows = settings.ANALYTICS_MAX_ROWS
    try:
        # aiomysql.connect 未透传 PyMySQL 的 read_timeout/write_timeout，仅用 connect_timeout +
        # asyncio.wait_for 控制执行与取数超时。
        conn = await aiomysql.connect(
            host=params["host"],
            port=params["port"],
            user=params["user"],
            password=params["password"],
            db=params["db"],
            connect_timeout=min(timeout, 30),
            autocommit=False,
        )
    except Exception as e:
        hint = friendly_mysql_access_error(e)
        raise QueryExecutorError(hint or str(e)) from e
    try:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            try:
                await cur.execute("SET SESSION TRANSACTION READ ONLY")
            except Exception:
                pass
            try:
                probe_columns = await _probe_mysql_columns(cur, sql, timeout)
                scoped_sql = _build_scoped_wrapped_sql(
                    "mysql", sql, probe_columns, scope
                )
            except Exception as e:
                hint = friendly_mysql_access_error(e)
                raise QueryExecutorError(hint or str(e)) from e
            try:
                await asyncio.wait_for(cur.execute(scoped_sql), timeout=timeout)
            except Exception as e:
                hint = friendly_mysql_access_error(e)
                raise QueryExecutorError(hint or str(e)) from e
            try:
                batch = await asyncio.wait_for(
                    cur.fetchmany(max_rows + 1), timeout=timeout
                )
            except Exception as e:
                hint = friendly_mysql_access_error(e)
                raise QueryExecutorError(hint or str(e)) from e
            truncated = len(batch) > max_rows
            if truncated:
                batch = batch[:max_rows]
            rows_out = [{k: _truncate_cell(v) for k, v in row.items()} for row in batch]
        await conn.commit()
        columns = list(rows_out[0].keys()) if rows_out else []
        return QueryResult(columns=columns, rows=rows_out, truncated=truncated)
    finally:
        conn.close()


async def run_analytics_query(
    engine: SqlEngine,
    sql: str,
    db: AsyncSession,
    scope: ResolvedScope | None = None,
    connection_id: int | None = None,
) -> QueryResult:
    safe_sql = assert_single_read_statement(sql)
    threshold_ms = float(settings.ANALYTICS_SLOW_QUERY_LOG_MS)
    t0 = time.perf_counter()
    try:
        if engine == "postgresql":
            dsn = await resolve_execute_url(db, "postgresql", connection_id)
            if not dsn:
                raise QueryExecutorError(
                    "无法连接 PostgreSQL 业务库：请在「设置 → 数据连接」配置，"
                    "或设置 DATABASE_URL / ANALYTICS_POSTGRES_URL。"
                )
            return await _run_postgresql(dsn, safe_sql, scope)
        dsn = await resolve_execute_url(db, "mysql", connection_id)
        if not dsn:
            raise QueryExecutorError(
                "未配置 MySQL 连接：请在「设置 → 数据连接」填写，或设置 ANALYTICS_MYSQL_URL。"
            )
        return await _run_mysql(dsn, safe_sql, scope)
    finally:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if elapsed_ms >= threshold_ms:
            preview = " ".join(safe_sql.split())
            if len(preview) > 220:
                preview = preview[:220] + "…"
            logger.warning(
                "slow analytics query: %.0fms (threshold=%.0fms engine=%s). "
                "On the analytics DB run PostgreSQL EXPLAIN (ANALYZE, BUFFERS) "
                "or MySQL EXPLAIN ANALYZE on the same SQL; check network RTT. preview=%s",
                elapsed_ms,
                threshold_ms,
                engine,
                preview,
            )


async def ping_postgresql_dsn(dsn: str) -> None:
    dsn = _normalize_postgres_dsn(dsn)
    conn = await asyncpg.connect(dsn, command_timeout=5.0)
    try:
        await conn.fetchval("SELECT 1")
    finally:
        await conn.close()


async def ping_mysql_dsn(dsn: str) -> None:
    aiomysql = _require_aiomysql()

    params = _parse_mysql_url(dsn)
    try:
        conn = await aiomysql.connect(
            host=params["host"],
            port=params["port"],
            user=params["user"],
            password=params["password"],
            db=params["db"],
            connect_timeout=5,
            autocommit=True,
        )
    except Exception as e:
        hint = friendly_mysql_access_error(e)
        raise QueryExecutorError(hint or str(e)) from e
    try:
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1")
    finally:
        conn.close()

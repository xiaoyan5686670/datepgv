"""
One-time startup SQL migrations.

These run every time the app starts, but are idempotent – they check
current state before applying changes so re-runs are safe.
"""
import json
import logging

from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine

logger = logging.getLogger(__name__)


_PROVINCE_ALIAS_SEED: dict[str, tuple[str, ...]] = {
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

_SQL_SKILL_SEED: tuple[dict[str, object], ...] = (
    {
        "name": "province_filtering",
        "description": "省份过滤与同义词规范（禁止省份字段 LIKE）",
        "content": (
            "## Skill: province_filtering\n"
            "- 省份过滤必须使用等值（= / IN），禁止在省份字段上使用 LIKE 模糊匹配或 LIKE 关联。\n"
            "- 省份值优先使用规范名称；必要时可在 IN 中包含规范值与常见别名。\n"
            "- 若用户请求包含未授权省份，不要放宽条件。"
        ),
        "keywords": ["省", "省份", "地区", "区域", "大区", "内蒙", "广西", "广东", "河南"],
        "sql_types": [],
        "priority": 100,
    },
    {
        "name": "scope_and_identity",
        "description": "按登录用户范围裁剪（人员/区域/省份）",
        "content": (
            "## Skill: scope_and_identity\n"
            "- 若表中存在人员、工号、区域、省份字段，优先将查询限制在当前登录用户可见范围。\n"
            "- 当用户请求跨越其授权范围时，不能通过模糊条件绕过权限限制。\n"
            "- 仅使用已提供表结构中的字段表达范围，不得臆造列名。"
        ),
        "keywords": ["我的", "本人", "我", "下级", "团队", "辖区", "范围", "权限", "员工", "经理"],
        "sql_types": [],
        "priority": 110,
    },
    {
        "name": "aggregation_safety",
        "description": "聚合类型安全（避免 IFNULL/COALESCE 数值转字符串）",
        "content": (
            "## Skill: aggregation_safety\n"
            "- 数值聚合时保持类型安全，避免 IFNULL(col, '0') / COALESCE(col, '0.0')。\n"
            "- 数值默认值应使用无引号字面量（如 0、0.0），必要时显式 CAST。\n"
            "- 统计口径要在 SQL 中可验证（例如已完成订单、指定时间范围）。"
        ),
        "keywords": ["sum", "avg", "汇总", "合计", "总额", "均值", "同比", "环比", "增长率"],
        "sql_types": [],
        "priority": 120,
    },
)


async def run_migrations() -> None:
    """Apply pending schema / data migrations at startup."""
    async with engine.begin() as conn:
        await _fix_user_id_column_type(conn)
        await _migrate_orphaned_sessions(conn)
        await _enforce_session_user_id_not_null(conn)
        await _ensure_user_id_fk(conn)
        await _ensure_data_scope_policy_table(conn)
        await _backfill_scope_policies_from_users(conn)
        await _ensure_province_aliases_table(conn)
        await _seed_province_aliases(conn)
        from app.services.province_alias_service import reload_province_alias_cache

        await reload_province_alias_cache(conn)
        await _ensure_rag_chunks_table(conn)
        await _ensure_users_rag_permission_override(conn)
        await _ensure_chat_messages_stats_indexes(conn)
        await _ensure_login_audit_table(conn)
        await _ensure_chat_messages_elapsed_ms(conn)
        await _ensure_sql_skills_table(conn)
        await _seed_sql_skills(conn)
        await _ensure_chat_messages_decision_trace(conn)
        await _ensure_users_avatar_data(conn)


async def _fix_user_id_column_type(conn) -> None:  # type: ignore[type-arg]
    """Convert chat_sessions.user_id from VARCHAR to INTEGER if needed.

    Early versions of the schema created this column as character varying.
    The ORM model expects integer (FK → users.id).
    """
    row = await conn.execute(
        text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = 'chat_sessions' AND column_name = 'user_id'"
        )
    )
    dtype = row.scalar()
    if dtype is None:
        return
    if dtype == "integer":
        return  # already correct

    logger.info(
        "DB migration: chat_sessions.user_id is '%s', converting to integer …",
        dtype,
    )

    # Delete rows whose user_id cannot be cast or references a non-existent user
    await conn.execute(
        text(
            "DELETE FROM chat_sessions "
            "WHERE user_id !~ '^[0-9]+$' "
            "   OR user_id::integer NOT IN (SELECT id FROM users)"
        )
    )

    await conn.execute(
        text(
            "ALTER TABLE chat_sessions "
            "ALTER COLUMN user_id TYPE integer USING user_id::integer"
        )
    )
    logger.info("DB migration: chat_sessions.user_id converted to integer.")


async def _migrate_orphaned_sessions(conn) -> None:  # type: ignore[type-arg]
    """Assign chat_sessions with user_id IS NULL to the admin user."""
    result = await conn.execute(
        text(
            "UPDATE chat_sessions "
            "SET user_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1) "
            "WHERE user_id IS NULL "
            "  AND EXISTS (SELECT 1 FROM users WHERE username = 'admin')"
        )
    )
    if result.rowcount > 0:
        logger.info(
            "DB migration: assigned %d orphaned session(s) to admin.",
            result.rowcount,
        )


async def _enforce_session_user_id_not_null(conn) -> None:  # type: ignore[type-arg]
    """Add NOT NULL constraint to chat_sessions.user_id once no NULL rows remain."""
    nullable_row = await conn.execute(
        text(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name = 'chat_sessions' AND column_name = 'user_id'"
        )
    )
    row = nullable_row.fetchone()
    if row is None or row[0] != "YES":
        return

    null_count_row = await conn.execute(
        text("SELECT COUNT(*) FROM chat_sessions WHERE user_id IS NULL")
    )
    remaining = null_count_row.scalar() or 0
    if remaining > 0:
        logger.warning(
            "DB migration: %d session(s) still have user_id IS NULL. "
            "NOT NULL constraint deferred.",
            remaining,
        )
        return

    await conn.execute(
        text("ALTER TABLE chat_sessions ALTER COLUMN user_id SET NOT NULL")
    )
    logger.info("DB migration: chat_sessions.user_id is now NOT NULL.")


async def _ensure_user_id_fk(conn) -> None:  # type: ignore[type-arg]
    """Add FK constraint user_id → users.id if missing."""
    fk_exists = await conn.execute(
        text(
            "SELECT 1 FROM pg_constraint "
            "WHERE conrelid = 'chat_sessions'::regclass "
            "  AND conname = 'chat_sessions_user_id_fkey'"
        )
    )
    if fk_exists.scalar() is not None:
        return

    await conn.execute(
        text(
            "ALTER TABLE chat_sessions "
            "ADD CONSTRAINT chat_sessions_user_id_fkey "
            "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
        )
    )
    logger.info("DB migration: added FK chat_sessions.user_id → users.id.")


async def _ensure_data_scope_policy_table(conn) -> None:  # type: ignore[type-arg]
    exists_row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'data_scope_policies' LIMIT 1"
        )
    )
    if exists_row.scalar() is not None:
        return

    await conn.execute(
        text(
            """
            CREATE TABLE data_scope_policies (
                id SERIAL PRIMARY KEY,
                subject_type VARCHAR(20) NOT NULL,
                subject_key VARCHAR(120) NOT NULL,
                dimension VARCHAR(32) NOT NULL,
                allowed_values JSONB NOT NULL DEFAULT '[]'::jsonb,
                deny_values JSONB NOT NULL DEFAULT '[]'::jsonb,
                merge_mode VARCHAR(16) NOT NULL DEFAULT 'union',
                priority INTEGER NOT NULL DEFAULT 100,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                note TEXT NULL,
                updated_by VARCHAR(100) NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_data_scope_policy_subject_dimension
                    UNIQUE(subject_type, subject_key, dimension)
            )
            """
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX idx_data_scope_policies_subject "
            "ON data_scope_policies(subject_type, subject_key)"
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX idx_data_scope_policies_dim_enabled "
            "ON data_scope_policies(dimension, enabled)"
        )
    )
    logger.info("DB migration: created table data_scope_policies.")


async def _backfill_scope_policies_from_users(conn) -> None:  # type: ignore[type-arg]
    if not settings.SCOPE_POLICY_AUTO_BACKFILL_ON_STARTUP:
        return
    # Province baseline
    province_res = await conn.execute(
        text(
            """
            INSERT INTO data_scope_policies
              (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
            SELECT
              'user_id',
              CAST(u.id AS VARCHAR),
              'province',
              to_jsonb(ARRAY[u.province]),
              '[]'::jsonb,
              'replace',
              100,
              TRUE,
              'startup baseline from users profile',
              'startup-migration'
            FROM users u
            WHERE COALESCE(TRIM(u.province), '') <> ''
            ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING
            """
        )
    )
    # Region baseline
    region_res = await conn.execute(
        text(
            """
            INSERT INTO data_scope_policies
              (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
            SELECT
              'user_id',
              CAST(u.id AS VARCHAR),
              'region',
              to_jsonb(ARRAY[u.org_region]),
              '[]'::jsonb,
              'replace',
              110,
              TRUE,
              'startup baseline from users profile',
              'startup-migration'
            FROM users u
            WHERE COALESCE(TRIM(u.org_region), '') <> ''
            ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING
            """
        )
    )
    # District baseline
    district_res = await conn.execute(
        text(
            """
            INSERT INTO data_scope_policies
              (subject_type, subject_key, dimension, allowed_values, deny_values, merge_mode, priority, enabled, note, updated_by)
            SELECT
              'user_id',
              CAST(u.id AS VARCHAR),
              'district',
              to_jsonb(ARRAY[u.district]),
              '[]'::jsonb,
              'replace',
              120,
              TRUE,
              'startup baseline from users profile',
              'startup-migration'
            FROM users u
            WHERE COALESCE(TRIM(u.district), '') <> ''
            ON CONFLICT (subject_type, subject_key, dimension) DO NOTHING
            """
        )
    )
    seeded = (
        (province_res.rowcount or 0)
        + (region_res.rowcount or 0)
        + (district_res.rowcount or 0)
    )
    if seeded > 0:
        logger.info("DB migration: seeded %d baseline scope policies from users.", seeded)


async def _ensure_province_aliases_table(conn) -> None:  # type: ignore[type-arg]
    exists_row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'province_aliases' LIMIT 1"
        )
    )
    if exists_row.scalar() is not None:
        return

    await conn.execute(
        text(
            """
            CREATE TABLE province_aliases (
                id SERIAL PRIMARY KEY,
                canonical_name VARCHAR(50) NOT NULL,
                alias VARCHAR(50) NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                priority INTEGER NOT NULL DEFAULT 100,
                updated_by VARCHAR(100) NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_province_alias_alias UNIQUE(alias)
            )
            """
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX idx_province_aliases_canonical_enabled "
            "ON province_aliases(canonical_name, enabled)"
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX idx_province_aliases_enabled_priority "
            "ON province_aliases(enabled, priority, id)"
        )
    )
    logger.info("DB migration: created table province_aliases.")


async def _seed_province_aliases(conn) -> None:  # type: ignore[type-arg]
    exists_row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_name = 'province_aliases' LIMIT 1"
        )
    )
    if exists_row.scalar() is None:
        return

    seeded = 0
    for canonical, aliases in _PROVINCE_ALIAS_SEED.items():
        for alias in aliases:
            res = await conn.execute(
                text(
                    """
                    INSERT INTO province_aliases
                      (canonical_name, alias, enabled, priority, updated_by)
                    VALUES
                      (:canonical_name, :alias, TRUE, 100, 'startup-migration')
                    ON CONFLICT (alias) DO NOTHING
                    """
                ),
                {"canonical_name": canonical, "alias": alias},
            )
            seeded += res.rowcount or 0

    if seeded > 0:
        logger.info("DB migration: seeded %d province alias rows.", seeded)


async def _ensure_rag_chunks_table(conn) -> None:  # type: ignore[type-arg]
    """Create rag_chunks + indexes when missing (vector dim from settings.EMBEDDING_DIM)."""
    exists_row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'rag_chunks' LIMIT 1"
        )
    )
    dim = int(settings.EMBEDDING_DIM)
    if exists_row.scalar() is None:
        await conn.execute(
            text(
                f"""
                CREATE TABLE rag_chunks (
                    id              BIGSERIAL PRIMARY KEY,
                    content         TEXT NOT NULL,
                    embedding       vector({dim}),
                    metadata        JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    hierarchy_path  JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT chk_rag_chunks_hierarchy_path_is_array
                        CHECK (jsonb_typeof(hierarchy_path) = 'array'),
                    CONSTRAINT chk_rag_chunks_metadata_hierarchy_path
                        CHECK (
                            NOT (metadata ? 'hierarchy_path')
                            OR jsonb_typeof(metadata->'hierarchy_path') = 'array'
                        )
                )
                """
            )
        )
        logger.info("DB migration: created table rag_chunks (vector(%d)).", dim)
    else:
        # Optional sanity check: embedding column dimension vs settings
        col = await conn.execute(
            text(
                "SELECT format_type(a.atttypid, a.atttypmod) AS pg_type "
                "FROM pg_attribute a "
                "JOIN pg_class c ON a.attrelid = c.oid "
                "WHERE c.relname = 'rag_chunks' AND a.attname = 'embedding' "
                "AND NOT a.attisdropped AND a.attnum > 0"
            )
        )
        row = col.fetchone()
        if row and row[0] and str(dim) not in str(row[0]):
            logger.warning(
                "DB migration: rag_chunks.embedding type is %s but EMBEDDING_DIM=%s; "
                "align model output with DB or recreate rag_chunks.",
                row[0],
                dim,
            )

    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS rag_chunks_hierarchy_path_gin "
            "ON rag_chunks USING gin (hierarchy_path jsonb_path_ops)"
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS rag_chunks_embedding_ivfflat_idx "
            "ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)"
        )
    )


async def _ensure_users_rag_permission_override(conn) -> None:  # type: ignore[type-arg]
    col = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'users' "
            "AND column_name = 'rag_permission_override'"
        )
    )
    if col.scalar() is not None:
        return
    await conn.execute(
        text(
            "ALTER TABLE users ADD COLUMN rag_permission_override JSONB NULL"
        )
    )
    await conn.execute(
        text(
            "COMMENT ON COLUMN users.rag_permission_override IS "
            "'Admin RAG ABAC override JSON; NULL means auto from org CSV'"
        )
    )
    logger.info("DB migration: added users.rag_permission_override.")


async def _ensure_chat_messages_stats_indexes(conn) -> None:  # type: ignore[type-arg]
    """Speed up chat question stats (role=user + time range scans)."""
    exists = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'chat_messages' LIMIT 1"
        )
    )
    if exists.scalar() is None:
        return
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS chat_messages_role_created_at_idx "
            "ON public.chat_messages (role, created_at DESC)"
        )
    )


async def _ensure_login_audit_table(conn) -> None:  # type: ignore[type-arg]
    row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'login_audit' LIMIT 1"
        )
    )
    if row.scalar() is None:
        await conn.execute(
            text(
                """
                CREATE TABLE login_audit (
                    id              SERIAL PRIMARY KEY,
                    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    login_method    VARCHAR(32) NOT NULL,
                    client_ip       VARCHAR(128) NULL,
                    user_agent      VARCHAR(512) NULL,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS login_audit_user_created_idx "
                "ON login_audit (user_id, created_at DESC)"
            )
        )
        logger.info("DB migration: created table login_audit.")


async def _ensure_chat_messages_elapsed_ms(conn) -> None:  # type: ignore[type-arg]
    col = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'chat_messages' "
            "AND column_name = 'elapsed_ms'"
        )
    )
    if col.scalar() is not None:
        return
    exists = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'chat_messages' LIMIT 1"
        )
    )
    if exists.scalar() is None:
        return
    await conn.execute(
        text("ALTER TABLE chat_messages ADD COLUMN elapsed_ms INTEGER NULL")
    )
    logger.info("DB migration: added chat_messages.elapsed_ms.")


async def _ensure_sql_skills_table(conn) -> None:  # type: ignore[type-arg]
    row = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'sql_skills' LIMIT 1"
        )
    )
    if row.scalar() is None:
        await conn.execute(
            text(
                """
                CREATE TABLE sql_skills (
                    id          SERIAL PRIMARY KEY,
                    name        VARCHAR(80) NOT NULL UNIQUE,
                    description VARCHAR(300) NOT NULL,
                    content     TEXT NOT NULL,
                    keywords    JSONB NOT NULL DEFAULT '[]'::jsonb,
                    sql_types   JSONB NOT NULL DEFAULT '[]'::jsonb,
                    priority    INTEGER NOT NULL DEFAULT 100,
                    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
                    updated_by  VARCHAR(100) NULL,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        logger.info("DB migration: created table sql_skills.")
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_sql_skills_enabled_priority "
            "ON sql_skills (enabled, priority, id)"
        )
    )


async def _seed_sql_skills(conn) -> None:  # type: ignore[type-arg]
    exists_row = await conn.execute(
        text("SELECT COUNT(*) FROM sql_skills")
    )
    count = int(exists_row.scalar() or 0)
    if count > 0:
        return
    for row in _SQL_SKILL_SEED:
        await conn.execute(
            text(
                """
                INSERT INTO sql_skills
                  (name, description, content, keywords, sql_types, priority, enabled, updated_by)
                VALUES
                  (:name, :description, :content, CAST(:keywords AS jsonb), CAST(:sql_types AS jsonb), :priority, TRUE, 'startup-migration')
                """
            ),
            {
                "name": row["name"],
                "description": row["description"],
                "content": row["content"],
                "keywords": json.dumps(row["keywords"], ensure_ascii=False),
                "sql_types": json.dumps(row["sql_types"], ensure_ascii=False),
                "priority": row["priority"],
            },
        )
    logger.info("DB migration: seeded default sql_skills.")


async def _ensure_chat_messages_decision_trace(conn) -> None:  # type: ignore[type-arg]
    col = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'chat_messages' "
            "AND column_name = 'decision_trace'"
        )
    )
    if col.scalar() is not None:
        return
    exists = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'chat_messages' LIMIT 1"
        )
    )
    if exists.scalar() is None:
        return
    await conn.execute(
        text("ALTER TABLE chat_messages ADD COLUMN decision_trace JSONB NULL")
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS chat_messages_decision_trace_gin "
            "ON chat_messages USING gin (decision_trace)"
        )
    )
    logger.info("DB migration: added chat_messages.decision_trace.")


async def _ensure_users_avatar_data(conn) -> None:  # type: ignore[type-arg]
    col = await conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'users' "
            "AND column_name = 'avatar_data'"
        )
    )
    if col.scalar() is not None:
        return
    await conn.execute(
        text("ALTER TABLE users ADD COLUMN avatar_data TEXT NULL")
    )
    logger.info("DB migration: added users.avatar_data.")

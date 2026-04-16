from app.models.metadata import TableMetadata
from app.services.rag import RAGEngine
from app.services.sql_skill_service import SQLSkill, choose_sql_skills


_SKILLS = [
    SQLSkill(
        id=1,
        name="province_filtering",
        description="省份过滤与同义词规范（禁止省份字段 LIKE）",
        content="## Skill: province_filtering",
        keywords=("省", "广西"),
        sql_types=(),
        priority=100,
        enabled=True,
    ),
    SQLSkill(
        id=2,
        name="scope_and_identity",
        description="按登录用户范围裁剪（人员/区域/省份）",
        content="## Skill: scope_and_identity",
        keywords=("我", "下级", "团队"),
        sql_types=(),
        priority=110,
        enabled=True,
    ),
]


def _meta(table_name: str, comment: str | None = None) -> TableMetadata:
    return TableMetadata(
        db_type="mysql",
        database_name="DWD",
        schema_name=None,
        table_name=table_name,
        table_comment=comment,
        columns=[{"name": "id", "type": "INT"}],
    )


def test_choose_sql_skills_hits_province_rule() -> None:
    tables = [_meta("DWD_SLS_PAYMENT_ACK_STAFF", "员工回款表")]
    skills = choose_sql_skills("统计广西省份的回款金额", "mysql", tables, _SKILLS, limit=2)
    names = [s.name for s in skills]
    assert "province_filtering" in names


def test_choose_sql_skills_hits_scope_rule() -> None:
    tables = [_meta("DWD_SLS_PAYMENT_ACK_STAFF", "员工回款表")]
    skills = choose_sql_skills("看下我和下级团队本月业绩", "mysql", tables, _SKILLS, limit=2)
    names = [s.name for s in skills]
    assert "scope_and_identity" in names


def test_rag_prompt_includes_loaded_skill_content() -> None:
    tables = [_meta("DWD_SLS_PAYMENT_ACK_STAFF", "员工回款表")]
    rag = RAGEngine(db=None, embedding_service=None)  # type: ignore[arg-type]
    messages = rag.build_prompt(
        "统计广西省份的回款金额",
        tables,
        "mysql",
        join_paths=[],
        current_user=None,
        selected_skills=[_SKILLS[0]],
        available_skills=_SKILLS,
    )
    system_prompt = messages[0]["content"]
    assert "可用技能（按需加载）" in system_prompt
    assert "Skill: province_filtering" in system_prompt

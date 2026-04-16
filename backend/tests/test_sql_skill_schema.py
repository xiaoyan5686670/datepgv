from app.models.schemas import QueryAuditItem, SQLSkillCreate


def test_sql_skill_create_normalizes_keywords() -> None:
    payload = SQLSkillCreate(
        name=" province_filtering ",
        description=" desc ",
        content=" content ",
        keywords=[" 省份 ", "省份", "", "广西"],
        sql_types=["mysql"],
        priority=100,
        enabled=True,
    )
    assert payload.name == "province_filtering"
    assert payload.keywords == ["省份", "广西"]


def test_query_audit_item_defaults_for_new_trace_fields() -> None:
    item = QueryAuditItem(
        session_id="s1",
        user_id=1,
        username="u1",
        full_name=None,
        user_message_at="2026-01-01T00:00:00+00:00",
        assistant_message_at="2026-01-01T00:00:01+00:00",
        user_query="q",
        generated_sql="select 1",
        sql_type="mysql",
        executed=True,
        elapsed_ms=10,
    )
    assert item.selected_skill_names == []
    assert item.scope_block_reason is None
    assert item.execution_error_category is None

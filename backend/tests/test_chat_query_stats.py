from __future__ import annotations

import pytest

from app.services.chat_query_stats import filters_from_query, normalize_question_text


def test_normalize_question_text_collapses_whitespace_and_case() -> None:
    assert normalize_question_text("  Hello   World  ") == "hello world"
    assert normalize_question_text("A\n\tB") == "a b"


def test_filters_from_query_rejects_inverted_range() -> None:
    with pytest.raises(ValueError, match="date_from"):
        filters_from_query(user_id=1, date_from="2025-12-31", date_to="2025-01-01")

from __future__ import annotations

import unittest

from app.api.chat import _build_personalized_waiting_tips
from app.services.scope_types import ResolvedScope


class ChatWaitingTipsTest(unittest.TestCase):
    def test_includes_scope_friendly_tip(self) -> None:
        tips = _build_personalized_waiting_tips(
            "查一下业绩",
            ResolvedScope(unrestricted=False, province_values={"广西"}),
            [],
        )
        self.assertTrue(any(t["id"] == "scope_hint" for t in tips))
        scope_tip = next(t for t in tips if t["id"] == "scope_hint")
        self.assertIn("广西", scope_tip["text"])
        self.assertIn("仅查询广西", scope_tip["rewrite_query"])

    def test_includes_history_based_tip(self) -> None:
        tips = _build_personalized_waiting_tips(
            "查本月回款",
            ResolvedScope(unrestricted=True),
            [{"role": "user", "content": "上个月广西回款趋势"}],
        )
        self.assertTrue(any(t["id"] == "history_followup" for t in tips))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest

from app.api.chat import _build_scope_block_message


class ChatScopeBlockMessageTest(unittest.TestCase):
    def test_block_message_includes_allowed_and_disallowed(self) -> None:
        message = _build_scope_block_message({"广西"}, ["河南"])
        self.assertIn("仅允许查询以下省份", message)
        self.assertIn("广西", message)
        self.assertIn("河南", message)
        self.assertIn("未授权省份", message)

    def test_block_message_without_allowed_scope(self) -> None:
        message = _build_scope_block_message(set(), ["河南"])
        self.assertIn("未授权省份", message)
        self.assertIn("无可用省份权限", message)
        self.assertIn("河南", message)


if __name__ == "__main__":
    unittest.main()

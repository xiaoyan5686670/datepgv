from __future__ import annotations

import unittest

from app.api.chat import (
    _build_employee_scope_block_message,
    _build_scope_block_message,
    _staff_scope_precheck,
)
from app.services.scope_types import ResolvedScope


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

    def test_employee_block_message(self) -> None:
        message = _build_employee_scope_block_message(["张三"])
        self.assertIn("未授权员工", message)
        self.assertIn("张三", message)
        self.assertIn("仅允许查询本人", message)


class ChatStaffScopePrecheckTest(unittest.TestCase):
    class _Role:
        def __init__(self, name: str) -> None:
            self.name = name

    class _User:
        def __init__(self) -> None:
            self.roles = [ChatStaffScopePrecheckTest._Role("staff")]
            self.employee_level = "staff"
            self.province = "广西"
            self.username = "XY001"
            self.full_name = "尹朋"

    def test_precheck_blocks_disallowed_province(self) -> None:
        scope = ResolvedScope(unrestricted=False, province_values={"广西"}, employee_values={"尹朋", "XY001"})
        u = self._User()
        dis_p, dis_e = _staff_scope_precheck("查询北京业绩", scope, u)  # type: ignore[arg-type]
        self.assertIn("北京", dis_p)
        self.assertEqual(dis_e, [])


if __name__ == "__main__":
    unittest.main()

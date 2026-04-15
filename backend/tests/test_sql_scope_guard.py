from __future__ import annotations

import unittest

from app.services.scope_types import ResolvedScope
from app.services.sql_scope_guard import rewrite_sql_with_scope


class SqlScopeGuardTest(unittest.TestCase):
    def test_rewrite_disallowed_province_literal(self) -> None:
        scope = ResolvedScope(unrestricted=False, province_values={"广西"})
        sql = (
            "SELECT SUM(renlingjine) AS total_sales_amount "
            "FROM ODS.ODS_CRM_renkuanmingx1 "
            "WHERE renkuan = '河南省'"
        )
        result = rewrite_sql_with_scope(sql, "mysql", scope)
        self.assertTrue(result.scope_applied)
        self.assertIn("广西", result.sql)
        self.assertIn("河南", " ".join(result.mentioned_disallowed_provinces))
        self.assertTrue(result.should_block)
        self.assertIsNotNone(result.block_reason)

    def test_rewrite_preserves_valid_filter_and_adds_scope(self) -> None:
        scope = ResolvedScope(unrestricted=False, province_values={"广西"})
        sql = (
            "SELECT * FROM sales_fact "
            "WHERE renkuan = '广西壮族自治区' AND dt = CURDATE()"
        )
        result = rewrite_sql_with_scope(sql, "mysql", scope)
        self.assertTrue(result.scope_applied)
        self.assertIn("dt", result.sql)
        self.assertEqual(result.mentioned_disallowed_provinces, [])
        self.assertFalse(result.should_block)

    def test_unrestricted_scope_no_rewrite(self) -> None:
        scope = ResolvedScope(unrestricted=True)
        sql = "SELECT * FROM sales_fact WHERE renkuan = '河南省'"
        result = rewrite_sql_with_scope(sql, "mysql", scope)
        self.assertFalse(result.scope_applied)
        self.assertEqual(result.sql, sql)
        self.assertFalse(result.should_block)

    def test_rewrite_province_like_always_to_in_for_performance(self) -> None:
        scope = ResolvedScope(unrestricted=False, province_values={"广西", "广东"})
        sql = "SELECT * FROM t WHERE PROV_NAME LIKE '%广西%'"
        result = rewrite_sql_with_scope(sql, "mysql", scope)
        self.assertTrue(result.scope_applied)
        self.assertIn("PROV_NAME IN", result.sql)
        self.assertNotIn("LIKE", result.sql.upper())

    def test_rewrite_includes_province_alias_literals(self) -> None:
        scope = ResolvedScope(unrestricted=False, province_values={"广西"})
        sql = "SELECT * FROM t WHERE PROV_NAME LIKE '%广西%'"
        result = rewrite_sql_with_scope(sql, "mysql", scope)
        self.assertTrue(result.scope_applied)
        self.assertIn("广西", result.sql)
        self.assertIn("广西壮族自治区", result.sql)

    def test_inner_mongolia_alias_supported(self) -> None:
        scope = ResolvedScope(unrestricted=False, province_values={"内蒙古"})
        sql = "SELECT * FROM t WHERE PROV_NAME LIKE '%内蒙%'"
        result = rewrite_sql_with_scope(sql, "mysql", scope)
        self.assertTrue(result.scope_applied)
        self.assertIn("内蒙古", result.sql)
        self.assertIn("内蒙古自治区", result.sql)

    def test_rewrite_prov_name_like_disallowed_for_staff_home_province(self) -> None:
        class _Viewer:
            employee_level = "staff"
            province = "广西"

        scope = ResolvedScope(
            unrestricted=False, province_values=set(), employee_values={"尹朋"}
        )
        sql = (
            "SELECT `PROV_NAME`, `MGR_NAME`, SUM(`CLAIMED_AMOUNT`) AS x "
            "FROM `DWD`.`DWD_SLS_PAYMENT_ACK_STAFF` "
            "WHERE `PROV_NAME` LIKE '%河南%' AND `MGR_NAME` = '尹朋' "
            "GROUP BY `PROV_NAME`, `MGR_NAME`"
        )
        result = rewrite_sql_with_scope(sql, "mysql", scope, _Viewer())
        self.assertTrue(result.scope_applied)
        self.assertNotIn("%河南%", result.sql)
        self.assertIn("河南", " ".join(result.mentioned_disallowed_provinces))
        self.assertIsNotNone(result.rewrite_note)
        assert result.rewrite_note is not None
        self.assertIn("自己的数据", result.rewrite_note)

    def test_rewrite_staff_no_profile_province_blocks_any_province_literal(self) -> None:
        class _Viewer:
            employee_level = "staff"
            province = None

        scope = ResolvedScope(unrestricted=False, province_values=set(), employee_values={"u"})
        sql = "SELECT * FROM t WHERE PROV_NAME LIKE '%河南%'"
        result = rewrite_sql_with_scope(sql, "mysql", scope, _Viewer())
        self.assertTrue(result.scope_applied)
        self.assertTrue(result.should_block)
        self.assertIn("河南", " ".join(result.mentioned_disallowed_provinces))


class SqlScopeGuardFriendlyNoteTest(unittest.TestCase):
    def test_rewrite_note_uses_jurisdiction_hint_for_region_executive(self) -> None:
        class _Viewer:
            employee_level = "region_executive"
            province = None

        scope = ResolvedScope(unrestricted=False, province_values={"广东", "广西"})
        sql = "SELECT * FROM t WHERE renkuan = '河南省'"
        result = rewrite_sql_with_scope(sql, "mysql", scope, _Viewer())
        self.assertTrue(result.scope_applied)
        self.assertIsNotNone(result.rewrite_note)
        assert result.rewrite_note is not None
        self.assertIn("辖区", result.rewrite_note)


if __name__ == "__main__":
    unittest.main()

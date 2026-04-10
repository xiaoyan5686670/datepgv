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

    def test_unrestricted_scope_no_rewrite(self) -> None:
        scope = ResolvedScope(unrestricted=True)
        sql = "SELECT * FROM sales_fact WHERE renkuan = '河南省'"
        result = rewrite_sql_with_scope(sql, "mysql", scope)
        self.assertFalse(result.scope_applied)
        self.assertEqual(result.sql, sql)


if __name__ == "__main__":
    unittest.main()

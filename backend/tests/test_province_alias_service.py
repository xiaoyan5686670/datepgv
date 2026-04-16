from __future__ import annotations

import unittest

from app.models.schemas import ProvinceAliasCreate
from app.services.province_alias_service import (
    canonical_province_name,
    is_known_province_literal,
    province_alias_literals_for_canonicals,
    province_canonicals_mentioned_in_text,
)


class ProvinceAliasServiceTest(unittest.TestCase):
    def test_schema_trim(self) -> None:
        row = ProvinceAliasCreate(canonical_name=" 广西 ", alias=" 广西壮族自治区 ")
        self.assertEqual(row.canonical_name, "广西")
        self.assertEqual(row.alias, "广西壮族自治区")

    def test_canonicalize_alias(self) -> None:
        self.assertEqual(canonical_province_name("广西壮族自治区"), "广西")
        self.assertEqual(canonical_province_name("内蒙"), "内蒙古")

    def test_known_literal(self) -> None:
        self.assertTrue(is_known_province_literal("广西"))
        self.assertTrue(is_known_province_literal("内蒙古自治区"))

    def test_detect_in_text(self) -> None:
        out = province_canonicals_mentioned_in_text("PROV_NAME like '%内蒙古自治区%'")
        self.assertEqual(out, {"内蒙古"})

    def test_expand_alias_literals(self) -> None:
        lits = province_alias_literals_for_canonicals({"广西", "内蒙古"})
        self.assertIn("广西", lits)
        self.assertIn("广西壮族自治区", lits)
        self.assertIn("内蒙", lits)
        self.assertIn("内蒙古自治区", lits)


if __name__ == "__main__":
    unittest.main()

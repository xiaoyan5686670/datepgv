from __future__ import annotations

import unittest
from dataclasses import dataclass

from app.models.data_scope_policy import DataScopePolicy
from app.services.query_executor import _build_scoped_wrapped_sql
from app.services.scope_policy_service import resolve_user_scope
from app.services.scope_types import ResolvedScope


@dataclass
class _FakeRole:
    name: str


@dataclass
class _FakeUser:
    id: int
    username: str
    employee_level: str
    province: str | None = None
    org_region: str | None = None
    district: str | None = None
    roles: list[_FakeRole] | None = None


class _FakeScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _FakeExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalarResult(self._rows)


class _FakeSession:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        return _FakeExecuteResult(self._rows)


class ScopePolicyResolutionTest(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_scope_supports_all_dimensions(self) -> None:
        user = _FakeUser(
            id=7,
            username="u007",
            employee_level="province_manager",
            roles=[_FakeRole(name="user")],
        )
        policies = [
            DataScopePolicy(
                id=1,
                subject_type="user_id",
                subject_key="7",
                dimension="province",
                allowed_values=["广西壮族自治区"],
                deny_values=[],
                merge_mode="replace",
                priority=100,
                enabled=True,
            ),
            DataScopePolicy(
                id=2,
                subject_type="user_id",
                subject_key="7",
                dimension="employee",
                allowed_values=["u007", "张三"],
                deny_values=["张三"],
                merge_mode="replace",
                priority=100,
                enabled=True,
            ),
            DataScopePolicy(
                id=3,
                subject_type="user_id",
                subject_key="7",
                dimension="region",
                allowed_values=["华南"],
                deny_values=[],
                merge_mode="replace",
                priority=100,
                enabled=True,
            ),
            DataScopePolicy(
                id=4,
                subject_type="user_id",
                subject_key="7",
                dimension="district",
                allowed_values=["南宁"],
                deny_values=[],
                merge_mode="replace",
                priority=100,
                enabled=True,
            ),
        ]

        scope = await resolve_user_scope(user, _FakeSession(policies))
        self.assertFalse(scope.unrestricted)
        self.assertEqual(scope.province_values, {"广西"})
        self.assertEqual(scope.employee_values, {"u007"})
        self.assertEqual(scope.region_values, {"华南"})
        self.assertEqual(scope.district_values, {"南宁"})
        self.assertEqual(scope.policy_ids, [1, 2, 3, 4])

    async def test_resolve_scope_empty_when_no_policy(self) -> None:
        user = _FakeUser(
            id=8,
            username="u008",
            employee_level="staff",
            roles=[_FakeRole(name="user")],
        )
        scope = await resolve_user_scope(user, _FakeSession([]))
        self.assertFalse(scope.unrestricted)
        self.assertEqual(scope.source, "policy_empty")
        self.assertFalse(scope.has_any_constraint)


class ScopedSqlWrapperTest(unittest.TestCase):
    def test_build_scoped_sql_separates_dimension_predicates(self) -> None:
        scope = ResolvedScope(
            unrestricted=False,
            province_values={"广西"},
            employee_values={"u001"},
            region_values={"华南"},
            district_values={"南宁"},
        )
        sql = _build_scoped_wrapped_sql(
            "postgresql",
            "SELECT * FROM sales",
            ["province", "username", "org_region", "district"],
            scope,
        )
        self.assertIn('CAST("province" AS TEXT) IN (\'广西\')', sql)
        self.assertIn('CAST("username" AS TEXT) IN (\'u001\')', sql)
        self.assertIn('CAST("org_region" AS TEXT) IN (\'华南\')', sql)
        self.assertIn('CAST("district" AS TEXT) IN (\'南宁\')', sql)


if __name__ == "__main__":
    unittest.main()

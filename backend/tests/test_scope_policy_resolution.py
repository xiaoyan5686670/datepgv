from __future__ import annotations

import unittest
from dataclasses import dataclass
from unittest.mock import patch

from app.core.config import settings
from app.models.data_scope_policy import DataScopePolicy
from app.models.schemas import DataScopePolicyCreate
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


class DataScopePolicySchemaTest(unittest.TestCase):
    def test_user_id_subject_key_accepts_business_login_code(self) -> None:
        p = DataScopePolicyCreate(
            subject_type="user_id",
            subject_key="XY001475",
            dimension="province",
            allowed_values=["广东"],
        )
        self.assertEqual(p.subject_key, "XY001475")


class ScopePolicyResolutionTest(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_scope_user_id_policy_matches_username_not_only_db_id(
        self,
    ) -> None:
        user = _FakeUser(
            id=99,
            username="XY001475",
            employee_level="province_manager",
            roles=[_FakeRole(name="user")],
        )
        policies = [
            DataScopePolicy(
                id=30,
                subject_type="user_id",
                subject_key="XY001475",
                dimension="province",
                allowed_values=["广东"],
                deny_values=[],
                merge_mode="replace",
                priority=100,
                enabled=True,
            ),
        ]
        scope = await resolve_user_scope(user, _FakeSession(policies))
        self.assertFalse(scope.unrestricted)
        self.assertEqual(scope.province_values, {"广东"})
        self.assertIn(30, scope.policy_ids)

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

    async def test_resolve_scope_staff_strips_geo_uses_own_codes(self) -> None:
        user = _FakeUser(
            id=9,
            username="XY009",
            employee_level="staff",
            province="广东",
            org_region="华南",
            district="深圳",
            roles=[_FakeRole(name="user")],
        )
        policies = [
            DataScopePolicy(
                id=10,
                subject_type="user_id",
                subject_key="9",
                dimension="province",
                allowed_values=["广东"],
                deny_values=[],
                merge_mode="replace",
                priority=100,
                enabled=True,
            ),
            DataScopePolicy(
                id=11,
                subject_type="user_id",
                subject_key="9",
                dimension="region",
                allowed_values=["华南"],
                deny_values=[],
                merge_mode="replace",
                priority=110,
                enabled=True,
            ),
        ]
        with patch(
            "app.services.scope_policy_service.get_user_scope_codes",
            return_value={"XY009", "小张"},
        ):
            scope = await resolve_user_scope(user, _FakeSession(policies))
        self.assertFalse(scope.unrestricted)
        self.assertEqual(scope.province_values, set())
        self.assertEqual(scope.region_values, set())
        self.assertEqual(scope.district_values, set())
        self.assertEqual(scope.employee_values, {"XY009", "小张"})

    async def test_resolve_scope_staff_employee_policy_intersects_own(self) -> None:
        user = _FakeUser(
            id=10,
            username="XY010",
            employee_level="staff",
            roles=[_FakeRole(name="user")],
        )
        policies = [
            DataScopePolicy(
                id=20,
                subject_type="user_id",
                subject_key="10",
                dimension="employee",
                allowed_values=["XY010", "intruder"],
                deny_values=[],
                merge_mode="replace",
                priority=50,
                enabled=True,
            ),
        ]
        with patch(
            "app.services.scope_policy_service.get_user_scope_codes",
            return_value={"XY010"},
        ):
            scope = await resolve_user_scope(user, _FakeSession(policies))
        self.assertEqual(scope.employee_values, {"XY010"})

    async def test_resolve_scope_staff_employee_policy_disjoint_yields_empty(self) -> None:
        user = _FakeUser(
            id=11,
            username="XY011",
            employee_level="staff",
            roles=[_FakeRole(name="user")],
        )
        policies = [
            DataScopePolicy(
                id=21,
                subject_type="user_id",
                subject_key="11",
                dimension="employee",
                allowed_values=["someone_else"],
                deny_values=[],
                merge_mode="replace",
                priority=50,
                enabled=True,
            ),
        ]
        with patch(
            "app.services.scope_policy_service.get_user_scope_codes",
            return_value={"XY011"},
        ):
            scope = await resolve_user_scope(user, _FakeSession(policies))
        self.assertEqual(scope.employee_values, set())
        self.assertFalse(scope.has_any_constraint)

    async def test_csv_fallback_staff_clears_geo(self) -> None:
        user = _FakeUser(
            id=12,
            username="XY012",
            employee_level="staff",
            province="广东",
            org_region="华南",
            district="深圳",
            roles=[_FakeRole(name="user")],
        )
        with patch.object(settings, "SCOPE_POLICY_CSV_FALLBACK_ENABLED", True), patch(
            "app.services.scope_policy_service.get_user_scope_codes",
            return_value={"XY012"},
        ):
            scope = await resolve_user_scope(user, _FakeSession([]))
        self.assertEqual(scope.source, "csv_fallback")
        self.assertEqual(scope.employee_values, {"XY012"})
        self.assertEqual(scope.province_values, set())
        self.assertEqual(scope.region_values, set())
        self.assertEqual(scope.district_values, set())


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

"""Unit tests: staff may only match themselves in user visibility helpers."""
from __future__ import annotations

import unittest

from app.api.users import _user_matches_scope
from app.services.scope_types import ResolvedScope


def _u(
    *,
    uid: int,
    level: str = "staff",
    username: str = "u1",
    full_name: str | None = None,
    province: str | None = None,
    org_region: str | None = None,
    district: str | None = None,
) -> object:
    return type(
        "MiniUser",
        (),
        {
            "id": uid,
            "employee_level": level,
            "username": username,
            "full_name": full_name,
            "province": province,
            "org_region": org_region,
            "district": district,
        },
    )()


class UserStaffScopeTest(unittest.TestCase):
    def test_staff_only_self_even_if_scope_has_province(self) -> None:
        viewer = _u(uid=1, level="staff", username="XY001", province="广东")
        peer = _u(uid=2, level="staff", username="XY002", province="广东")
        scope = ResolvedScope(
            unrestricted=False,
            province_values={"广东"},
            employee_values={"XY001"},
        )
        self.assertTrue(_user_matches_scope(viewer, viewer, scope))
        self.assertFalse(_user_matches_scope(viewer, peer, scope))

    def test_non_staff_still_uses_province_in_scope(self) -> None:
        viewer = _u(uid=1, level="province_manager", province="广东")
        peer = _u(uid=99, province="广东")
        scope = ResolvedScope(unrestricted=False, province_values={"广东"})
        self.assertTrue(_user_matches_scope(viewer, peer, scope))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ResolvedScope:
    unrestricted: bool = False
    province_values: set[str] = field(default_factory=set)
    employee_values: set[str] = field(default_factory=set)
    region_values: set[str] = field(default_factory=set)
    district_values: set[str] = field(default_factory=set)
    policy_ids: list[int] = field(default_factory=list)
    source: str = "policy"

    @property
    def has_any_constraint(self) -> bool:
        return any(
            (
                self.province_values,
                self.employee_values,
                self.region_values,
                self.district_values,
            )
        )

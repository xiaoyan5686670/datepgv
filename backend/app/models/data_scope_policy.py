from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DataScopePolicy(Base):
    __tablename__ = "data_scope_policies"
    __table_args__ = (
        UniqueConstraint(
            "subject_type",
            "subject_key",
            "dimension",
            name="uq_data_scope_policy_subject_dimension",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    subject_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    dimension: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    allowed_values: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    deny_values: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    merge_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="union")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    note: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AnalyticsDbConnection(Base):
    """Stored execute targets for NL→SQL (MySQL / PostgreSQL)."""

    __tablename__ = "analytics_db_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    engine: Mapped[str] = mapped_column(String(20), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "engine IN ('postgresql', 'mysql')",
            name="analytics_db_connections_engine_check",
        ),
    )

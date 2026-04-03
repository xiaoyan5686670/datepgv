from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AnalyticsDbSettings(Base):
    __tablename__ = "analytics_db_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    postgres_url: Mapped[str | None] = mapped_column(Text)
    mysql_url: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

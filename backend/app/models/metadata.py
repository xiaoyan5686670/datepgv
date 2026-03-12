from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    JSON,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.embedding_dim import get_embedding_dim


class TableMetadata(Base):
    __tablename__ = "table_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    db_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="hive or postgresql",
    )
    database_name: Mapped[str | None] = mapped_column(String(200))
    schema_name: Mapped[str | None] = mapped_column(String(200))
    table_name: Mapped[str] = mapped_column(String(200), nullable=False)
    table_comment: Mapped[str | None] = mapped_column(Text)
    columns: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    sample_data: Mapped[list[Any] | None] = mapped_column(JSON)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(get_embedding_dim())
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint("db_type IN ('hive', 'postgresql')", name="db_type_check"),
        Index("table_metadata_name_idx", "db_type", "database_name", "table_name"),
    )

from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TableMetadata(Base):
    __tablename__ = "table_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    db_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="hive, postgresql, oracle, or mysql",
    )
    database_name: Mapped[str | None] = mapped_column(String(200))
    schema_name: Mapped[str | None] = mapped_column(String(200))
    table_name: Mapped[str] = mapped_column(String(200), nullable=False)
    table_comment: Mapped[str | None] = mapped_column(Text)
    columns: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    sample_data: Mapped[list[Any] | None] = mapped_column(JSON)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    # Let PostgreSQL/pgvector enforce the actual embedding dimension based on
    # the column definition (e.g. vector(1536) / vector(3072) / vector(768)),
    # instead of hard‑coding it in SQLAlchemy.
    embedding: Mapped[list[float] | None] = mapped_column(Vector())
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    edges_from: Mapped[list["TableMetadataEdge"]] = relationship(
        "TableMetadataEdge",
        foreign_keys="TableMetadataEdge.from_metadata_id",
        back_populates="from_table",
        passive_deletes=True,
    )
    edges_to: Mapped[list["TableMetadataEdge"]] = relationship(
        "TableMetadataEdge",
        foreign_keys="TableMetadataEdge.to_metadata_id",
        back_populates="to_table",
        passive_deletes=True,
    )

    __table_args__ = (
        CheckConstraint(
            "db_type IN ('hive', 'postgresql', 'oracle', 'mysql')", name="db_type_check"
        ),
        Index("table_metadata_name_idx", "db_type", "database_name", "table_name"),
    )


class TableMetadataEdge(Base):
    """
    Directed edge between two catalog rows (TableMetadata).

    relation_type:
      - foreign_key: physical or declared FK-style link (optional from_column / to_column).
      - logical: same subject area, naming convention, or inferred join path.
      - coquery: curated "often queried together" hint.

    Retrieval treats edges as undirected: expansion walks neighbors on either side.
    """

    __tablename__ = "table_metadata_edges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_metadata_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("table_metadata.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    to_metadata_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("table_metadata.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    relation_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="foreign_key | logical | coquery",
    )
    from_column: Mapped[str | None] = mapped_column(String(200))
    to_column: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    from_table: Mapped["TableMetadata"] = relationship(
        "TableMetadata",
        foreign_keys=[from_metadata_id],
        back_populates="edges_from",
    )
    to_table: Mapped["TableMetadata"] = relationship(
        "TableMetadata",
        foreign_keys=[to_metadata_id],
        back_populates="edges_to",
    )

    __table_args__ = (
        CheckConstraint(
            "relation_type IN ('foreign_key', 'logical', 'coquery')",
            name="table_metadata_edges_type_check",
        ),
        CheckConstraint(
            "from_metadata_id <> to_metadata_id",
            name="table_metadata_edges_no_self_loop",
        ),
        UniqueConstraint(
            "from_metadata_id",
            "to_metadata_id",
            "relation_type",
            name="table_metadata_edges_unique_triple",
        ),
        Index(
            "table_metadata_edges_endpoints_idx",
            "from_metadata_id",
            "to_metadata_id",
        ),
    )

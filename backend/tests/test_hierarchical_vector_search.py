from __future__ import annotations

import unittest

from app.core.config import settings
from app.services.hierarchical_vector_search import _audit_sql_for_execution


class HierarchicalVectorSearchAuditTest(unittest.TestCase):
    def test_audit_accepts_parameterized_select(self) -> None:
        dim = settings.EMBEDDING_DIM
        sql = (
            "SELECT id, content, metadata, "
            f"(embedding <=> CAST(:qv AS vector({dim})))::double precision AS distance "
            "FROM rag_chunks WHERE embedding IS NOT NULL AND hierarchy_path @> CAST(:p0 AS jsonb) "
            f"ORDER BY embedding <=> CAST(:qv AS vector({dim})) ASC LIMIT :k"
        )
        params = {"qv": "[0.0,0.0]", "p0": "[]", "k": 3}
        _audit_sql_for_execution(sql, params)

    def test_audit_accepts_unrestricted_shape(self) -> None:
        dim = settings.EMBEDDING_DIM
        sql = (
            "SELECT id, content, metadata, "
            f"(embedding <=> CAST(:qv AS vector({dim})))::double precision AS distance "
            "FROM rag_chunks WHERE embedding IS NOT NULL "
            f"ORDER BY embedding <=> CAST(:qv AS vector({dim})) ASC LIMIT :k"
        )
        _audit_sql_for_execution(sql, {"qv": "[0.0]", "k": 5})


if __name__ == "__main__":
    unittest.main()

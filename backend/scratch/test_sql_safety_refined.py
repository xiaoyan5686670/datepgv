
import re
import sys
from typing import Any

# Mock QueryExecutorError
class QueryExecutorError(Exception):
    pass

# Mock forbidden pattern
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|"
    r"REPLACE|MERGE|CALL|EXEC|EXECUTE|COPY|VACUUM)\b",
    re.IGNORECASE | re.DOTALL,
)

# The function to test
def assert_single_read_statement(sql: str) -> str:
    s = sql.strip()
    if not s:
        raise QueryExecutorError("SQL 为空，无法执行")

    no_comments = re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)
    lines = []
    for line in no_comments.splitlines():
        idx = line.find("--")
        if idx != -1:
            lines.append(line[:idx])
        else:
            lines.append(line)
    core = "\n".join(lines).strip()

    core = re.sub(r"'(?:''|[^'])*'", "''", core)
    core = re.sub(r'"(?:""|[^"])*"', '""', core)

    core_stripped = core.rstrip().rstrip(";")
    if ";" in core_stripped:
        raise QueryExecutorError("不允许一次执行多条 SQL (检测到分隔符「;」)")

    if _FORBIDDEN.search(core):
        raise QueryExecutorError("仅允许只读查询（SELECT / WITH 等）")

    if not core_stripped.strip():
        raise QueryExecutorError("SQL 无有效语句")

    return s

def test():
    cases = [
        ("SELECT 1", True),
        ("SELECT 1;", True),
        ("SELECT 1; -- comment", True),
        ("SELECT 1; /* block */", True),
        ("SELECT ';' from dual", True),
        ("SELECT 1; SELECT 2", False),
        ("SELECT 1; DROP TABLE users", False),
        ("SELECT * FROM table -- comment with ; semicolon", True),
        ("/* comment ; */ SELECT 1", True),
    ]

    for sql, expected in cases:
        try:
            assert_single_read_statement(sql)
            result = True
        except QueryExecutorError:
            result = False
        
        status = "PASSED" if result == expected else "FAILED"
        print(f"[{status}] Expected {expected}, got {result} for: {sql!r}")
        if status == "FAILED":
            sys.exit(1)

if __name__ == "__main__":
    test()

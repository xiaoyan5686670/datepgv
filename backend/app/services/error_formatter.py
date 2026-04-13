import logging
from typing import Tuple
from app.services.query_executor import (
    friendly_mysql_access_error, 
    mysql_err_code_from_exception, 
    QueryExecutorError
)

logger = logging.getLogger(__name__)

# Constants for common "plain language" (白话文) messages
MSG_NETWORK_ERROR = "网络开了个小差，请稍后再试"
MSG_QUERY_NOT_FOUND = "我还找不到关于这部分的数据指标，您可以尝试换个说法描述您的需求"
MSG_SYSTEM_ERROR = "抱歉，由于系统忙，目前无法完成您的请求。请稍后再试。"

def format_execution_error(exc: Exception, is_admin: bool) -> Tuple[str, str]:
    """
    Format a technical exception into a user-friendly message and a technical hint.
    
    Returns:
        (answer_message, technical_exec_error)
        - answer_message: The natural language content (Markdown) for the chat bubble.
        - technical_exec_error: The string for the "Execution Failed" field (may be masked).
    """
    original_msg = str(exc)
    
    # Identify error type
    mysql_hint = friendly_mysql_access_error(exc)
    mysql_code = mysql_err_code_from_exception(exc)
    
    # Postgres specific checks (common asyncpg/sqlalchemy patterns)
    msg_lower = original_msg.lower()
    is_not_found = any(s in msg_lower for s in [
        "relation", "does not exist", "column", "table", 
        "undefined_table", "undefined_column", "unknown_column"
    ]) or mysql_code in (1146, 1054)
    
    is_connection_error = any(s in msg_lower for s in [
        "connection", "timeout", "network", "lost", "refused"
    ]) or mysql_code in (2006, 2013, 2003)

    # 1. Determine the "Plain Language" (白话文) answer
    if is_connection_error:
        friendly_answer = MSG_NETWORK_ERROR
    elif is_not_found:
        friendly_answer = MSG_QUERY_NOT_FOUND
    elif isinstance(exc, QueryExecutorError):
        # QueryExecutorError messages are generally "safe" validation messages
        # (e.g. "SQL 为空", "仅允许只读查询")
        friendly_answer = f"请求未能执行：{original_msg}"
    else:
        friendly_answer = MSG_SYSTEM_ERROR

    # 2. Determine the technical detail
    # If the service already provided a "friendly technical hint" (like friendly_mysql_access_error), use it for detail.
    detail = mysql_hint or original_msg

    # 3. Final role-based output
    if is_admin:
        # Admins see a more informative answer and the full technical detail
        admin_answer = f"⚠️ **查询执行出错**\n\n{friendly_answer}\n\n> **管理员提示**：{detail}"
        return admin_answer, detail
    else:
        # Regular users see only the gentle prompt (or safe validation message)
        return friendly_answer, friendly_answer

"""Validator agent -- checks SQL for safety before execution."""

import re

from agents.trace import AgentTrace

FORBIDDEN_SQL_KEYWORDS = re.compile(
    r"\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE|CREATE|GRANT|REVOKE|MERGE)\b",
    re.IGNORECASE,
)

# Matches SQL single-line comments (-- ...) and block comments (/* ... */)
SQL_COMMENT = re.compile(r"--[^\n]*|/\*.*?\*/", re.DOTALL)


def _strip_comments(sql: str) -> str:
    """Remove SQL comments so they don't trigger false positives."""
    return SQL_COMMENT.sub("", sql)


def agent_validator(sql: str, trace: AgentTrace) -> str | None:
    """Returns an error message if SQL is unsafe, None if approved."""
    trace.log("Validator", "Checking SQL for safety...")

    # Check if the LLM returned a comment instead of a real query
    stripped = _strip_comments(sql).strip().rstrip(";").strip()
    if not stripped:
        trace.log("Validator", "No executable SQL found (only comments).")
        return "NO_SQL"

    # Check forbidden keywords only in actual SQL (not comments)
    match = FORBIDDEN_SQL_KEYWORDS.search(stripped)
    if match:
        trace.log("Validator", f"BLOCKED: Forbidden SQL keyword: {match.group()}")
        return f"Forbidden SQL keyword: {match.group()}"

    if not stripped.upper().startswith("SELECT"):
        trace.log("Validator", "BLOCKED: Query is not a SELECT statement.")
        return "Only SELECT queries are allowed."

    trace.log("Validator", "SQL is safe. Approved for execution.")
    return None

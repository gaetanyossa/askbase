"""Executor agent -- runs SQL against the database."""

from sqlalchemy import text

from agents.trace import AgentTrace


def agent_executor(engine, sql: str, max_rows: int, trace: AgentTrace) -> tuple[list[str], list[list]]:
    trace.log("Executor", "Running query against database...")

    with engine.connect() as conn:
        result = conn.execute(text(sql))
        columns = list(result.keys())
        rows = [list(r) for r in result.fetchmany(max_rows)]

    trace.log("Executor", f"Query returned {len(rows)} row(s), {len(columns)} column(s).")
    return columns, rows

"""Formatter agent -- formats raw results into a human-readable answer."""

from openai import OpenAI

from agents.llm import call_llm
from agents.trace import AgentTrace
from prompts import FORMATTER_SYSTEM, FORMATTER_USER


def agent_formatter(
    client: OpenAI,
    model: str,
    question: str,
    sql: str,
    columns: list,
    rows: list,
    trace: AgentTrace,
) -> str:
    trace.log("Formatter", f"Formatting {len(rows)} rows into a readable answer...")

    result_text = " | ".join(columns) + "\n"
    for row in rows[:50]:
        result_text += " | ".join(str(v) for v in row) + "\n"

    user_msg = FORMATTER_USER.format(
        question=question,
        sql=sql,
        row_count=len(rows),
        result_text=result_text,
    )

    answer = call_llm(client, model, [
        {"role": "system", "content": FORMATTER_SYSTEM},
        {"role": "user", "content": user_msg},
    ], max_tokens=2000)

    trace.log("Formatter", "Answer ready.")
    return answer

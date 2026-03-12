"""Schema Analyzer agent -- deeply analyzes the schema to find relevant columns for the query."""

from openai import OpenAI

from agents.llm import call_llm
from agents.trace import AgentTrace
from prompts import ANALYZER_SYSTEM


def agent_analyzer(
    client: OpenAI,
    model: str,
    question: str,
    plan: dict,
    schema_block: str,
    db_type: str,
    trace: AgentTrace,
) -> str:
    """Analyzes schema columns and returns detailed instructions for the SQL Writer."""
    trace.log("Analyzer", "Analyzing schema to find relevant columns...")

    system = ANALYZER_SYSTEM.format(
        db_type=db_type,
        schema_block=schema_block,
        intent=plan.get("intent", ""),
        tables=", ".join(plan.get("tables", [])),
        notes=plan.get("notes", "none"),
    )

    analysis = call_llm(client, model, [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ], max_tokens=800)

    trace.log("Analyzer", f"Analysis:\n{analysis}")
    return analysis

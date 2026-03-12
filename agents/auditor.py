"""Database Auditor agent -- analyzes schema + sample data to produce an intelligent overview."""

from openai import OpenAI

from agents.llm import call_llm, reset_token_usage, get_token_usage
from agents.trace import AgentTrace
from prompts import AUDITOR_SYSTEM


def agent_auditor(
    client: OpenAI,
    model: str,
    schema_info: dict,
    db_type: str,
    trace: AgentTrace,
    language: str = "en",
) -> dict:
    """Analyze the database and return a structured audit.

    Args:
        schema_info: {table_name: {columns: [...], row_count, samples: [...]}}
        language: Language hint for the response (e.g. "fr", "en")

    Returns:
        {"audit": str, "usage": dict}
    """
    reset_token_usage()
    trace.log("Auditor", "Analyzing database structure and sample data...")

    # Build a readable schema description for the LLM
    schema_text = _format_schema_for_audit(schema_info)
    trace.log("Auditor", f"Found {len(schema_info)} tables to analyze")

    system = AUDITOR_SYSTEM.format(db_type=db_type)

    lang_hint = {
        "fr": "Réponds en français.",
        "en": "Reply in English.",
        "es": "Responde en español.",
        "de": "Antworte auf Deutsch.",
    }.get(language, f"Reply in {language}.")

    user_msg = f"""{lang_hint}

Here is the database schema with sample data:

{schema_text}

Produce the full database audit."""

    trace.log("Auditor", "Generating audit report...")

    audit = call_llm(client, model, [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ], max_tokens=2000)

    trace.log("Auditor", "Audit complete")

    usage = get_token_usage()
    trace.log("Auditor", f"Tokens: {usage['prompt_tokens']} in + {usage['completion_tokens']} out = {usage['total_tokens']} total")

    return {"audit": audit, "usage": usage}


def _format_schema_for_audit(schema_info: dict) -> str:
    """Convert schema_info dict into a readable text block for the LLM."""
    parts = []
    for table_name, info in schema_info.items():
        cols = info.get("columns", [])
        row_count = info.get("row_count", "?")
        samples = info.get("samples", [])

        col_names = [f"{c['name']} ({c['type']})" for c in cols]
        header = f"TABLE: {table_name} ({row_count} rows)"
        col_line = f"  Columns: {', '.join(col_names)}"

        lines = [header, col_line]
        if samples:
            lines.append("  Sample rows:")
            col_header = [c["name"] for c in cols]
            lines.append(f"    | {' | '.join(col_header)} |")
            for row in samples:
                vals = [str(v)[:40] for v in row]
                lines.append(f"    | {' | '.join(vals)} |")

        parts.append("\n".join(lines))

    return "\n\n".join(parts)

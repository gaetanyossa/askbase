"""SQL Writer agent -- generates SQL based on the analyzer's recommendations."""

from openai import OpenAI

from agents.llm import call_llm, clean_sql
from agents.trace import AgentTrace
from prompts import SQL_WRITER_SYSTEM, SQL_RETRY_SYSTEM


def agent_sql_writer(
    client: OpenAI,
    model: str,
    question: str,
    analysis: str,
    schema_block: str,
    db_type: str,
    qualifier_rule: str,
    max_rows: int,
    trace: AgentTrace,
) -> str:
    trace.log("SQL Writer", "Generating SQL query...")

    system = SQL_WRITER_SYSTEM.format(
        db_type=db_type,
        qualifier_rule=qualifier_rule,
        max_rows=max_rows,
        schema_block=schema_block,
        analysis=analysis,
    )

    sql = call_llm(client, model, [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ], max_tokens=1000)

    sql = clean_sql(sql)
    trace.log("SQL Writer", f"Generated SQL:\n{sql}")
    return sql


def agent_sql_retry(
    client: OpenAI,
    model: str,
    question: str,
    original_sql: str,
    error: str,
    schema_block: str,
    trace: AgentTrace,
) -> str:
    trace.log("SQL Writer", "Retrying with corrected SQL...")

    system = SQL_RETRY_SYSTEM.format(error=error, sql=original_sql, schema_block=schema_block)
    sql = call_llm(client, model, [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ], max_tokens=1000)

    sql = clean_sql(sql)
    trace.log("SQL Writer", f"Corrected SQL:\n{sql}")
    return sql

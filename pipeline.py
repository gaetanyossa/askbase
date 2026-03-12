"""Orchestrator-driven multi-agent pipeline.

Flow: Orchestrator -> Analyzer -> SQL Writer -> Validator -> Executor -> Formatter
The Orchestrator decides if the question needs data (SQL) or is just chat.
The Analyzer deeply inspects the schema. The SQL Writer uses the Analyzer's output directly.
"""

import re

from sqlalchemy import create_engine

import config
from agents.trace import AgentTrace
from agents.llm import create_client, get_default_model
from agents.orchestrator import agent_orchestrator
from agents.analyzer import agent_analyzer
from agents.sql_writer import agent_sql_writer, agent_sql_retry
from agents.validator import agent_validator
from agents.executor import agent_executor
from agents.formatter import agent_formatter
from db.connection import build_connection_url
from db.schema import get_live_schema, load_schema_file, format_schema
from prompts import QUALIFIER_RULES


def ask(
    question: str,
    db_type: str = "",
    api_key: str = "",
    model: str = "",
    llm_provider: str = "",
    bigquery_project: str = "",
    bigquery_dataset: str = "",
    bigquery_credentials_path: str = "",
    host: str = "",
    port: str = "",
    database: str = "",
    user: str = "",
    password: str = "",
    sqlite_path: str = "",
    conversation: list | None = None,
) -> dict:
    if not question.strip():
        raise ValueError("Question cannot be empty")

    db_type = db_type or config.DB_TYPE
    api_key = api_key or config.OPENAI_API_KEY
    llm_provider = llm_provider or config.LLM_PROVIDER
    model = model or config.OPENAI_MODEL or get_default_model(llm_provider)

    if not api_key:
        raise ValueError("API key is required")

    trace = AgentTrace()
    client = create_client(api_key, llm_provider)

    url = build_connection_url(
        db_type=db_type,
        host=host or config.DB_HOST,
        port=port or config.DB_PORT,
        database=database or config.DB_NAME,
        user=user or config.DB_USER,
        password=password or config.DB_PASSWORD,
        bigquery_project=bigquery_project or config.BIGQUERY_PROJECT,
        bigquery_dataset=bigquery_dataset or config.BIGQUERY_DATASET,
        bigquery_credentials_path=bigquery_credentials_path or config.GOOGLE_APPLICATION_CREDENTIALS,
        sqlite_path=sqlite_path or config.SQLITE_PATH,
    )
    engine = create_engine(url)

    schema_block = get_live_schema(engine, db_type, bigquery_project, bigquery_dataset)
    if not schema_block:
        try:
            schema_block = format_schema(load_schema_file())
        except Exception:
            schema_block = "(no schema available)"

    qualifier_rule = QUALIFIER_RULES.get(db_type, "").format(
        project=bigquery_project or config.BIGQUERY_PROJECT,
        dataset=bigquery_dataset or config.BIGQUERY_DATASET,
    )

    try:
        # ---- Step 1: Orchestrator decides: chat or data question ----
        decision = agent_orchestrator(
            client, model, question, schema_block, db_type, trace,
            conversation=conversation,
        )

        action = decision.get("action", "chat")

        if action == "chat":
            return _result(question, decision.get("response", ""), trace)

        if action == "respond":
            return _result(question, decision.get("message", ""), trace)

        # ---- Step 2: Analyzer inspects schema ----
        if action == "analyze":
            plan = {
                "intent": decision.get("intent", ""),
                "tables": decision.get("tables", []),
                "notes": decision.get("notes", ""),
            }
            analysis = agent_analyzer(client, model, question, plan, schema_block, db_type, trace)

            # Check if Analyzer says data is not available
            analysis_lower = analysis.lower()
            if any(phrase in analysis_lower for phrase in [
                "cannot be answered", "not available", "no column", "impossible",
                "does not exist", "no such column", "not possible",
            ]):
                # Let Analyzer's explanation be the response if it clearly says impossible
                # But still try SQL -- the SQL Writer will return a comment if truly impossible
                trace.log("Orchestrator", "Analyzer flagged potential issue, proceeding to SQL Writer anyway.")

        else:
            # Fallback: treat as analyze with empty plan
            plan = {"intent": question, "tables": [], "notes": ""}
            analysis = agent_analyzer(client, model, question, plan, schema_block, db_type, trace)

        # ---- Step 3: SQL Writer uses Analyzer's full analysis directly ----
        sql = agent_sql_writer(
            client, model, question, analysis,
            schema_block, db_type, qualifier_rule, config.MAX_ROWS, trace,
        )

        # ---- Step 4: Validator ----
        error = agent_validator(sql, trace)
        if error == "NO_SQL":
            comments = re.findall(r"--\s*(.+)", sql)
            msg = comments[0] if comments else "The requested data is not available in the current schema."
            trace.log("Formatter", f"No query to execute: {msg}")
            return _result(question, msg, trace)
        if error:
            return _result(question, f"Blocked: {error}", trace)

        # ---- Step 5: Executor (with retry on failure) ----
        try:
            columns, rows = agent_executor(engine, sql, config.MAX_ROWS, trace)
        except Exception as e:
            trace.log("Executor", f"Query failed: {e}")
            sql = agent_sql_retry(client, model, question, sql, str(e), schema_block, trace)

            error = agent_validator(sql, trace)
            if error == "NO_SQL":
                comments = re.findall(r"--\s*(.+)", sql)
                msg = comments[0] if comments else "The requested data is not available."
                trace.log("Formatter", f"No query to execute: {msg}")
                return _result(question, msg, trace)
            if error:
                return _result(question, f"Blocked: {error}", trace)

            columns, rows = agent_executor(engine, sql, config.MAX_ROWS, trace)

        # ---- Step 6: Formatter ----
        if not rows:
            trace.log("Formatter", "No results returned.")
            return _result(question, "The query returned no results.", trace)

        answer = agent_formatter(client, model, question, sql, columns, rows, trace)
        return _result(question, answer, trace)

    except Exception as e:
        trace.log("System", f"Error: {e}")
        return _result(question, f"An error occurred: {e}", trace)
    finally:
        engine.dispose()


def _result(question: str, answer: str, trace: AgentTrace) -> dict:
    return {"question": question, "answer": answer, "trace": trace.to_list()}

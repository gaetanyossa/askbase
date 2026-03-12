"""Orchestrator-driven multi-agent pipeline.

Flow: Orchestrator -> Reasoner -> Analyzer -> SQL Writer -> Validator -> Executor -> Formatter
The Orchestrator decides if the question needs data (SQL) or is just chat.
The Reasoner deeply analyzes the question and reformulates it.
The Analyzer writes SQL instructions. The SQL Writer generates the query.
"""

import re

from sqlalchemy import create_engine

import config
from agents.trace import AgentTrace
from agents.llm import create_client, get_default_model, reset_token_usage, get_token_usage
from agents.orchestrator import agent_orchestrator
from agents.reasoner import agent_reasoner
from agents.analyzer import agent_analyzer
from agents.sql_writer import agent_sql_writer, agent_sql_retry
from agents.validator import agent_validator
from agents.executor import agent_executor
from agents.formatter import agent_formatter
from db.connection import build_connection_url
from db.schema import get_live_schema, load_schema_file, format_schema
from db.conversations import get_audit
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
    reset_token_usage()
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

    # Enrich schema with audit context if available
    audit = get_audit()
    if audit and audit.get("text"):
        schema_block += "\n\n--- Database Audit (overview) ---\n" + audit["text"]

    qualifier_rule = QUALIFIER_RULES.get(db_type, "").format(
        project=bigquery_project or config.BIGQUERY_PROJECT,
        dataset=bigquery_dataset or config.BIGQUERY_DATASET,
    )

    try:
        # ---- Step 1: Orchestrator decides: chat, clarify, respond, or analyze ----
        decision = agent_orchestrator(
            client, model, question, schema_block, db_type, trace,
            conversation=conversation,
        )

        action = decision.get("action", "chat")

        if action == "chat":
            return _result(question, decision.get("response", ""), trace)

        if action == "clarify":
            return _result(question, decision.get("question", "Could you be more specific?"), trace)

        if action == "respond":
            return _result(question, decision.get("message", ""), trace)

        # ---- Step 2: Reasoner deeply analyzes the question ----
        reasoner_result = agent_reasoner(
            client, model, question, schema_block, db_type, trace,
            conversation=conversation,
        )

        reformulated = reasoner_result.get("reformulated_question", question)
        strategy = reasoner_result.get("strategy", "direct query")
        reasoner_tables = reasoner_result.get("tables", [])

        # Merge tables from orchestrator and reasoner
        all_tables = list(set(decision.get("tables", []) + reasoner_tables))

        # ---- Step 3: Analyzer writes SQL instructions ----
        plan = {
            "intent": reformulated,
            "strategy": strategy,
            "tables": all_tables,
        }
        analysis = agent_analyzer(client, model, reformulated, plan, schema_block, db_type, trace)

        # If Analyzer says data is not available, return directly
        if analysis.startswith("NOT_POSSIBLE:"):
            msg = analysis.replace("NOT_POSSIBLE:", "").strip()
            trace.log("Formatter", f"Not possible: {msg}")
            return _result(question, msg, trace)

        # ---- Step 4: SQL Writer generates the query ----
        sql = agent_sql_writer(
            client, model, reformulated, analysis,
            schema_block, db_type, qualifier_rule, config.MAX_ROWS, trace,
        )

        # ---- Step 5: Validator ----
        error = agent_validator(sql, trace)
        if error == "NO_SQL":
            comments = re.findall(r"--\s*(.+)", sql)
            msg = comments[0] if comments else "The requested data is not available in the current schema."
            trace.log("Formatter", f"No query to execute: {msg}")
            return _result(question, msg, trace)
        if error:
            return _result(question, f"Blocked: {error}", trace)

        # ---- Step 6: Executor (with retry on failure) ----
        try:
            columns, rows = agent_executor(engine, sql, config.MAX_ROWS, trace)
        except Exception as e:
            trace.log("Executor", f"Query failed: {e}")
            sql = agent_sql_retry(client, model, reformulated, sql, str(e), schema_block, trace)

            error = agent_validator(sql, trace)
            if error == "NO_SQL":
                comments = re.findall(r"--\s*(.+)", sql)
                msg = comments[0] if comments else "The requested data is not available."
                trace.log("Formatter", f"No query to execute: {msg}")
                return _result(question, msg, trace)
            if error:
                return _result(question, f"Blocked: {error}", trace)

            columns, rows = agent_executor(engine, sql, config.MAX_ROWS, trace)

        # ---- Step 7: Formatter ----
        if not rows:
            trace.log("Formatter", "No results returned.")
            return _result(question, "The query returned no results.", trace)

        answer = agent_formatter(client, model, question, sql, columns, rows, trace)
        return _result(question, answer, trace, columns=columns, rows=rows, sql=sql)

    except Exception as e:
        trace.log("System", f"Error: {e}")
        return _result(question, f"An error occurred: {e}", trace)
    finally:
        engine.dispose()


def _result(question: str, answer: str, trace: AgentTrace, columns=None, rows=None, sql=None) -> dict:
    usage = get_token_usage()
    trace.log("System", f"Tokens: {usage['prompt_tokens']} in + {usage['completion_tokens']} out = {usage['total_tokens']} total ({usage['calls']} LLM calls)")
    r = {"question": question, "answer": answer, "trace": trace.to_list(), "usage": usage}
    if sql:
        r["sql"] = sql
    if columns and rows:
        r["columns"] = columns
        r["rows"] = [
            [str(v) if v is not None else "" for v in row]
            for row in rows[:200]
        ]
    return r

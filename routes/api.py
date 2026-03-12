"""API endpoints for AskBase."""

import asyncio
import json
import os
import tempfile
import threading

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, inspect as sa_inspect, text
from starlette.responses import StreamingResponse

from db.connection import build_connection_url
from db.schema import load_schema_file, get_schema_with_samples
from db.conversations import (
    get_history, save_exchange, restore_history as db_restore,
    delete_conversation, save_audit, get_audit,
)
from pipeline import ask
from pipeline_stream import ask_streaming

router = APIRouter(prefix="/api")

# In-memory session state (single user)
_state: dict = {"creds_path": None}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _db_kwargs(
    db_type: str, host: str, port: str, database: str,
    user: str, password: str, bq_project: str, bq_dataset: str,
    sqlite_path: str,
) -> dict:
    """Build the common DB connection kwargs used across endpoints."""
    return dict(
        db_type=db_type, host=host, port=port, database=database,
        user=user, password=password,
        bigquery_project=bq_project, bigquery_dataset=bq_dataset,
        bigquery_credentials_path=_state.get("creds_path", ""),
        sqlite_path=sqlite_path,
    )


def _build_engine(db_kwargs: dict):
    return create_engine(build_connection_url(**db_kwargs))


def _sse_response(target_fn, *args):
    """Run *target_fn* in a thread, streaming queue events as SSE."""
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def _put(event: dict):
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    threading.Thread(target=target_fn, args=(*args, _put), daemon=True).start()

    async def generate():
        while True:
            event = await queue.get()
            yield f"data: {json.dumps(event)}\n\n"
            if event["type"] in ("result", "error"):
                break

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Demo & Credentials
# ---------------------------------------------------------------------------

@router.post("/demo")
async def use_demo():
    """Activate the built-in demo SQLite database."""
    try:
        from demo_db import create_demo_db
        return {"ok": True, "path": create_demo_db()}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@router.post("/upload-credentials")
async def upload_credentials(file: UploadFile = File(...)):
    try:
        data = json.loads(await file.read())
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, prefix="askbase_")
        json.dump(data, tmp)
        tmp.close()
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name
        _state["creds_path"] = tmp.name

        project_id = data.get("project_id", "")
        from google.cloud import bigquery
        client = bigquery.Client(project=project_id or None)
        datasets = [ds.dataset_id for ds in client.list_datasets()]
        return {"ok": True, "datasets": datasets, "project_id": project_id}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@router.post("/tables")
async def get_tables(project: str = Form(""), dataset: str = Form("")):
    try:
        from google.cloud import bigquery
        client = bigquery.Client(project=project or None)
        return {"tables": [t.table_id for t in client.list_tables(dataset)]}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


# ---------------------------------------------------------------------------
# Chat (ask / ask-stream)
# ---------------------------------------------------------------------------

@router.post("/ask")
async def ask_endpoint(
    question: str = Form(...),
    db_type: str = Form("bigquery"), api_key: str = Form(...),
    llm_provider: str = Form("openai"),
    bq_project: str = Form(""), bq_dataset: str = Form(""),
    host: str = Form(""), port: str = Form(""),
    database: str = Form(""), user: str = Form(""), password: str = Form(""),
    sqlite_path: str = Form(""), conversation_id: str = Form("default"),
):
    try:
        history = get_history(conversation_id)
        result = ask(
            question=question, api_key=api_key, llm_provider=llm_provider,
            conversation=history[-10:],
            **_db_kwargs(db_type, host, port, database, user, password, bq_project, bq_dataset, sqlite_path),
        )
        save_exchange(conversation_id, question, result.get("answer", ""))
        resp = {"ok": True, "answer": result.get("answer", ""), "trace": result.get("trace", [])}
        if result.get("columns"):
            resp["columns"] = result["columns"]
            resp["rows"] = result.get("rows", [])
        return resp
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@router.post("/ask-stream")
async def ask_stream_endpoint(
    question: str = Form(...),
    db_type: str = Form("bigquery"), api_key: str = Form(...),
    llm_provider: str = Form("openai"),
    bq_project: str = Form(""), bq_dataset: str = Form(""),
    host: str = Form(""), port: str = Form(""),
    database: str = Form(""), user: str = Form(""), password: str = Form(""),
    sqlite_path: str = Form(""), conversation_id: str = Form("default"),
):
    """SSE endpoint that streams agent trace steps in real-time."""
    history = get_history(conversation_id)
    db_kw = _db_kwargs(db_type, host, port, database, user, password, bq_project, bq_dataset, sqlite_path)

    def run(emit):
        def on_trace(agent: str, message: str):
            emit({"type": "trace", "agent": agent, "message": message})
        try:
            result = ask_streaming(
                question=question, trace_callback=on_trace,
                api_key=api_key, llm_provider=llm_provider,
                conversation=history[-10:], **db_kw,
            )
            save_exchange(conversation_id, question, result.get("answer", ""))
            emit({"type": "result", "data": result})
        except Exception as e:
            emit({"type": "error", "error": str(e)})

    return _sse_response(run)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

@router.get("/audit")
async def get_audit_endpoint():
    audit = get_audit()
    return {"ok": True, **audit} if audit else {"ok": False}


@router.put("/audit")
async def update_audit_endpoint(data: dict):
    """Update the audit text (user edit)."""
    txt = data.get("text", "")
    if not txt.strip():
        return JSONResponse(status_code=400, content={"ok": False, "error": "Audit text cannot be empty"})
    audit = get_audit()
    save_audit(txt, audit.get("usage", {}) if audit else {})
    return {"ok": True}


@router.post("/audit-stream")
async def audit_stream_endpoint(
    db_type: str = Form("bigquery"), api_key: str = Form(...),
    llm_provider: str = Form("openai"),
    bq_project: str = Form(""), bq_dataset: str = Form(""),
    host: str = Form(""), port: str = Form(""),
    database: str = Form(""), user: str = Form(""), password: str = Form(""),
    sqlite_path: str = Form(""), language: str = Form("en"),
):
    """SSE endpoint that streams the database audit in real-time."""
    from agents.llm import create_client, get_default_model
    from agents.auditor import agent_auditor
    from agents.trace import AgentTrace

    db_kw = _db_kwargs(db_type, host, port, database, user, password, bq_project, bq_dataset, sqlite_path)

    def run(emit):
        def on_trace(agent: str, message: str):
            emit({"type": "trace", "agent": agent, "message": message})
        try:
            engine = _build_engine(db_kw)
            schema_info = get_schema_with_samples(engine, db_type, bq_project, bq_dataset)
            engine.dispose()
            if not schema_info:
                emit({"type": "error", "error": "Could not read database schema"})
                return

            trace = AgentTrace()
            trace.set_callback(on_trace)
            client = create_client(api_key, llm_provider)
            model = get_default_model(llm_provider)
            result = agent_auditor(client, model, schema_info, db_type, trace, language=language)
            save_audit(result.get("audit", ""), result.get("usage", {}))
            emit({"type": "result", "data": result})
        except Exception as e:
            emit({"type": "error", "error": str(e)})

    return _sse_response(run)


# ---------------------------------------------------------------------------
# SQL Execution & Schema
# ---------------------------------------------------------------------------

BLOCKED_SQL = ("DROP ", "DELETE ", "TRUNCATE ", "ALTER ", "INSERT ", "UPDATE ", "CREATE ")


@router.post("/execute-sql")
async def execute_sql_endpoint(
    sql: str = Form(...),
    db_type: str = Form("bigquery"),
    bq_project: str = Form(""), bq_dataset: str = Form(""),
    host: str = Form(""), port: str = Form(""),
    database: str = Form(""), user: str = Form(""), password: str = Form(""),
    sqlite_path: str = Form(""),
):
    """Execute a raw SQL query and return results (SELECT only)."""
    try:
        sql_upper = sql.strip().upper()
        for kw in BLOCKED_SQL:
            if sql_upper.startswith(kw):
                return JSONResponse(status_code=400, content={"ok": False, "error": f"Blocked: {kw.strip()} not allowed"})

        engine = _build_engine(_db_kwargs(db_type, host, port, database, user, password, bq_project, bq_dataset, sqlite_path))
        with engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [[str(v) if v is not None else "" for v in row] for row in result.fetchmany(200)]
        engine.dispose()
        return {"ok": True, "columns": columns, "rows": rows}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@router.post("/schema")
async def get_schema_endpoint(
    db_type: str = Form("bigquery"),
    bq_project: str = Form(""), bq_dataset: str = Form(""),
    host: str = Form(""), port: str = Form(""),
    database: str = Form(""), user: str = Form(""), password: str = Form(""),
    sqlite_path: str = Form(""),
):
    """Return live schema from the connected database."""
    try:
        engine = _build_engine(_db_kwargs(db_type, host, port, database, user, password, bq_project, bq_dataset, sqlite_path))
        inspector = sa_inspect(engine)
        schema = {}
        with engine.connect() as conn:
            for table_name in inspector.get_table_names():
                cols = [{"name": c["name"], "type": str(c.get("type", "UNKNOWN")).split("(")[0].upper()}
                        for c in inspector.get_columns(table_name)]
                try:
                    row_count = conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar()
                except Exception:
                    row_count = None
                schema[table_name] = {"columns": cols, "row_count": row_count}
        engine.dispose()
        return schema
    except Exception as e:
        try:
            return load_schema_file()
        except Exception:
            return {"_error": str(e)}


# ---------------------------------------------------------------------------
# Scheduled Reports
# ---------------------------------------------------------------------------

@router.get("/schedules")
async def list_schedules():
    import scheduler
    return {"jobs": scheduler.get_jobs()}


@router.post("/schedules")
async def create_schedule(data: dict):
    import scheduler
    from pipeline import ask as pipeline_ask

    question = data.get("question", "")
    cron = data.get("cron", "09:00")
    channel = data.get("channel", "telegram")
    bot_token = data.get("bot_token", "")
    chat_id = data.get("chat_id", "")

    if not question:
        return JSONResponse(status_code=400, content={"ok": False, "error": "Question required"})
    if channel == "telegram" and (not bot_token or not chat_id):
        return JSONResponse(status_code=400, content={"ok": False, "error": "Telegram bot_token and chat_id required"})

    ask_kwargs = {
        "db_type": data.get("db_type", "sqlite"),
        "api_key": data.get("api_key", ""),
        "llm_provider": data.get("llm_provider", "openai"),
        "sqlite_path": data.get("sqlite_path", ""),
        "host": data.get("host", ""), "port": data.get("port", ""),
        "database": data.get("database", ""),
        "user": data.get("user", ""), "password": data.get("password", ""),
        "bigquery_project": data.get("bq_project", ""),
        "bigquery_dataset": data.get("bq_dataset", ""),
        "bigquery_credentials_path": _state.get("creds_path", ""),
    }

    job_id = f"sched_{len(scheduler.get_jobs()) + 1}_{hash(question) % 10000}"
    scheduler.start()
    scheduler.add_job(
        job_id=job_id, question=question, cron=cron,
        channel=channel, channel_config={"bot_token": bot_token, "chat_id": chat_id},
        ask_fn=pipeline_ask, ask_kwargs=ask_kwargs,
    )
    return {"ok": True, "job_id": job_id}


@router.delete("/schedules/{job_id}")
async def delete_schedule(job_id: str):
    import scheduler
    scheduler.remove_job(job_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

@router.get("/history")
async def get_history_endpoint(conversation_id: str = "default"):
    return get_history(conversation_id)[-50:]


@router.post("/restore-history")
async def restore_history_endpoint(data: dict):
    """Restore conversation history from client localStorage."""
    conv_id = data.get("conversation_id", "default")
    count = db_restore(conv_id, data.get("messages", []))
    return {"ok": True, "restored": count}

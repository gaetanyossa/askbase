"""API endpoints for AskBase."""

import json
import os
import tempfile

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse

from db.connection import build_connection_url
from db.schema import load_schema_file
from pipeline import ask

router = APIRouter(prefix="/api")

# In-memory session state (single user / demo)
_state = {
    "creds_path": None,
    "conversations": {},  # {conv_id: [{"q": ..., "a": ...}, ...]}
}


def _get_history(conv_id: str) -> list:
    return _state["conversations"].setdefault(conv_id, [])


@router.post("/upload-credentials")
async def upload_credentials(file: UploadFile = File(...)):
    try:
        content = await file.read()
        data = json.loads(content)
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
        tables = [t.table_id for t in client.list_tables(dataset)]
        return {"tables": tables}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@router.post("/ask")
async def ask_endpoint(
    question: str = Form(...),
    db_type: str = Form("bigquery"),
    api_key: str = Form(...),
    llm_provider: str = Form("openai"),
    bq_project: str = Form(""),
    bq_dataset: str = Form(""),
    host: str = Form(""),
    port: str = Form(""),
    database: str = Form(""),
    user: str = Form(""),
    password: str = Form(""),
    sqlite_path: str = Form(""),
    conversation_id: str = Form("default"),
):
    try:
        history = _get_history(conversation_id)
        result = ask(
            question=question,
            db_type=db_type,
            api_key=api_key,
            llm_provider=llm_provider,
            bigquery_project=bq_project,
            bigquery_dataset=bq_dataset,
            bigquery_credentials_path=_state.get("creds_path", ""),
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            sqlite_path=sqlite_path,
            conversation=history[-10:],
        )
        answer = result.get("answer", "No result.")
        trace = result.get("trace", [])
        history.append({"q": question, "a": answer})
        return {"ok": True, "answer": answer, "trace": trace}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@router.post("/schema")
async def get_schema(
    db_type: str = Form("bigquery"),
    bq_project: str = Form(""),
    bq_dataset: str = Form(""),
    host: str = Form(""),
    port: str = Form(""),
    database: str = Form(""),
    user: str = Form(""),
    password: str = Form(""),
    sqlite_path: str = Form(""),
):
    """Return live schema from the connected database."""
    try:
        from sqlalchemy import create_engine, inspect as sa_inspect

        url = build_connection_url(
            db_type=db_type,
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            bigquery_project=bq_project,
            bigquery_dataset=bq_dataset,
            bigquery_credentials_path=_state.get("creds_path", ""),
            sqlite_path=sqlite_path,
        )
        engine = create_engine(url)
        inspector = sa_inspect(engine)
        schema = {}
        for table_name in inspector.get_table_names():
            columns = [col["name"] for col in inspector.get_columns(table_name)]
            schema[table_name] = columns
        engine.dispose()
        return schema
    except Exception as e:
        try:
            return load_schema_file()
        except Exception:
            return {"_error": str(e)}


@router.get("/history")
async def get_history(conversation_id: str = "default"):
    return _get_history(conversation_id)[-50:]


@router.post("/restore-history")
async def restore_history(data: dict):
    """Restore conversation history from client localStorage for context continuity."""
    conv_id = data.get("conversation_id", "default")
    messages = data.get("messages", [])
    history = _get_history(conv_id)
    if messages and not history:
        for i in range(0, len(messages) - 1, 2):
            if messages[i].get("role") == "user" and i + 1 < len(messages) and messages[i + 1].get("role") == "bot":
                history.append({"q": messages[i]["text"], "a": messages[i + 1]["text"]})
    return {"ok": True, "restored": len(history)}

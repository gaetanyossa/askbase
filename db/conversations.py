"""Local SQLite storage for conversations -- survives server restarts."""

import json
import os
import sqlite3

_APP_DIR = os.path.dirname(os.path.dirname(__file__))
_DATA_DIR = os.path.join(_APP_DIR, "data") if os.path.isdir(os.path.join(_APP_DIR, "data")) else _APP_DIR
DB_PATH = os.path.join(_DATA_DIR, "conversations.db")


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS conversations (
        conv_id TEXT PRIMARY KEY,
        history TEXT DEFAULT '[]'
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        content TEXT DEFAULT '',
        usage_json TEXT DEFAULT '{}',
        updated_at TEXT DEFAULT ''
    )""")
    return conn


def get_history(conv_id: str) -> list:
    conn = _conn()
    row = conn.execute("SELECT history FROM conversations WHERE conv_id = ?", (conv_id,)).fetchone()
    conn.close()
    if row:
        return json.loads(row[0])
    return []


def save_exchange(conv_id: str, question: str, answer: str):
    conn = _conn()
    row = conn.execute("SELECT history FROM conversations WHERE conv_id = ?", (conv_id,)).fetchone()
    history = json.loads(row[0]) if row else []
    history.append({"q": question, "a": answer})
    # Keep last 50 exchanges
    history = history[-50:]
    if row:
        conn.execute("UPDATE conversations SET history = ? WHERE conv_id = ?", (json.dumps(history), conv_id))
    else:
        conn.execute("INSERT INTO conversations (conv_id, history) VALUES (?, ?)", (conv_id, json.dumps(history)))
    conn.commit()
    conn.close()


def restore_history(conv_id: str, messages: list):
    """Restore conversation from client-side messages."""
    history = []
    for i in range(0, len(messages) - 1, 2):
        if messages[i].get("role") == "user" and i + 1 < len(messages) and messages[i + 1].get("role") == "bot":
            history.append({"q": messages[i]["text"], "a": messages[i + 1]["text"]})
    if not history:
        return 0
    conn = _conn()
    existing = conn.execute("SELECT history FROM conversations WHERE conv_id = ?", (conv_id,)).fetchone()
    if not existing:
        conn.execute("INSERT INTO conversations (conv_id, history) VALUES (?, ?)", (conv_id, json.dumps(history[-50:])))
        conn.commit()
    conn.close()
    return len(history)


def delete_conversation(conv_id: str):
    conn = _conn()
    conn.execute("DELETE FROM conversations WHERE conv_id = ?", (conv_id,))
    conn.commit()
    conn.close()


# ---- Global Audit ----

def save_audit(content: str, usage: dict):
    """Save or update the global database audit."""
    from datetime import datetime
    conn = _conn()
    conn.execute(
        "INSERT OR REPLACE INTO audit (id, content, usage_json, updated_at) VALUES (1, ?, ?, ?)",
        (content, json.dumps(usage), datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def get_audit() -> dict | None:
    """Get the global database audit if it exists."""
    conn = _conn()
    row = conn.execute("SELECT content, usage_json, updated_at FROM audit WHERE id = 1").fetchone()
    conn.close()
    if row and row[0]:
        return {
            "text": row[0],
            "usage": json.loads(row[1]) if row[1] else {},
            "updated_at": row[2],
        }
    return None

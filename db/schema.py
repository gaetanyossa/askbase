"""Schema helpers -- live introspection and static file fallback."""

import json
import logging

from sqlalchemy import inspect, text

import config

logger = logging.getLogger(__name__)


def load_schema_file() -> dict:
    with open(config.SCHEMA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def format_schema(schema: dict) -> str:
    lines = []
    for table, columns in schema.items():
        cols = ", ".join(columns)
        lines.append(f"  {table}: {cols}")
    return "\n".join(lines)


def get_live_schema(engine, db_type: str, project: str = "", dataset: str = "") -> str:
    """Fetch live schema with column names AND types."""
    try:
        inspector = inspect(engine)
        lines = []
        for table_name in inspector.get_table_names():
            col_parts = []
            for col in inspector.get_columns(table_name):
                col_type = str(col.get("type", "UNKNOWN"))
                # Simplify verbose type names
                col_type = col_type.split("(")[0].upper()
                col_parts.append(f"{col['name']} ({col_type})")
            if db_type == "bigquery" and project and dataset:
                full_name = f"`{project}.{dataset}.{table_name}`"
            else:
                full_name = table_name
            lines.append(f"  {full_name}: {', '.join(col_parts)}")
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"Could not fetch live schema: {e}")
        return ""


def get_schema_with_samples(engine, db_type: str, project: str = "", dataset: str = "", sample_rows: int = 3) -> dict:
    """Fetch schema with row counts and sample data for each table.

    Returns: {table_name: {columns: [{name, type}], row_count: int, samples: [[val, ...]]}}
    """
    try:
        inspector = inspect(engine)
        result = {}
        with engine.connect() as conn:
            for table_name in inspector.get_table_names():
                cols = []
                for col in inspector.get_columns(table_name):
                    col_type = str(col.get("type", "UNKNOWN")).split("(")[0].upper()
                    cols.append({"name": col["name"], "type": col_type})

                if db_type == "bigquery" and project and dataset:
                    full_name = f"`{project}.{dataset}.{table_name}`"
                else:
                    full_name = table_name

                # Row count
                try:
                    row_count = conn.execute(text(f"SELECT COUNT(*) FROM {full_name}")).scalar()
                except Exception:
                    row_count = None

                # Sample rows
                samples = []
                try:
                    rows = conn.execute(text(f"SELECT * FROM {full_name} LIMIT {sample_rows}")).fetchall()
                    samples = [list(str(v) if v is not None else "" for v in row) for row in rows]
                except Exception:
                    pass

                result[table_name] = {
                    "columns": cols,
                    "row_count": row_count,
                    "samples": samples,
                }
        return result
    except Exception as e:
        logger.warning(f"Could not fetch schema with samples: {e}")
        return {}

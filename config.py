"""Application configuration -- loaded from environment variables."""

import os

from dotenv import load_dotenv

load_dotenv()

# -- LLM --
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "")

# -- Database --
DB_TYPE = os.getenv("DB_TYPE", "bigquery")
DB_HOST = os.getenv("DB_HOST", "")
DB_PORT = os.getenv("DB_PORT", "")
DB_NAME = os.getenv("DB_NAME", "")
DB_USER = os.getenv("DB_USER", "")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

# -- BigQuery --
GOOGLE_APPLICATION_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
BIGQUERY_PROJECT = os.getenv("BIGQUERY_PROJECT", "")
BIGQUERY_DATASET = os.getenv("BIGQUERY_DATASET", "")

# -- SQLite --
SQLITE_PATH = os.getenv("SQLITE_PATH", "")

# -- General --
SCHEMA_FILE = os.getenv("SCHEMA_FILE", "table_schemas.json")
MAX_ROWS = int(os.getenv("MAX_ROWS", "100"))

SUPPORTED_DB_TYPES = ("bigquery", "mysql", "postgresql", "sqlite")

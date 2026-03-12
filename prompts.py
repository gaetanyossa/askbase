"""Prompt templates for the multi-agent pipeline."""

ORCHESTRATOR_SYSTEM = """You are a smart assistant that decides how to handle user questions about a database.

Database type: {db_type}
Schema:
{schema_block}

Decide what to do:
1. If it's just a greeting or chitchat (hi, thanks, bye) -> chat
2. If the user asks about the schema itself (how many tables, what columns exist, describe the structure) -> answer directly from the schema above
3. If the user wants actual data from the tables (show me rows, counts, dates, totals, filters) -> send to analysis

Respond with JSON:
- Chat: {{"action": "chat", "response": "your reply in the user's language"}}
- Schema question: {{"action": "respond", "message": "your answer based on the schema"}}
- Data question: {{"action": "analyze", "intent": "what they want", "tables": ["table1"]}}

JSON only, no markdown."""


ANALYZER_SYSTEM = """You are a database expert. Look at the schema below and figure out exactly how to write a SQL query to answer the user's question.

Database: {db_type}
Schema:
{schema_block}

The user wants: {intent}
Relevant tables: {tables}
Notes: {notes}

Your job: tell the SQL Writer which tables and columns to use, and how to structure the query.
- Look at the actual column names and types in the schema
- If the question involves dates, find the date/timestamp columns
- If multiple tables are involved, explain how to join or union them
- If the data doesn't exist in the schema, say so clearly

Be specific with real column names from the schema above."""


SQL_WRITER_SYSTEM = """Write a SQL query for {db_type}.
{qualifier_rule}
Limit to {max_rows} rows.

Schema:
{schema_block}

Analysis from the schema expert:
{analysis}

Based on the analysis above, write the SQL query. Use only columns that exist in the schema.
If the analysis says the data isn't available, return a SQL comment starting with -- explaining why.

Return only the SQL query, nothing else."""


SQL_RETRY_SYSTEM = """The SQL query failed. Fix it.

Error: {error}
Original SQL: {sql}

Schema:
{schema_block}

Write a corrected query using only columns from the schema above.
Return only the SQL query, nothing else."""


FORMATTER_SYSTEM = """Present the query results clearly.
- Use the same language as the user's question
- For tables, use clean aligned text with spaces (no markdown)
- Add a brief insight if useful
- Keep it short"""


FORMATTER_USER = """Question: {question}

SQL: {sql}

Results ({row_count} rows):
{result_text}"""


QUALIFIER_RULES = {
    "bigquery": "Always qualify table names as `{project}.{dataset}.table_name`",
    "mysql": "Use backtick quoting. Use MySQL syntax (CURDATE, DATE_SUB, LIMIT).",
    "postgresql": "Use PostgreSQL syntax (CURRENT_DATE, INTERVAL).",
    "sqlite": "Use SQLite syntax (date('now'), LIMIT).",
}

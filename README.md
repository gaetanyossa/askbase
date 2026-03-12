<p align="center">
  <img src="Img/logo.png" alt="AskBase Logo" width="80" />
</p>

<h1 align="center">AskBase</h1>

<p align="center">
  <strong>Talk to your database. Get answers instantly.</strong><br/>
  Open-source AI-powered natural language to SQL engine.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#api">API</a> &bull;
  <a href="https://github.com/gaetanyossa/Askbase">GitHub</a>
</p>

---

AskBase lets anyone query a database without writing SQL. Ask a question in plain language, and a multi-agent AI pipeline analyzes your schema, writes safe SQL, executes it, and returns a clear answer. Works with BigQuery, PostgreSQL, MySQL and SQLite, and supports OpenAI, Claude and Gemini as LLM providers.

![AskBase Screenshot](Img/screenshot.png)

## Features

- **Natural language to SQL** -- ask questions in plain English (or any language), get answers from your database
- **Multi-agent pipeline** -- Orchestrator > Analyzer > SQL Writer > Validator > Executor > Formatter
- **Multi-database** -- BigQuery, PostgreSQL, MySQL, SQLite
- **Multi-LLM** -- OpenAI, Claude (Anthropic), Gemini (Google)
- **Live schema introspection** -- automatically reads your tables and columns with types
- **Multi-conversation** -- create, switch and delete conversations with persistent history
- **SQL safety** -- only SELECT queries allowed, dangerous keywords blocked
- **Agent trace** -- see the full pipeline reasoning in real time

## Quick Start

### 1. Install

```bash
git clone https://github.com/gaetanyossa/Askbase.git
cd Askbase
pip install -r requirements.txt
```

### 2. Run

```bash
python app.py
```

Open [http://localhost:8080](http://localhost:8080)

### 3. Configure

In the app:
1. Choose your database type (BigQuery, PostgreSQL, MySQL, SQLite)
2. Enter your connection details
3. Choose your LLM provider and paste your API key
4. Start asking questions!

## Environment Variables (optional)

You can also configure via `.env`:

```env
# LLM
LLM_PROVIDER=openai          # openai | anthropic | gemini
OPENAI_API_KEY=sk-...
OPENAI_MODEL=                 # auto-detected if empty

# Database
DB_TYPE=bigquery              # bigquery | mysql | postgresql | sqlite
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=

# BigQuery
BIGQUERY_PROJECT=
BIGQUERY_DATASET=
GOOGLE_APPLICATION_CREDENTIALS=

# SQLite
SQLITE_PATH=

# General
MAX_ROWS=100
```

## Architecture

AskBase uses an orchestrator-driven multi-agent pipeline. Each agent has a single responsibility, and the Orchestrator decides which agents to call based on the user's question.

```
User Question
     |
     v
+--------------+
| Orchestrator |  Brain: decides if it's a chat, schema question, or data query
+------+-------+
       |
       v (data query)
+----------+
| Analyzer |  Inspects schema, finds the right tables and columns
+----+-----+
     |
     v
+------------+
| SQL Writer |  Writes the SQL based on Analyzer's findings
+-----+------+
      |
      v
+-----------+
| Validator |  Checks SQL safety (SELECT only, no DROP/DELETE/UPDATE/INSERT)
+-----+-----+
      |
      v
+----------+
| Executor |  Runs the query against your database
+----+-----+
     |
     v
+-----------+
| Formatter |  Presents results in a clear, readable format
+-----------+
```

**Why multi-agent?** Each agent is specialized with its own prompt, so no single LLM call has to handle everything. The Orchestrator coordinates the flow and can short-circuit for simple questions (e.g. "how many tables?" doesn't need SQL).

## Docker

```bash
docker build -t askbase .
docker run -p 8080:8080 askbase
```

## API

Interactive API docs available at `/docs` when the server is running.

**POST** `/api/ask`

| Parameter | Description |
|-----------|-------------|
| `question` | Your question in natural language |
| `db_type` | `bigquery`, `mysql`, `postgresql`, `sqlite` |
| `api_key` | Your LLM API key |
| `llm_provider` | `openai`, `anthropic`, `gemini` |
| `conversation_id` | (optional) Conversation ID for context |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, SQLAlchemy |
| Frontend | Vanilla HTML / CSS / JS |
| LLM | OpenAI-compatible API (OpenAI, Anthropic, Google) |
| Databases | BigQuery, PostgreSQL, MySQL, SQLite |

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

MIT

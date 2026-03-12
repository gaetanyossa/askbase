# ---- Build stage: install dependencies ----
FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- Runtime stage ----
FROM python:3.12-slim

WORKDIR /app

# Only the runtime libs we actually need
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY agents/ agents/
COPY db/ db/
COPY routes/ routes/
COPY static/ static/
COPY app.py config.py pipeline.py pipeline_stream.py prompts.py scheduler.py demo_db.py ./

# Create data directory for SQLite databases
RUN mkdir -p /app/data

# Non-root user for security
RUN useradd -m -r askbase && chown -R askbase:askbase /app
USER askbase

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

# Pre-create demo DB on build so first startup is instant
RUN python -c "from demo_db import create_demo_db; create_demo_db()"

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]

"""Shared LLM call wrapper -- supports OpenAI, Claude (Anthropic), Gemini (Google) via OpenAI-compatible APIs."""

import threading

from openai import OpenAI

# Provider configs: each maps to an OpenAI-compatible base_url
PROVIDERS = {
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
    },
    "anthropic": {
        "base_url": "https://api.anthropic.com/v1",
        "default_model": "claude-sonnet-4-20250514",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "default_model": "gemini-2.0-flash",
    },
}


# Thread-local token tracking
_token_tracker = threading.local()


def reset_token_usage():
    """Reset token counters for a new request."""
    _token_tracker.prompt_tokens = 0
    _token_tracker.completion_tokens = 0
    _token_tracker.total_tokens = 0
    _token_tracker.calls = 0


def get_token_usage() -> dict:
    """Return accumulated token usage for the current request."""
    return {
        "prompt_tokens": getattr(_token_tracker, "prompt_tokens", 0),
        "completion_tokens": getattr(_token_tracker, "completion_tokens", 0),
        "total_tokens": getattr(_token_tracker, "total_tokens", 0),
        "calls": getattr(_token_tracker, "calls", 0),
    }


def create_client(api_key: str, provider: str = "openai") -> OpenAI:
    provider = provider.lower()
    cfg = PROVIDERS.get(provider, PROVIDERS["openai"])
    return OpenAI(api_key=api_key, base_url=cfg["base_url"])


def get_default_model(provider: str = "openai") -> str:
    provider = provider.lower()
    return PROVIDERS.get(provider, PROVIDERS["openai"])["default_model"]


def call_llm(client: OpenAI, model: str, messages: list, max_tokens: int = 2000) -> str:
    resp = client.chat.completions.create(
        model=model,
        temperature=0,
        max_tokens=max_tokens,
        messages=messages,
    )

    # Track token usage
    usage = resp.usage
    if usage:
        _token_tracker.prompt_tokens = getattr(_token_tracker, "prompt_tokens", 0) + (usage.prompt_tokens or 0)
        _token_tracker.completion_tokens = getattr(_token_tracker, "completion_tokens", 0) + (usage.completion_tokens or 0)
        _token_tracker.total_tokens = getattr(_token_tracker, "total_tokens", 0) + (usage.total_tokens or 0)
    _token_tracker.calls = getattr(_token_tracker, "calls", 0) + 1

    return resp.choices[0].message.content.strip()


def clean_sql(sql: str) -> str:
    """Strip markdown fences and normalize trailing semicolon."""
    if sql.startswith("```"):
        sql = "\n".join(sql.split("\n")[1:])
    if sql.endswith("```"):
        sql = sql.rsplit("```", 1)[0]
    return sql.strip().rstrip(";") + ";"

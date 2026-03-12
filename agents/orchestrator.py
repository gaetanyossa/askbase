"""Orchestrator agent -- decides whether a question needs SQL or is just chat."""

import json

from openai import OpenAI

from agents.llm import call_llm
from agents.trace import AgentTrace
from prompts import ORCHESTRATOR_SYSTEM


def agent_orchestrator(
    client: OpenAI,
    model: str,
    question: str,
    schema_block: str,
    db_type: str,
    trace: AgentTrace,
    conversation: list | None = None,
) -> dict:
    """
    The Orchestrator decides the next action.
    Returns a dict with:
      - {"action": "chat", "response": "..."}  -> direct response, no SQL needed
      - {"action": "analyze", "tables": [...], "intent": "..."}  -> delegate to Analyzer
      - {"action": "respond", "message": "..."}  -> respond directly (e.g. no data available)
      - {"action": "clarify", "question": "..."}  -> ask user for more details
    """
    trace.log("Orchestrator", f'Received question: "{question}"')

    system = ORCHESTRATOR_SYSTEM.format(
        db_type=db_type,
        schema_block=schema_block,
    )

    messages = [{"role": "system", "content": system}]
    if conversation:
        for msg in conversation[-10:]:
            messages.append({"role": "user", "content": msg["q"]})
            messages.append({"role": "assistant", "content": msg["a"]})
        trace.log("Orchestrator", f"Loaded {len(conversation[-10:])} previous exchange(s) for context.")

    messages.append({"role": "user", "content": question})

    raw = call_llm(client, model, messages, max_tokens=600)

    try:
        cleaned = raw.strip("`").replace("json\n", "").strip()
        decision = json.loads(cleaned)
    except json.JSONDecodeError:
        decision = {"action": "chat", "response": raw}

    action = decision.get("action", "chat")
    reasoning = decision.get("reasoning", "")

    trace.log("Orchestrator", f"Reasoning: {reasoning}")
    trace.log("Orchestrator", f"Decision: {action}")

    if action == "analyze":
        trace.log("Orchestrator", f"Delegating to Analyzer for: {decision.get('intent', '?')}")
        trace.log("Orchestrator", f"Target tables: {', '.join(decision.get('tables', []))}")
    elif action == "respond":
        trace.log("Orchestrator", f"Direct schema response: {decision.get('message', '')[:120]}")
    elif action == "clarify":
        trace.log("Orchestrator", f"Asking user for clarification: {decision.get('question', '')}")
    elif action == "chat":
        trace.log("Orchestrator", "Conversational response (no SQL needed)")

    return decision

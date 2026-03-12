"""Planner agent -- understands the question, identifies tables, creates a plan."""

import json

from openai import OpenAI

from agents.llm import call_llm
from agents.trace import AgentTrace
from prompts import PLANNER_SYSTEM


def agent_planner(
    client: OpenAI,
    model: str,
    question: str,
    schema_block: str,
    db_type: str,
    trace: AgentTrace,
    conversation: list | None = None,
) -> dict:
    trace.log("Planner", f'Received question: "{question}"')

    system = PLANNER_SYSTEM.format(db_type=db_type, schema_block=schema_block)

    messages = [{"role": "system", "content": system}]
    if conversation:
        for msg in conversation[-10:]:
            messages.append({"role": "user", "content": msg["q"]})
            messages.append({"role": "assistant", "content": msg["a"]})
        trace.log("Planner", f"Using {len(conversation[-10:])} previous exchange(s) as context.")

    messages.append({"role": "user", "content": question})

    raw = call_llm(client, model, messages, max_tokens=500)

    try:
        cleaned = raw.strip("`").replace("json\n", "").strip()
        plan = json.loads(cleaned)
    except json.JSONDecodeError:
        plan = {"type": "chat", "response": raw}

    if plan.get("type") == "data":
        trace.log("Planner", f"Intent: {plan.get('intent', '?')}")
        trace.log("Planner", f"Tables: {', '.join(plan.get('tables', []))}")
        if plan.get("notes"):
            trace.log("Planner", f"Notes: {plan['notes']}")
    else:
        trace.log("Planner", "This is not a data question. Responding directly.")

    return plan

"""Reasoner agent -- deeply analyzes the user's question and reformulates it into a precise data query."""

import json

from openai import OpenAI

from agents.llm import call_llm
from agents.trace import AgentTrace
from prompts import REASONER_SYSTEM


def agent_reasoner(
    client: OpenAI,
    model: str,
    question: str,
    schema_block: str,
    db_type: str,
    trace: AgentTrace,
    conversation: list | None = None,
) -> dict:
    """
    The Reasoner deeply thinks about the user's question.
    Returns a dict with:
      - reformulated_question: a clear, precise data question
      - reasoning: step-by-step thinking
      - strategy: what data approach to use
      - tables: relevant tables
    """
    trace.log("Reasoner", f'Analyzing question: "{question}"')

    system = REASONER_SYSTEM.format(
        db_type=db_type,
        schema_block=schema_block,
    )

    messages = [{"role": "system", "content": system}]

    # Include conversation as proper chat messages for better context resolution
    if conversation:
        for msg in conversation[-6:]:
            messages.append({"role": "user", "content": msg["q"]})
            messages.append({"role": "assistant", "content": msg["a"]})
        trace.log("Reasoner", f"Using {len(conversation[-6:])} previous exchange(s) for context.")

    messages.append({"role": "user", "content": question})

    raw = call_llm(client, model, messages, max_tokens=800)

    try:
        cleaned = raw.strip("`").replace("json\n", "").strip()
        result = json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback: use the raw text as reasoning
        result = {
            "reasoning": raw,
            "reformulated_question": question,
            "strategy": "direct query",
            "tables": [],
        }

    trace.log("Reasoner", f"Thinking: {result.get('reasoning', '')}")
    trace.log("Reasoner", f"Reformulated: {result.get('reformulated_question', question)}")
    trace.log("Reasoner", f"Strategy: {result.get('strategy', '')}")

    return result

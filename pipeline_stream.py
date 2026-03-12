"""Streaming wrapper around the main pipeline -- injects a trace callback for real-time SSE."""

from typing import Callable
from agents.trace import AgentTrace
from pipeline import ask as _ask_core


def ask_streaming(
    question: str,
    trace_callback: Callable,
    **kwargs,
) -> dict:
    """Run the pipeline with a real-time trace callback.

    This works by monkey-patching the AgentTrace used inside `ask()`.
    We override __init__ so the trace created in ask() gets our callback.
    """
    _original_init = AgentTrace.__init__

    def _patched_init(self, *args, **kw):
        _original_init(self, *args, **kw)
        self.set_callback(trace_callback)

    AgentTrace.__init__ = _patched_init
    try:
        return _ask_core(question=question, **kwargs)
    finally:
        AgentTrace.__init__ = _original_init

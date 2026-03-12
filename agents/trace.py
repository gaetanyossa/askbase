"""AgentTrace -- visible log of all agent communication with optional real-time callback."""

from dataclasses import dataclass, field
from typing import Callable


@dataclass
class AgentTrace:
    steps: list = field(default_factory=list)
    _on_log: Callable | None = None

    def set_callback(self, callback: Callable):
        """Set a callback that fires on every log. callback(agent, message)"""
        self._on_log = callback

    def log(self, agent: str, message: str):
        step = {"agent": agent, "message": message}
        self.steps.append(step)
        if self._on_log:
            try:
                self._on_log(agent, message)
            except Exception:
                pass

    def to_list(self) -> list:
        return self.steps

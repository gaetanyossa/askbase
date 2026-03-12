"""AgentTrace -- visible log of all agent communication."""

from dataclasses import dataclass, field


@dataclass
class AgentTrace:
    steps: list = field(default_factory=list)

    def log(self, agent: str, message: str):
        self.steps.append({"agent": agent, "message": message})

    def to_list(self) -> list:
        return self.steps

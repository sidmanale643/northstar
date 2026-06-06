"""
Minimal agent example using NorthStar with logger output.

This demonstrates how NorthStar traces would work without requiring Supabase.
"""

import logging
from datetime import datetime
from typing import Any, Dict
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("northstar")


# Minimal local models for demo (same structure as src/models.py)
class ToolCall(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    params: Dict[str, Any] = {}
    output: str = ""
    created_at: datetime = Field(default_factory=datetime.now)


class Trace(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str = Field(default_factory=lambda: str(uuid4()))
    run_id: str = Field(default_factory=lambda: str(uuid4()))
    tool_call: ToolCall
    created_at: datetime = Field(default_factory=datetime.now)


class Session(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str = Field(default_factory=lambda: str(uuid4()))
    traces: list[Trace] = []
    ended_at: datetime | None = None


class NorthstarLogger:
    """Logger-based NorthStar client for local development and debugging."""

    def __init__(self):
        self.sessions: Dict[str, Session] = {}

    def start_session(self) -> Session:
        session = Session()
        self.sessions[session.id] = session
        logger.info(f"Session started: {session.id}")
        return session

    def record_trace(self, session: Session, tool_name: str, params: Dict[str, Any], output: str) -> Trace:
        tool_call = ToolCall(name=tool_name, params=params, output=output)
        trace = Trace(tool_call=tool_call)
        session.traces.append(trace)

        logger.info(
            f"Trace recorded | session={session.id[:8]}... | "
            f"tool={tool_name} | params={params} | output={output}"
        )
        return trace

    def end_session(self, session: Session) -> None:
        session.ended_at = datetime.now()
        logger.info(
            f"Session ended: {session.id[:8]}... | "
            f"total_traces={len(session.traces)}"
        )


# --- Dummy Agent ---

def dummy_search(query: str) -> str:
    """Simulates a search tool."""
    return f"Search results for: {query}"


def dummy_calculator(expression: str) -> str:
    """Simulates a calculator tool."""
    return str(eval(expression))


def run_agent(task: str) -> str:
    """Minimal agent that processes a task using tools."""
    northstar = NorthstarLogger()
    session = northstar.start_session()

    # Simulate agent deciding to use tools
    logger.info(f"Agent received task: {task}")

    # Step 1: Search for information
    search_result = dummy_search(task)
    northstar.record_trace(session, "search", {"query": task}, search_result)

    # Step 2: Do some calculation
    calc_result = dummy_calculator("2 + 2")
    northstar.record_trace(session, "calculator", {"expression": "2 + 2"}, calc_result)

    # Step 3: Generate response
    response = f"Based on my search and calculations, here's the answer to '{task}': {search_result} and {calc_result}"
    northstar.record_trace(session, "generate_response", {"task": task}, response)

    northstar.end_session(session)

    return response


if __name__ == "__main__":
    result = run_agent("What is the meaning of life?")
    print(f"\nFinal result: {result}")

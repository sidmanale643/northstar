"""
simple_openrouter_agent.py

Run:
  uv run python test.py

Create .env:
  OPENROUTER_API_KEY=your_key_here
  NORTHSTAR_API_KEY=your_northstar_key_here
  NORTHSTAR_PROJECT_ID=your_supabase_project_ref_here
"""

import os
import json
import math
import operator
from typing import Any

from litellm import completion
import northstar
from dotenv import load_dotenv

load_dotenv(override=True)


OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

MODEL = "openrouter/deepseek/deepseek-v4-flash"

northstar.init(project="simple-openrouter-agent")


# -----------------------------
# Tools
# -----------------------------

def calculator(expression: str) -> str:
    """
    Safely evaluate basic math expressions.
    Supports: +, -, *, /, %, **, parentheses, math functions.
    """

    allowed_names = {
        "sqrt": math.sqrt,
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "log": math.log,
        "log10": math.log10,
        "pi": math.pi,
        "e": math.e,
        "abs": abs,
        "round": round,
        "min": min,
        "max": max,
    }

    try:
        result = eval(
            expression,
            {"__builtins__": {}},
            allowed_names,
        )
        return str(result)
    except Exception as e:
        return f"Calculator error: {str(e)}"


def get_current_time(city: str = "India") -> str:
    """
    Dummy time tool.
    Replace this with real timezone logic later.
    """

    from datetime import datetime

    now = datetime.now()
    return f"Current local time near {city}: {now.strftime('%Y-%m-%d %H:%M:%S')}"


def search_notes(query: str) -> str:
    """
    Dummy search tool.
    Replace this with vector DB / web search / docs search later.
    """

    fake_notes = {
        "north star": "North Star is an observability and debugging platform for AI agents.",
        "agent": "An AI agent usually loops between reasoning, tool use, and final response.",
        "rag": "RAG means Retrieval Augmented Generation. It retrieves context before answering.",
    }

    results = []

    for key, value in fake_notes.items():
        if key.lower() in query.lower():
            results.append(value)

    if not results:
        return "No matching notes found."

    return "\n".join(results)


TOOL_REGISTRY = {
    "calculator": calculator,
    "get_current_time": get_current_time,
    "search_notes": search_notes,
}


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Use this for arithmetic or math expressions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Math expression to evaluate, e.g. '2 + 2 * 5'",
                    }
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Get the current local time for a city or place.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "City or location name.",
                    }
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_notes",
            "description": "Search the user's local notes or knowledge base.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query.",
                    }
                },
                "required": ["query"],
            },
        },
    },
]


# -----------------------------
# OpenRouter Call
# -----------------------------

def call_openrouter(messages: list[dict[str, Any]]) -> dict[str, Any]:
    if not OPENROUTER_API_KEY:
        raise ValueError("Missing OPENROUTER_API_KEY in environment variables.")

    response = completion(
        model=MODEL,
        messages=messages,
        tools=TOOLS,
        tool_choice="auto",
        temperature=0.2,
        api_key=OPENROUTER_API_KEY,
    )

    message = response.choices[0].message
    if hasattr(message, "model_dump"):
        return message.model_dump(exclude_none=True)

    return dict(message)


# -----------------------------
# Agent Loop
# -----------------------------

@northstar.trace("simple-openrouter-agent")
def run_agent(user_input: str, max_steps: int = 5):
    northstar.log_metadata({"model": MODEL, "provider": "openrouter"})
    last_tool_result = None

    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful Python tool-calling agent. "
                "Use tools when needed. If no tool is needed, answer directly. "
                "Do not fake tool results."
            ),
        },
        {
            "role": "user",
            "content": user_input,
        },
    ]

    for step in range(max_steps):
        iteration = step + 1
        with northstar.span(
            "openrouter.chat.completions",
            kind=northstar.SpanKind.MODEL,
            iteration=iteration,
            attributes={"model": MODEL, "provider": "openrouter"},
        ):
            assistant_message = call_openrouter(messages)

        messages.append(assistant_message)

        tool_calls = assistant_message.get("tool_calls")

        if not tool_calls:
            return assistant_message.get("content") or last_tool_result or ""

        for tool_call in tool_calls:
            tool_name = tool_call["function"]["name"]
            tool_args_raw = tool_call["function"].get("arguments", "{}")

            try:
                tool_args = json.loads(tool_args_raw)
            except json.JSONDecodeError:
                tool_args = {}

            print(f"\n[tool call] {tool_name}({tool_args})")

            tool_fn = TOOL_REGISTRY.get(tool_name)

            with northstar.span(
                tool_name,
                kind=northstar.SpanKind.TOOL,
                iteration=iteration,
                attributes={"tool_call_id": tool_call["id"]},
            ):
                northstar.log_event("tool_arguments", tool_args)
                if not tool_fn:
                    tool_result = f"Unknown tool: {tool_name}"
                else:
                    try:
                        tool_result = tool_fn(**tool_args)
                    except Exception as e:
                        tool_result = f"Tool execution error: {str(e)}"
                northstar.log_event("tool_result", tool_result)
                last_tool_result = str(tool_result)

            print(f"[tool result] {tool_result}\n")

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "name": tool_name,
                    "content": str(tool_result),
                }
            )

    return "Agent stopped because max_steps was reached."


# -----------------------------
# CLI
# -----------------------------

if __name__ == "__main__":
    print("Simple OpenRouter Tool Agent")
    print("Type 'exit' to quit.\n")

    while True:
        user_input = input("You: ")

        if user_input.lower() in {"exit", "quit"}:
            break

        try:
            answer = run_agent(user_input)
            print(f"\nAgent: {answer}\n")
            
        except Exception as e:
            print(f"\nError: {str(e)}\n")
        finally:
            northstar.flush(timeout=5)

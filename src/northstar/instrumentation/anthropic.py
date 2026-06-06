from __future__ import annotations

from typing import Any

from .common import (
    compact_mapping,
    make_async_wrapper,
    make_sync_wrapper,
    object_to_data,
    patch_method,
    value_at,
)


def instrument() -> None:
    try:
        from anthropic.resources.messages import AsyncMessages, Messages
    except ImportError:
        return

    patch_method(
        Messages,
        "create",
        lambda original: make_sync_wrapper(original, _messages_spec),
    )
    patch_method(
        AsyncMessages,
        "create",
        lambda original: make_async_wrapper(original, _messages_spec),
    )


def _messages_spec(_args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
    messages = _normalize_request_messages(
        object_to_data(kwargs.get("messages") or []),
        kwargs.get("system"),
    )
    return {
        "provider": "anthropic",
        "method": "anthropic.messages.create",
        "model": str(kwargs.get("model") or "unknown"),
        "request_messages": messages,
        "request_payload": compact_mapping(
            {
                "model": kwargs.get("model"),
                "system": kwargs.get("system"),
                "messages": object_to_data(kwargs.get("messages") or []),
                "tools": kwargs.get("tools"),
                "tool_choice": kwargs.get("tool_choice"),
                "stream": kwargs.get("stream"),
            }
        ),
        "output_message": _messages_output_message,
    }


def _normalize_request_messages(messages: Any, system: Any) -> list[Any]:
    normalized: list[Any] = []
    if system is not None:
        normalized.append({"role": "system", "content": object_to_data(system)})
    if not isinstance(messages, list):
        return normalized

    for message in messages:
        if not isinstance(message, dict):
            normalized.append(message)
            continue

        role = message.get("role")
        content = message.get("content")
        tool_results = _anthropic_tool_results(content)
        if tool_results:
            normalized.extend(tool_results)
            text_content = _anthropic_text_content(content)
            if text_content:
                normalized.append({"role": role, "content": text_content})
            continue

        normalized.append(message)
    return normalized


def _messages_output_message(response: Any) -> dict[str, Any] | None:
    content = object_to_data(value_at(response, "content"))
    if content is None:
        return None

    message: dict[str, Any] = {
        "role": "assistant",
        "content": _anthropic_text_content(content) or content,
    }
    tool_calls = _anthropic_tool_calls(content)
    if tool_calls:
        message["tool_calls"] = tool_calls
    return message


def _anthropic_text_content(content: Any) -> Any:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None

    text_parts: list[Any] = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text_parts.append(item.get("text"))
    if not text_parts:
        return None
    if len(text_parts) == 1:
        return text_parts[0]
    return text_parts


def _anthropic_tool_calls(content: Any) -> list[dict[str, Any]]:
    if not isinstance(content, list):
        return []

    calls: list[dict[str, Any]] = []
    for item in content:
        if not isinstance(item, dict) or item.get("type") != "tool_use":
            continue
        calls.append(
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "arguments": item.get("input"),
            }
        )
    return calls


def _anthropic_tool_results(content: Any) -> list[dict[str, Any]]:
    if not isinstance(content, list):
        return []

    results: list[dict[str, Any]] = []
    for item in content:
        if not isinstance(item, dict) or item.get("type") != "tool_result":
            continue
        results.append(
            {
                "role": "tool",
                "tool_call_id": item.get("tool_use_id"),
                "content": item.get("content"),
            }
        )
    return results

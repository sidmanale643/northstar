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
        from openai.resources.chat.completions import AsyncCompletions, Completions
        from openai.resources.responses import AsyncResponses, Responses
    except ImportError:
        return

    patch_method(
        Completions,
        "create",
        lambda original: make_sync_wrapper(original, _chat_completion_spec),
    )
    patch_method(
        AsyncCompletions,
        "create",
        lambda original: make_async_wrapper(original, _chat_completion_spec),
    )
    patch_method(
        Responses,
        "create",
        lambda original: make_sync_wrapper(original, _responses_spec),
    )
    patch_method(
        AsyncResponses,
        "create",
        lambda original: make_async_wrapper(original, _responses_spec),
    )


def _chat_completion_spec(args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
    messages = object_to_data(kwargs.get("messages") or [])
    provider, transport = _provider_from_resource(args[0] if args else None)
    return {
        "provider": provider,
        "transport": transport,
        "method": "openai.chat.completions.create",
        "model": str(kwargs.get("model") or "unknown"),
        "request_messages": messages if isinstance(messages, list) else [],
        "request_payload": compact_mapping(
            {
                "model": kwargs.get("model"),
                "messages": messages,
                "tools": kwargs.get("tools"),
                "tool_choice": kwargs.get("tool_choice"),
                "stream": kwargs.get("stream"),
            }
        ),
        "output_message": _chat_completion_output_message,
    }


def _responses_spec(args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
    input_value = object_to_data(kwargs.get("input"))
    request_messages = _responses_input_messages(input_value, kwargs.get("instructions"))
    provider, transport = _provider_from_resource(args[0] if args else None)
    return {
        "provider": provider,
        "transport": transport,
        "method": "openai.responses.create",
        "model": str(kwargs.get("model") or "unknown"),
        "request_messages": request_messages,
        "request_payload": compact_mapping(
            {
                "model": kwargs.get("model"),
                "instructions": kwargs.get("instructions"),
                "input": input_value,
                "tools": kwargs.get("tools"),
                "tool_choice": kwargs.get("tool_choice"),
                "stream": kwargs.get("stream"),
            }
        ),
        "output_message": _responses_output_message,
    }


def _provider_from_resource(resource: Any) -> tuple[str, str | None]:
    client = getattr(resource, "_client", None)
    base_url = getattr(client, "base_url", None) or getattr(client, "_base_url", None)
    if base_url is not None and "openrouter.ai" in str(base_url).lower():
        return "openrouter", "openai-compatible"
    return "openai", None


def _responses_input_messages(input_value: Any, instructions: Any) -> list[Any]:
    messages: list[Any] = []
    if instructions is not None:
        messages.append({"role": "system", "content": object_to_data(instructions)})
    if isinstance(input_value, list):
        messages.extend(input_value)
    elif input_value is not None:
        messages.append({"role": "user", "content": input_value})
    return messages


def _chat_completion_output_message(response: Any) -> dict[str, Any] | None:
    choices = value_at(response, "choices") or []
    if not choices:
        return None

    first = choices[0]
    message = value_at(first, "message")
    data = object_to_data(message)
    if isinstance(data, dict):
        data.setdefault("role", "assistant")
        return data
    return {"role": "assistant", "content": data}


def _responses_output_message(response: Any) -> dict[str, Any] | None:
    output_text = value_at(response, "output_text")
    if output_text is not None:
        return {"role": "assistant", "content": output_text}

    output = object_to_data(value_at(response, "output"))
    if output is None:
        return None

    tool_calls: list[dict[str, Any]] = []
    text_parts: list[Any] = []
    for item in output if isinstance(output, list) else [output]:
        if not isinstance(item, dict):
            text_parts.append(item)
            continue
        item_type = item.get("type")
        if item_type in {"function_call", "tool_call"}:
            tool_calls.append(
                {
                    "id": item.get("call_id") or item.get("id"),
                    "name": item.get("name"),
                    "arguments": item.get("arguments"),
                }
            )
            continue
        if "content" in item:
            text_parts.append(item["content"])

    message: dict[str, Any] = {"role": "assistant", "content": text_parts or output}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return message

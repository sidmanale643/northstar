from __future__ import annotations

import inspect
import time
from collections.abc import Callable, Mapping
from functools import wraps
from typing import Any

from pydantic import BaseModel

from .. import api


_PATCHED: dict[tuple[type, str], Callable[..., Any]] = {}


def patch_method(
    owner: type,
    name: str,
    wrapper_factory: Callable[[Callable[..., Any]], Callable[..., Any]],
) -> bool:
    key = (owner, name)
    if key in _PATCHED:
        return False

    original = getattr(owner, name, None)
    if original is None:
        return False

    _PATCHED[key] = original
    setattr(owner, name, wrapper_factory(original))
    return True


def object_to_data(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="python")
    if isinstance(value, Mapping):
        return {str(key): object_to_data(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [object_to_data(item) for item in value]
    if hasattr(value, "model_dump") and callable(value.model_dump):
        return value.model_dump(mode="python")
    if hasattr(value, "dict") and callable(value.dict):
        return value.dict()
    return value


def value_at(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(key, default)
    return getattr(value, key, default)


def compact_mapping(items: Mapping[str, Any]) -> dict[str, Any]:
    return {key: object_to_data(value) for key, value in items.items() if is_present(value)}


def is_present(value: Any) -> bool:
    if value is None:
        return False
    module_name = value.__class__.__module__
    if module_name.startswith("openai.") and value.__class__.__name__ in {
        "NotGiven",
        "Omit",
    }:
        return False
    return True


def usage_tokens(response: Any) -> tuple[int | None, int | None]:
    usage = value_at(response, "usage")
    if usage is None:
        return None, None

    prompt_tokens = value_at(usage, "prompt_tokens")
    completion_tokens = value_at(usage, "completion_tokens")
    if prompt_tokens is None:
        prompt_tokens = value_at(usage, "input_tokens")
    if completion_tokens is None:
        completion_tokens = value_at(usage, "output_tokens")

    if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
        return prompt_tokens, completion_tokens
    return None, None


def request_id(response: Any) -> str | None:
    value = value_at(response, "_request_id") or value_at(response, "request_id")
    if value is None:
        return None
    return str(value)


def with_llm_trace_sync(
    *,
    provider: str,
    method: str,
    model: str,
    request_messages: list[Any],
    request_payload: Mapping[str, Any],
    call: Callable[[], Any],
    output_message: Callable[[Any], Any | None],
    transport: str | None = None,
) -> Any:
    started = time.perf_counter()
    trace_metadata = compact_mapping({"provider": provider, "transport": transport})
    with api.trace(method, input=compact_mapping(request_payload), metadata=trace_metadata) as trace:
        with api.model_call(method, model=model) as span:
            if request_messages:
                span.record_input_messages(request_messages)
            _record_span_metadata(span, provider, method, request_payload, transport)
            response = call()
            _record_response(span, response, model, output_message, started)
            trace.set_output(_response_output(response))
            return response


async def with_llm_trace_async(
    *,
    provider: str,
    method: str,
    model: str,
    request_messages: list[Any],
    request_payload: Mapping[str, Any],
    call: Callable[[], Any],
    output_message: Callable[[Any], Any | None],
    transport: str | None = None,
) -> Any:
    started = time.perf_counter()
    trace_metadata = compact_mapping({"provider": provider, "transport": transport})
    with api.trace(method, input=compact_mapping(request_payload), metadata=trace_metadata) as trace:
        with api.model_call(method, model=model) as span:
            if request_messages:
                span.record_input_messages(request_messages)
            _record_span_metadata(span, provider, method, request_payload, transport)
            response = await call()
            _record_response(span, response, model, output_message, started)
            trace.set_output(_response_output(response))
            return response


def _record_span_metadata(
    span: Any,
    provider: str,
    method: str,
    request_payload: Mapping[str, Any],
    transport: str | None,
) -> None:
    inner = getattr(span, "_span", None)
    if inner is None:
        return
    inner.attributes.update(
        compact_mapping(
            {
                "provider": provider,
                "transport": transport,
                "method": method,
                "stream": request_payload.get("stream"),
                "tools": request_payload.get("tools"),
                "tool_choice": request_payload.get("tool_choice"),
            }
        )
    )


def _record_response(
    span: Any,
    response: Any,
    model: str,
    output_message: Callable[[Any], Any | None],
    started: float,
) -> None:
    inner = getattr(span, "_span", None)
    if inner is not None:
        inner.attributes["latency_ms"] = round((time.perf_counter() - started) * 1000, 3)
        response_request_id = request_id(response)
        if response_request_id is not None:
            inner.attributes["request_id"] = response_request_id

    message = output_message(response)
    if message is not None:
        span.record_output_message(message)

    prompt_tokens, completion_tokens = usage_tokens(response)
    if prompt_tokens is not None and completion_tokens is not None:
        span.record_usage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            source="provider",
        )


def _response_output(response: Any) -> Any:
    output_text = value_at(response, "output_text")
    if output_text is not None:
        return output_text
    return object_to_data(response)


def make_sync_wrapper(
    original: Callable[..., Any],
    build: Callable[[tuple[Any, ...], dict[str, Any]], dict[str, Any]],
) -> Callable[..., Any]:
    @wraps(original)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        spec = build(args, kwargs)
        return with_llm_trace_sync(
            provider=spec["provider"],
            method=spec["method"],
            model=spec["model"],
            request_messages=spec["request_messages"],
            request_payload=spec["request_payload"],
            call=lambda: original(*args, **kwargs),
            output_message=spec["output_message"],
            transport=spec.get("transport"),
        )

    return wrapper


def make_async_wrapper(
    original: Callable[..., Any],
    build: Callable[[tuple[Any, ...], dict[str, Any]], dict[str, Any]],
) -> Callable[..., Any]:
    @wraps(original)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        spec = build(args, kwargs)

        async def call() -> Any:
            result = original(*args, **kwargs)
            if inspect.isawaitable(result):
                return await result
            return result

        return await with_llm_trace_async(
            provider=spec["provider"],
            method=spec["method"],
            model=spec["model"],
            request_messages=spec["request_messages"],
            request_payload=spec["request_payload"],
            call=call,
            output_message=spec["output_message"],
            transport=spec.get("transport"),
        )

    return wrapper

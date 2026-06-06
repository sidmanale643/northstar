from __future__ import annotations

import json
from typing import Any

from northstar.models import Run

from .models import (
    EvalMetrics,
    EvalRun,
    EvalTrace,
    EvalTraceDag,
    EvalTraceEdge,
    EvalTraceEvent,
    EvalTraceSpan,
    ToolCall,
    ToolInteraction,
    ToolOutput,
)


def normalize_messages(
    messages: list[dict[str, Any]],
    *,
    trace: EvalTraceDag | None = None,
    metrics: EvalMetrics | None = None,
    metadata: dict[str, Any] | None = None,
) -> EvalRun:
    system_prompts: list[str] = []
    user_messages: list[str] = []
    assistant_messages: list[str] = []
    tool_calls: list[ToolCall] = []
    tool_outputs: list[ToolOutput] = []
    final_response: str | None = None

    for message in messages:
        role = message.get("role")
        content_text = _content_to_text(message.get("content"))

        if role == "system" and content_text is not None:
            system_prompts.append(content_text)
        elif role == "user" and content_text is not None:
            user_messages.append(content_text)
        elif role == "assistant":
            for tool_call in _extract_tool_calls(message):
                tool_calls.append(tool_call)
            if content_text:
                assistant_messages.append(content_text)
                final_response = content_text
        elif role == "tool":
            tool_outputs.append(
                ToolOutput(
                    tool_call_id=_optional_str(message.get("tool_call_id")),
                    name=_optional_str(message.get("name")),
                    content=message.get("content"),
                )
            )

    return EvalRun(
        messages=messages,
        system_prompts=system_prompts,
        user_messages=user_messages,
        assistant_messages=assistant_messages,
        final_response=final_response,
        tool_calls=tool_calls,
        tool_outputs=tool_outputs,
        tool_interactions=_pair_tool_interactions(tool_calls, tool_outputs),
        trace=trace,
        metrics=metrics or EvalMetrics(),
        metadata=metadata or {},
    )


def normalize_trace_payload(payload: dict[str, Any], run_id: str) -> EvalTraceDag:
    run = Run.from_payload(payload, run_id=run_id)
    trace = EvalTrace(
        run_id=str(run.id),
        name=run.name,
        status=str(run.status),
        started_at=_optional_iso(run.started_at),
        ended_at=_optional_iso(run.ended_at),
        error=run.error,
        metadata=run.metadata,
    )

    spans = [
        EvalTraceSpan(
            id=str(span.id),
            run_id=str(span.run_id),
            parent_span_id=str(span.parent_span_id) if span.parent_span_id else None,
            kind=str(span.kind),
            name=span.name,
            started_at=_optional_iso(span.started_at),
            ended_at=_optional_iso(span.ended_at),
            status=str(span.status),
            error=span.error,
            iteration=span.iteration,
            attributes=span.attributes,
        )
        for span in run._spans
    ]
    events = [
        EvalTraceEvent(
            id=str(event.id),
            run_id=str(event.run_id),
            span_id=str(event.span_id) if event.span_id else None,
            type=str(event.type),
            created_at=_optional_iso(event.created_at),
            content=event.content,
            attributes=event.attributes,
            order=index,
        )
        for index, event in enumerate(run.events())
    ]

    edges: list[EvalTraceEdge] = []
    span_ids = {span.id for span in spans}
    for span in spans:
        if span.parent_span_id and span.parent_span_id in span_ids:
            edges.append(
                EvalTraceEdge(
                    source_id=span.parent_span_id,
                    target_id=span.id,
                    kind="parent_child",
                )
            )
    for event in events:
        if event.span_id and event.span_id in span_ids:
            edges.append(
                EvalTraceEdge(
                    source_id=event.span_id,
                    target_id=event.id,
                    kind="span_event",
                )
            )
    for previous, current in zip(events, events[1:], strict=False):
        edges.append(
            EvalTraceEdge(
                source_id=previous.id,
                target_id=current.id,
                kind="next_event",
            )
        )

    return EvalTraceDag(run=trace, spans=spans, events=events, edges=edges)


def _extract_tool_calls(message: dict[str, Any]) -> list[ToolCall]:
    calls: list[ToolCall] = []

    for raw_tool_call in message.get("tool_calls") or []:
        if not isinstance(raw_tool_call, dict):
            continue
        function = raw_tool_call.get("function")
        if not isinstance(function, dict):
            function = {}
        name = function.get("name") or raw_tool_call.get("name")
        arguments = function.get("arguments", raw_tool_call.get("arguments"))
        calls.append(
            ToolCall(
                id=_optional_str(raw_tool_call.get("id")),
                name=str(name or "unknown_tool"),
                arguments=arguments,
            )
        )

    function_call = message.get("function_call")
    if isinstance(function_call, dict):
        name = function_call.get("name")
        calls.append(
            ToolCall(
                name=str(name or "unknown_tool"),
                arguments=function_call.get("arguments"),
            )
        )

    return calls


def _pair_tool_interactions(
    tool_calls: list[ToolCall],
    tool_outputs: list[ToolOutput],
) -> list[ToolInteraction]:
    outputs_by_id = {
        output.tool_call_id: output
        for output in tool_outputs
        if output.tool_call_id is not None
    }
    return [
        ToolInteraction(
            call=tool_call,
            output=outputs_by_id.get(tool_call.id) if tool_call.id else None,
        )
        for tool_call in tool_calls
    ]


def _content_to_text(content: Any) -> str | None:
    if content is None:
        return None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [_content_to_text(part) for part in content]
        text_parts = [part for part in parts if part]
        return "\n".join(text_parts) if text_parts else None
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
        nested_content = content.get("content")
        if nested_content is not None:
            return _content_to_text(nested_content)
        return json.dumps(content, sort_keys=True)
    return str(content)


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _optional_iso(value: Any) -> str | None:
    if value is None:
        return None
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return str(isoformat())
    return str(value)

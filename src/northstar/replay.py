from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from .models import Event, EventType, Run, Session, Span, SpanKind


@dataclass
class ReplayStep:
    index: int
    event_type: str
    content: Any
    recorded_at: datetime
    span_id: UUID | None = None
    span_name: str | None = None
    span_kind: SpanKind | None = None
    is_tool_call: bool = False
    is_tool_result: bool = False
    _tools: dict[str, Callable[..., Any]] = field(default_factory=dict, repr=False)

    def invoke(self, *, tools: Mapping[str, Callable[..., Any]] | None = None) -> Any:
        if not self.is_tool_call:
            raise TypeError("only tool call steps can be invoked")
        if self.span_name is None:
            raise TypeError("tool call steps must have a span name")
        registry = tools if tools is not None else self._tools
        if self.span_name not in registry:
            raise KeyError(
                f"tool '{self.span_name}' is not registered; "
                "pass tools={...} to Run.replay() or invoke()",
            )
        func = registry[self.span_name]
        if not callable(func):
            raise TypeError(f"registered tool '{self.span_name}' is not callable")
        args, kwargs = _split_tool_arguments(self.content)
        return func(*args, **kwargs)


@dataclass
class ReplayDiff:
    index: int
    span_name: str
    recorded: Any
    replayed: Any

    def matches(self) -> bool:
        return self.recorded == self.replayed


@dataclass
class Replay:
    run: Run
    tools: dict[str, Callable[..., Any]] = field(default_factory=dict)
    _steps: list[ReplayStep] = field(default_factory=list, init=False)

    def __post_init__(self) -> None:
        self._steps = list(_build_steps(self.run, self.tools))

    def __iter__(self) -> Iterator[ReplayStep]:
        return iter(self._steps)

    def __len__(self) -> int:
        return len(self._steps)

    def __bool__(self) -> bool:
        return bool(self._steps)

    def steps(self) -> list[ReplayStep]:
        return list(self._steps)

    def tool_calls(self) -> list[ReplayStep]:
        return [step for step in self._steps if step.is_tool_call]

    def tool_results(self) -> list[ReplayStep]:
        return [step for step in self._steps if step.is_tool_result]

    def replay(self) -> list[Any]:
        calls = self.tool_calls()
        if not calls:
            return []
        if not self.tools:
            raise ValueError(
                "a tool registry is required to replay tool calls; "
                "pass tools={...} to Run.replay() or Replay",
            )
        return [step.invoke() for step in calls]

    async def areplay(self) -> list[Any]:
        import inspect

        calls = self.tool_calls()
        if not calls:
            return []
        if not self.tools:
            raise ValueError(
                "a tool registry is required to replay tool calls; "
                "pass tools={...} to Run.replay() or Replay",
            )
        results: list[Any] = []
        for step in calls:
            if step.span_name is None:
                continue
            func = self.tools[step.span_name]
            args, kwargs = _split_tool_arguments(step.content)
            if inspect.iscoroutinefunction(func):
                results.append(await func(*args, **kwargs))
            else:
                results.append(func(*args, **kwargs))
        return results

    def diff(self, replayed: Iterable[Any]) -> list[ReplayDiff]:
        calls = self.tool_calls()
        results = self.tool_results()
        replayed_list = list(replayed)
        diffs: list[ReplayDiff] = []
        for index, (call, recorded, new) in enumerate(
            zip(calls, results, replayed_list, strict=False),
        ):
            diffs.append(
                ReplayDiff(
                    index=index,
                    span_name=call.span_name or "",
                    recorded=recorded.content,
                    replayed=new,
                ),
            )
        return diffs


def _split_tool_arguments(content: Any) -> tuple[list[Any], dict[str, Any]]:
    if not isinstance(content, Mapping):
        return [], {}
    args = content.get("args", [])
    kwargs = content.get("kwargs", {})
    if not isinstance(args, list):
        args = list(args) if args is not None else []
    if not isinstance(kwargs, dict):
        kwargs = dict(kwargs) if kwargs is not None else {}
    return list(args), dict(kwargs)


def _build_steps(
    run: Run,
    tools: dict[str, Callable[..., Any]] | None,
) -> Iterator[ReplayStep]:
    spans_by_id: dict[UUID, Span] = {span.id: span for span in run._spans}
    events = sorted(run.events(), key=lambda event: event.created_at)
    bound_tools = dict(tools) if tools else {}
    for index, event in enumerate(events):
        span = spans_by_id.get(event.span_id) if event.span_id else None
        is_tool_call = (
            span is not None
            and span.kind == SpanKind.TOOL
            and event.type == EventType.TOOL_ARGUMENTS
        )
        is_tool_result = (
            span is not None
            and span.kind == SpanKind.TOOL
            and event.type == EventType.TOOL_RESULT
        )
        yield ReplayStep(
            index=index,
            event_type=event.type.value,
            content=event.content,
            recorded_at=event.created_at,
            span_id=event.span_id,
            span_name=span.name if span is not None else None,
            span_kind=span.kind if span is not None else None,
            is_tool_call=is_tool_call,
            is_tool_result=is_tool_result,
            _tools=bound_tools,
        )


def _reconstruct_run(
    payload: dict[str, Any],
    run_id: str | UUID,
    *,
    session: Session | None = None,
) -> Run:
    target_id = str(run_id)
    runs = payload.get("runs", [])
    spans = payload.get("spans", [])
    events = payload.get("events", [])
    sessions = payload.get("sessions", [])

    run_data = next((item for item in runs if item.get("id") == target_id), None)
    if run_data is None:
        raise KeyError(f"run '{run_id}' was not found in the payload")

    resolved_session = session
    if resolved_session is None:
        session_id = run_data.get("session_id")
        session_data = next(
            (item for item in sessions if item.get("id") == session_id),
            None,
        )
        if session_data is None:
            raise KeyError(
                f"session '{session_id}' for run '{run_id}' was not found in the payload",
            )
        resolved_session = Session.model_validate(session_data)

    run = Run.model_validate(run_data)
    run._session = resolved_session

    spans_by_id: dict[UUID, Span] = {}
    for span_data in spans:
        if span_data.get("run_id") != target_id:
            continue
        span = Span.model_validate(span_data)
        span._run = run
        run._spans.append(span)
        spans_by_id[span.id] = span

    for event_data in events:
        if event_data.get("run_id") != target_id:
            continue
        event = Event.model_validate(event_data)
        run._events.append(event)
        span_id = event.span_id
        if span_id is not None and span_id in spans_by_id:
            span = spans_by_id[span_id]
            if span._run is None:
                span._run = run

    run._events.sort(key=lambda event: event.created_at)
    run._spans.sort(key=lambda span: span.started_at)
    return run

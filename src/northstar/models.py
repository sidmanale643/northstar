from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from enum import StrEnum
from functools import wraps
from typing import TYPE_CHECKING, Any, ParamSpec, TypeVar
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

if TYPE_CHECKING:
    from .client import Northstar

P = ParamSpec("P")
R = TypeVar("R")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def exception_to_error(exc: BaseException) -> dict[str, Any]:
    return {
        "type": exc.__class__.__name__,
        "message": str(exc),
        "module": exc.__class__.__module__,
    }


class NorthstarModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True)


class RunStatus(StrEnum):
    RUNNING = "running"
    OK = "ok"
    ERROR = "error"


class SpanKind(StrEnum):
    AGENT = "agent"
    WORKFLOW = "workflow"
    MODEL = "model"
    TOOL = "tool"
    CUSTOM = "custom"


class EventType(StrEnum):
    USER_INPUT = "user_input"
    SYSTEM_MESSAGE = "system_message"
    ASSISTANT_MESSAGE = "assistant_message"
    REASONING = "reasoning"
    TOOL_ARGUMENTS = "tool_arguments"
    TOOL_RESULT = "tool_result"
    FINAL_RESPONSE = "final_response"
    CUSTOM = "custom"


def should_capture(capture: CaptureOptions, event_type: EventType) -> bool:
    if event_type == EventType.USER_INPUT:
        return capture.user_input
    if event_type == EventType.SYSTEM_MESSAGE:
        return capture.system_messages
    if event_type == EventType.REASONING:
        return capture.reasoning
    if event_type == EventType.TOOL_ARGUMENTS:
        return capture.tool_arguments
    if event_type == EventType.TOOL_RESULT:
        return capture.tool_results
    if event_type == EventType.FINAL_RESPONSE:
        return capture.final_response
    return True


class CaptureOptions(NorthstarModel):
    user_input: bool = False
    system_messages: bool = False
    reasoning: bool = False
    tool_arguments: bool = False
    tool_results: bool = False
    final_response: bool = False


class Session(NorthstarModel):
    id: UUID = Field(default_factory=uuid4)
    project_id: UUID | None = Field(
        default=None,
        description="Assigned by the backend during authenticated ingestion.",
    )
    created_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    _client: Northstar | None = PrivateAttr(default=None)

    def __enter__(self) -> Session:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        _traceback: object,
    ) -> bool:
        del exc_type

        self.ended_at = utc_now()
        client = self._require_client()
        client._enqueue_session(self)

        if exc is None:
            client.flush()
            return False

        try:
            client.flush()
        except Exception as flush_exc:
            exc.add_note(f"Northstar flush failed: {flush_exc}")
        return False

    def run(self, name: str, metadata: dict[str, Any] | None = None) -> Run:
        run = Run(
            session_id=self.id,
            name=name,
            metadata=metadata or {},
        )
        run._client = self._require_client()
        run._session = self
        run._client._enqueue_run(run)
        return run

    def _require_client(self) -> Northstar:
        if self._client is None:
            raise RuntimeError("Session must be created by Northstar.session()")
        return self._client


class Run(NorthstarModel):
    id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    name: str
    started_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = None
    status: RunStatus = RunStatus.RUNNING
    error: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    _client: Northstar | None = PrivateAttr(default=None)
    _session: Session | None = PrivateAttr(default=None)
    _active_spans: list[Span] = PrivateAttr(default_factory=list)

    def __enter__(self) -> Run:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        _traceback: object,
    ) -> bool:
        del exc_type

        self.ended_at = utc_now()
        if exc is None:
            self.status = RunStatus.OK
            self.error = None
        else:
            self.status = RunStatus.ERROR
            self.error = exception_to_error(exc)

        self._require_client()._enqueue_run(self)
        return False

    def span(
        self,
        name: str,
        *,
        kind: SpanKind,
        iteration: int | None = None,
        attributes: dict[str, Any] | None = None,
    ) -> Span:
        parent_span_id = self._active_spans[-1].id if self._active_spans else None
        return self._build_span(
            name=name,
            kind=kind,
            parent_span_id=parent_span_id,
            iteration=iteration,
            attributes=attributes,
        )

    def trace_tool(
        self,
        name: str | None = None,
        *,
        iteration: int | None = None,
        attributes: dict[str, Any] | None = None,
    ) -> Callable[[Callable[P, R] | Callable[P, Awaitable[R]]], Callable[P, R] | Callable[P, Awaitable[R]]]:
        def decorator(
            func: Callable[P, R] | Callable[P, Awaitable[R]],
        ) -> Callable[P, R] | Callable[P, Awaitable[R]]:
            tool_name = name or func.__name__

            if inspect.iscoroutinefunction(func):

                @wraps(func)
                async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
                    with self.span(
                        tool_name,
                        kind=SpanKind.TOOL,
                        iteration=iteration,
                        attributes=attributes,
                    ) as span:
                        span.record_tool_arguments(
                            {"args": list(args), "kwargs": kwargs},
                        )
                        result = await func(*args, **kwargs)
                        span.record_tool_result(result)
                        return result

                return async_wrapper

            @wraps(func)
            def sync_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
                with self.span(
                    tool_name,
                    kind=SpanKind.TOOL,
                    iteration=iteration,
                    attributes=attributes,
                ) as span:
                    span.record_tool_arguments(
                        {"args": list(args), "kwargs": kwargs},
                    )
                    result = func(*args, **kwargs)
                    span.record_tool_result(result)
                    return result

            return sync_wrapper

        return decorator

    def record_user_input(
        self,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event | None:
        return self._record_event(
            EventType.USER_INPUT,
            content,
            attributes=attributes,
        )

    def record_system_message(
        self,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event | None:
        return self._record_event(
            EventType.SYSTEM_MESSAGE,
            content,
            attributes=attributes,
        )

    def record_final_response(
        self,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event | None:
        return self._record_event(
            EventType.FINAL_RESPONSE,
            content,
            attributes=attributes,
        )

    def record_custom_event(
        self,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event:
        return self._record_event(
            EventType.CUSTOM,
            content,
            attributes=attributes,
        )

    def _build_span(
        self,
        *,
        name: str,
        kind: SpanKind,
        parent_span_id: UUID | None,
        iteration: int | None,
        attributes: dict[str, Any] | None,
    ) -> Span:
        span = Span(
            run_id=self.id,
            parent_span_id=parent_span_id,
            kind=kind,
            name=name,
            iteration=iteration,
            attributes=attributes or {},
        )
        span._client = self._require_client()
        span._run = self
        span._client._enqueue_span(span)
        return span

    def _record_event(
        self,
        event_type: EventType,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
        span_id: UUID | None = None,
    ) -> Event | None:
        client = self._require_client()
        if not should_capture(client.capture, event_type):
            return None

        event = Event(
            run_id=self.id,
            span_id=span_id,
            type=event_type,
            content=content,
            attributes=attributes or {},
        )
        client._enqueue_event(event)
        return event

    def _push_span(self, span: Span) -> None:
        self._active_spans.append(span)

    def _pop_span(self, span: Span) -> None:
        if self._active_spans and self._active_spans[-1] is span:
            self._active_spans.pop()
            return

        if span in self._active_spans:
            self._active_spans.remove(span)

    def _require_client(self) -> Northstar:
        if self._client is None:
            raise RuntimeError("Run must be created by Session.run()")
        return self._client


class Span(NorthstarModel):
    id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    parent_span_id: UUID | None = None
    kind: SpanKind
    name: str
    started_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = None
    status: RunStatus = RunStatus.RUNNING
    error: dict[str, Any] | None = None
    iteration: int | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    _client: Northstar | None = PrivateAttr(default=None)
    _run: Run | None = PrivateAttr(default=None)

    def __enter__(self) -> Span:
        self._require_run()._push_span(self)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        _traceback: object,
    ) -> bool:
        del exc_type

        self._require_run()._pop_span(self)
        self.ended_at = utc_now()
        if exc is None:
            self.status = RunStatus.OK
            self.error = None
        else:
            self.status = RunStatus.ERROR
            self.error = exception_to_error(exc)

        self._require_client()._enqueue_span(self)
        return False

    def span(
        self,
        name: str,
        *,
        kind: SpanKind,
        iteration: int | None = None,
        attributes: dict[str, Any] | None = None,
    ) -> Span:
        return self._require_run()._build_span(
            name=name,
            kind=kind,
            parent_span_id=self.id,
            iteration=iteration,
            attributes=attributes,
        )

    def record_reasoning(
        self,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event | None:
        return self._record_event(
            EventType.REASONING,
            content,
            attributes=attributes,
        )

    def record_tool_arguments(
        self,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event | None:
        return self._record_event(
            EventType.TOOL_ARGUMENTS,
            content,
            attributes=attributes,
        )

    def record_tool_result(
        self,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event | None:
        return self._record_event(
            EventType.TOOL_RESULT,
            content,
            attributes=attributes,
        )

    def record_custom_event(
        self,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event:
        return self._record_event(
            EventType.CUSTOM,
            content,
            attributes=attributes,
        )

    def _record_event(
        self,
        event_type: EventType,
        content: Any,
        *,
        attributes: dict[str, Any] | None = None,
    ) -> Event | None:
        return self._require_run()._record_event(
            event_type,
            content,
            attributes=attributes,
            span_id=self.id,
        )

    def _require_client(self) -> Northstar:
        if self._client is None:
            raise RuntimeError("Span must be created by Run.span()")
        return self._client

    def _require_run(self) -> Run:
        if self._run is None:
            raise RuntimeError("Span must be created by Run.span()")
        return self._run


class Event(NorthstarModel):
    id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    span_id: UUID | None = None
    type: EventType
    created_at: datetime = Field(default_factory=utc_now)
    content: Any
    attributes: dict[str, Any] = Field(default_factory=dict)

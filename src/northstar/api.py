from __future__ import annotations

import atexit
import inspect
import json
import os
import sys
import threading
from collections.abc import Callable, Iterable, Mapping
from contextvars import ContextVar, Token
from dataclasses import asdict, is_dataclass
from functools import wraps
from numbers import Real
from typing import Any, ParamSpec, TypeVar
from uuid import UUID

from pydantic import BaseModel

from .client import Northstar
from .models import CaptureOptions, Run, Session, Span, SpanKind, utc_now

P = ParamSpec("P")
R = TypeVar("R")

_UNSET = object()
_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_FALSE_VALUES = frozenset({"0", "false", "no", "off"})
_DEFAULT_REDACT_KEYS = frozenset(
    {
        "api_key",
        "authorization",
        "cookie",
        "password",
        "secret",
        "token",
    }
)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    raise ValueError(f"{name} must be a boolean")


def _redact(value: Any, redact_keys: frozenset[str]) -> Any:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="python")
    elif is_dataclass(value) and not isinstance(value, type):
        value = asdict(value)

    if isinstance(value, Mapping):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            string_key = str(key)
            if string_key.lower() in redact_keys:
                redacted[string_key] = "[REDACTED]"
            else:
                redacted[string_key] = _redact(item, redact_keys)
        return redacted
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_redact(item, redact_keys) for item in value]
    return value


def _json_safe(value: Any, redact_keys: frozenset[str]) -> Any:
    return json.loads(json.dumps(_redact(value, redact_keys), default=repr))


def _function_arguments(
    func: Callable[..., Any],
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> dict[str, Any]:
    try:
        return dict(inspect.signature(func).bind_partial(*args, **kwargs).arguments)
    except (TypeError, ValueError):
        return {"args": list(args), "kwargs": kwargs}


def _validate_metric_value(value: Any) -> None:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError("metric value must be numeric")


class _NoopTrace:
    id: None = None

    def set_output(self, _output: Any) -> None:
        return None

    def log_event(self, name: str, data: Any = None) -> None:
        del name, data

    def log_metric(self, name: str, value: Real) -> None:
        del name
        _validate_metric_value(value)

    def log_metadata(self, metadata: Mapping[str, Any]) -> None:
        del metadata


class _NoopSpan:
    id: None = None

    def __enter__(self) -> _NoopSpan:
        return self

    def __exit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc: BaseException | None,
        _traceback: object,
    ) -> bool:
        return False

    def log_event(self, name: str, data: Any = None) -> None:
        del name, data


class _TraceHandle:
    def __init__(
        self,
        state: _SDKState,
        session: Session,
        run: Run,
        *,
        capture_input: bool,
        capture_output: bool,
    ) -> None:
        self._state = state
        self._session = session
        self._run = run
        self._capture_input = capture_input
        self._capture_output = capture_output
        self._trace_token: Token[_TraceHandle | None] | None = None
        self._span_token: Token[_SpanHandle | None] | None = None
        self._finished = False

    @property
    def id(self) -> UUID:
        return self._run.id

    def set_output(self, output: Any) -> None:
        if self._capture_output:
            self._state.record_run_output(self, output)

    def log_event(self, name: str, data: Any = None) -> None:
        self._state.log_event(name, data)

    def log_metric(self, name: str, value: Real) -> None:
        self._state.log_metric(name, value)

    def log_metadata(self, metadata: Mapping[str, Any]) -> None:
        self._state.log_metadata(metadata)


class _SpanHandle:
    def __init__(self, state: _SDKState, span: Span) -> None:
        self._state = state
        self._span = span
        self._span_token: Token[_SpanHandle | None] | None = None
        self._finished = False

    @property
    def id(self) -> UUID:
        return self._span.id

    def __enter__(self) -> _SpanHandle:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object,
    ) -> bool:
        return self._state.finish_span(self, exc_type, exc, traceback)

    def log_event(self, name: str, data: Any = None) -> None:
        self._state.log_event(name, data)


_current_trace: ContextVar[_TraceHandle | None] = ContextVar(
    "northstar_current_trace",
    default=None,
)
_current_span: ContextVar[_SpanHandle | None] = ContextVar(
    "northstar_current_span",
    default=None,
)


class _SDKState:
    def __init__(
        self,
        client: Northstar | None = None,
        *,
        project: str | None = None,
        environment: str | None = None,
        capture_inputs: bool = True,
        capture_outputs: bool = True,
        redact_keys: Iterable[str] = _DEFAULT_REDACT_KEYS,
        batch_size: int = 50,
        flush_interval: float = 5.0,
        max_queue_size: int = 1000,
        debug: bool = False,
    ) -> None:
        self.client = client
        self.project = project
        self.environment = environment
        self.capture_inputs = capture_inputs
        self.capture_outputs = capture_outputs
        self.redact_keys = frozenset(key.lower() for key in redact_keys)
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.max_queue_size = max_queue_size
        self.debug = debug
        self._lock = threading.RLock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._worker: threading.Thread | None = None

        if self.client is not None:
            self._worker = threading.Thread(
                target=self._run_worker,
                name="northstar-flush",
                daemon=True,
            )
            self._worker.start()

    def _warn(self, message: str) -> None:
        if self.debug:
            print(f"[NorthStar] {message}", file=sys.stderr)

    def _pending_count(self) -> int:
        if self.client is None:
            return 0
        return sum(
            len(records)
            for records in (
                self.client._pending_sessions,
                self.client._pending_runs,
                self.client._pending_spans,
                self.client._pending_events,
            )
        )

    def _has_capacity(self, required_records: int = 1) -> bool:
        if self._pending_count() + required_records <= self.max_queue_size:
            return True
        self._warn("queue is full; dropping trace data")
        return False

    def _schedule_flush(self) -> None:
        if self._stop.is_set():
            self._flush_now()
            return
        if self._pending_count() >= self.batch_size:
            self._wake.set()

    def _run_worker(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(self.flush_interval)
            self._wake.clear()
            if self._stop.is_set():
                break
            self._flush_now()

    def _flush_now(self, timeout: float | None = None) -> bool:
        if self.client is None:
            return True

        with self._lock:
            previous_timeout = self.client._timeout_seconds
            if timeout is not None:
                self.client._timeout_seconds = timeout
            try:
                payload = self.client.flush()
            except Exception as exc:
                self._warn(f"flush failed: {exc}")
                return False
            finally:
                self.client._timeout_seconds = previous_timeout

        count = sum(
            len(payload[key]) for key in ("sessions", "runs", "spans", "events")
        )
        if count:
            self._warn(f"sent {count} records")
        return True

    def flush(self, timeout: float | None = None) -> bool:
        if timeout is not None and timeout <= 0:
            raise ValueError("timeout must be greater than zero")
        return self._flush_now(timeout)

    def shutdown(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._worker is not None and self._worker is not threading.current_thread():
            self._worker.join(timeout=self.flush_interval + 1)
        self._flush_now()

    def start_trace(
        self,
        name: str,
        *,
        input_value: Any = None,
        has_input: bool = False,
        metadata: Mapping[str, Any] | None = None,
        tags: Iterable[str] | None = None,
        capture_input: bool | None = None,
        capture_output: bool | None = None,
    ) -> _TraceHandle | _NoopTrace:
        if self.client is None:
            return _NoopTrace()

        with self._lock:
            if not self._has_capacity(required_records=2):
                return _NoopTrace()

            run_metadata: dict[str, Any] = {}
            if self.project is not None:
                run_metadata["project"] = self.project
            if self.environment is not None:
                run_metadata["environment"] = self.environment
            if metadata:
                run_metadata.update(metadata)
            if tags:
                run_metadata["tags"] = list(tags)

            handle: _TraceHandle | None = None
            try:
                session = self.client.session()
                run = session.run(
                    name,
                    metadata=_json_safe(run_metadata, self.redact_keys),
                )
                handle = _TraceHandle(
                    self,
                    session,
                    run,
                    capture_input=(
                        self.capture_inputs
                        if capture_input is None
                        else capture_input
                    ),
                    capture_output=(
                        self.capture_outputs
                        if capture_output is None
                        else capture_output
                    ),
                )
                handle._trace_token = _current_trace.set(handle)
                handle._span_token = _current_span.set(None)
                if has_input and handle._capture_input:
                    run.record_user_input(
                        _json_safe(input_value, self.redact_keys),
                    )
                self._schedule_flush()
                self._warn(f"trace created: {run.id}")
                return handle
            except Exception as exc:
                if handle is not None:
                    if handle._span_token is not None:
                        _current_span.reset(handle._span_token)
                    if handle._trace_token is not None:
                        _current_trace.reset(handle._trace_token)
                self._warn(f"failed to start trace: {exc}")
                return _NoopTrace()

    def finish_trace(
        self,
        trace: _TraceHandle | _NoopTrace,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object,
    ) -> bool:
        if not isinstance(trace, _TraceHandle) or trace._finished:
            return False
        trace._finished = True

        if trace._span_token is not None:
            _current_span.reset(trace._span_token)
        if trace._trace_token is not None:
            _current_trace.reset(trace._trace_token)

        with self._lock:
            try:
                trace._run.__exit__(exc_type, exc, traceback)
                trace._run.metadata["latency_ms"] = _latency_ms(
                    trace._run.started_at,
                    trace._run.ended_at,
                )
                if trace._run.error is not None:
                    trace._run.error = _json_safe(
                        trace._run.error,
                        self.redact_keys,
                    )
                self.client._enqueue_run(trace._run)
                trace._session.ended_at = utc_now()
                self.client._enqueue_session(trace._session)
                self._schedule_flush()
            except Exception as finish_exc:
                self._warn(f"failed to finish trace: {finish_exc}")
        return False

    def record_run_output(self, trace: _TraceHandle, output: Any) -> None:
        with self._lock:
            if not self._has_capacity():
                return
            try:
                trace._run.record_final_response(
                    _json_safe(output, self.redact_keys),
                )
                self._schedule_flush()
            except Exception as exc:
                self._warn(f"failed to capture trace output: {exc}")

    def start_span(
        self,
        name: str,
        *,
        kind: SpanKind = SpanKind.CUSTOM,
        iteration: int | None = None,
        attributes: Mapping[str, Any] | None = None,
    ) -> _SpanHandle | _NoopSpan:
        trace = _current_trace.get()
        if trace is None or self.client is None:
            return _NoopSpan()

        with self._lock:
            if not self._has_capacity():
                return _NoopSpan()
            handle: _SpanHandle | None = None
            try:
                current_span = _current_span.get()
                safe_attributes = _json_safe(attributes or {}, self.redact_keys)
                if current_span is None:
                    span = trace._run._build_span(
                        name=name,
                        kind=kind,
                        parent_span_id=None,
                        iteration=iteration,
                        attributes=safe_attributes,
                    )
                else:
                    span = current_span._span.span(
                        name,
                        kind=kind,
                        iteration=iteration,
                        attributes=safe_attributes,
                    )
                span.__enter__()
                handle = _SpanHandle(self, span)
                handle._span_token = _current_span.set(handle)
                self._schedule_flush()
                return handle
            except Exception as exc:
                if handle is not None and handle._span_token is not None:
                    _current_span.reset(handle._span_token)
                self._warn(f"failed to start span: {exc}")
                return _NoopSpan()

    def finish_span(
        self,
        span: _SpanHandle,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object,
    ) -> bool:
        if span._finished:
            return False
        span._finished = True

        if span._span_token is not None:
            _current_span.reset(span._span_token)

        with self._lock:
            try:
                span._span.__exit__(exc_type, exc, traceback)
                span._span.attributes["latency_ms"] = _latency_ms(
                    span._span.started_at,
                    span._span.ended_at,
                )
                if span._span.error is not None:
                    span._span.error = _json_safe(
                        span._span.error,
                        self.redact_keys,
                    )
                self.client._enqueue_span(span._span)
                self._schedule_flush()
            except Exception as finish_exc:
                self._warn(f"failed to finish span: {finish_exc}")
        return False

    def record_span_input(self, span: _SpanHandle, input_value: Any) -> None:
        with self._lock:
            if not self.capture_inputs or not self._has_capacity():
                return
            try:
                span._span.record_tool_arguments(
                    _json_safe(input_value, self.redact_keys),
                )
                self._schedule_flush()
            except Exception as exc:
                self._warn(f"failed to capture span input: {exc}")

    def record_span_output(self, span: _SpanHandle, output: Any) -> None:
        with self._lock:
            if not self.capture_outputs or not self._has_capacity():
                return
            try:
                span._span.record_tool_result(
                    _json_safe(output, self.redact_keys),
                )
                self._schedule_flush()
            except Exception as exc:
                self._warn(f"failed to capture span output: {exc}")

    def log_event(self, name: str, data: Any = None) -> None:
        trace = _current_trace.get()
        if trace is None or self.client is None:
            return

        with self._lock:
            if not self._has_capacity():
                return
            try:
                target: Run | Span = trace._run
                current_span = _current_span.get()
                if current_span is not None:
                    target = current_span._span
                target.record_custom_event(
                    _json_safe(
                        {"name": name, "data": data},
                        self.redact_keys,
                    ),
                    attributes={"northstar_type": "event"},
                )
                self._schedule_flush()
            except Exception as exc:
                self._warn(f"failed to log event: {exc}")

    def log_metric(self, name: str, value: Real) -> None:
        _validate_metric_value(value)
        trace = _current_trace.get()
        if trace is None or self.client is None:
            return

        with self._lock:
            if not self._has_capacity():
                return
            try:
                target: Run | Span = trace._run
                current_span = _current_span.get()
                if current_span is not None:
                    target = current_span._span
                target.record_custom_event(
                    {"name": name, "value": value},
                    attributes={"northstar_type": "metric"},
                )
                self._schedule_flush()
            except Exception as exc:
                self._warn(f"failed to log metric: {exc}")

    def log_metadata(self, metadata: Mapping[str, Any]) -> None:
        trace = _current_trace.get()
        if trace is None or self.client is None:
            return

        with self._lock:
            try:
                safe_metadata = _json_safe(metadata, self.redact_keys)
                current_span = _current_span.get()
                if current_span is not None:
                    current_span._span.attributes.update(safe_metadata)
                    self.client._enqueue_span(current_span._span)
                else:
                    trace._run.metadata.update(safe_metadata)
                    self.client._enqueue_run(trace._run)
                self._schedule_flush()
            except Exception as exc:
                self._warn(f"failed to log metadata: {exc}")


def _latency_ms(started_at: Any, ended_at: Any) -> float:
    if ended_at is None:
        return 0.0
    return round((ended_at - started_at).total_seconds() * 1000, 3)


_state = _SDKState()
_state_lock = threading.Lock()


def _active_state() -> _SDKState:
    trace_handle = _current_trace.get()
    return trace_handle._state if trace_handle is not None else _state


def _finish_trace(
    trace_handle: _TraceHandle | _NoopTrace,
    exc_type: type[BaseException] | None,
    exc: BaseException | None,
    traceback: object,
) -> bool:
    if isinstance(trace_handle, _TraceHandle):
        return trace_handle._state.finish_trace(
            trace_handle,
            exc_type,
            exc,
            traceback,
        )
    return False


def init(
    *,
    api_key: str | None = None,
    project_id: str | None = None,
    endpoint: str | None = None,
    project: str | None = None,
    environment: str | None = None,
    enabled: bool | None = None,
    debug: bool | None = None,
    capture_inputs: bool = True,
    capture_outputs: bool = True,
    redact_keys: Iterable[str] | None = None,
    batch_size: int = 50,
    flush_interval: float = 5.0,
    max_queue_size: int = 1000,
) -> None:
    if batch_size <= 0:
        raise ValueError("batch_size must be greater than zero")
    if flush_interval <= 0:
        raise ValueError("flush_interval must be greater than zero")
    if max_queue_size <= 0:
        raise ValueError("max_queue_size must be greater than zero")

    resolved_enabled = (
        _env_bool("NORTHSTAR_ENABLED", True) if enabled is None else enabled
    )
    resolved_debug = _env_bool("NORTHSTAR_DEBUG", False) if debug is None else debug
    resolved_api_key = api_key or os.getenv("NORTHSTAR_API_KEY")
    resolved_project_id = project_id or os.getenv("NORTHSTAR_PROJECT_ID")
    resolved_endpoint = endpoint or os.getenv("NORTHSTAR_ENDPOINT")
    resolved_project = project or os.getenv("NORTHSTAR_PROJECT")
    resolved_environment = environment or os.getenv("NORTHSTAR_ENVIRONMENT")
    resolved_redact_keys = _DEFAULT_REDACT_KEYS.union(redact_keys or ())

    client: Northstar | None = None
    if (
        resolved_enabled
        and resolved_api_key
        and (resolved_project_id or resolved_endpoint)
    ):
        client = Northstar(
            api_key=resolved_api_key,
            project_id=resolved_project_id,
            endpoint=resolved_endpoint,
            capture=CaptureOptions(
                user_input=True,
                system_messages=True,
                reasoning=True,
                tool_arguments=True,
                tool_results=True,
                final_response=True,
            ),
        )

    new_state = _SDKState(
        client,
        project=resolved_project,
        environment=resolved_environment,
        capture_inputs=capture_inputs,
        capture_outputs=capture_outputs,
        redact_keys=resolved_redact_keys,
        batch_size=batch_size,
        flush_interval=flush_interval,
        max_queue_size=max_queue_size,
        debug=resolved_debug,
    )
    if resolved_enabled and client is None:
        new_state._warn(
            "disabled because NORTHSTAR_API_KEY and NORTHSTAR_PROJECT_ID "
            "(or NORTHSTAR_ENDPOINT) are required"
        )

    global _state
    with _state_lock:
        old_state = _state
        _state = new_state
    old_state.shutdown()


class _TraceFactory:
    def __init__(
        self,
        name: str | None,
        *,
        input_value: Any = None,
        has_input: bool = False,
        metadata: Mapping[str, Any] | None = None,
        tags: Iterable[str] | None = None,
        capture_input: bool | None = None,
        capture_output: bool | None = None,
    ) -> None:
        self._name = name
        self._input_value = input_value
        self._has_input = has_input
        self._metadata = metadata
        self._tags = tags
        self._capture_input = capture_input
        self._capture_output = capture_output
        self._handle: _TraceHandle | _NoopTrace | None = None

    def __call__(self, func: Callable[P, R]) -> Callable[P, R]:
        trace_name = self._name or func.__name__

        if inspect.iscoroutinefunction(func):

            @wraps(func)
            async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
                handle = _state.start_trace(
                    trace_name,
                    input_value=(
                        self._input_value
                        if self._has_input
                        else _function_arguments(func, args, kwargs)
                    ),
                    has_input=True,
                    metadata=self._metadata,
                    tags=self._tags,
                    capture_input=self._capture_input,
                    capture_output=self._capture_output,
                )
                try:
                    result = await func(*args, **kwargs)
                except BaseException as exc:
                    _finish_trace(handle, type(exc), exc, exc.__traceback__)
                    raise
                handle.set_output(result)
                _finish_trace(handle, None, None, None)
                return result

            return async_wrapper

        @wraps(func)
        def sync_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            handle = _state.start_trace(
                trace_name,
                input_value=(
                    self._input_value
                    if self._has_input
                    else _function_arguments(func, args, kwargs)
                ),
                has_input=True,
                metadata=self._metadata,
                tags=self._tags,
                capture_input=self._capture_input,
                capture_output=self._capture_output,
            )
            try:
                result = func(*args, **kwargs)
            except BaseException as exc:
                _finish_trace(handle, type(exc), exc, exc.__traceback__)
                raise
            handle.set_output(result)
            _finish_trace(handle, None, None, None)
            return result

        return sync_wrapper

    def __enter__(self) -> _TraceHandle | _NoopTrace:
        self._handle = _state.start_trace(
            self._name or "trace",
            input_value=self._input_value,
            has_input=self._has_input,
            metadata=self._metadata,
            tags=self._tags,
            capture_input=self._capture_input,
            capture_output=self._capture_output,
        )
        return self._handle

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object,
    ) -> bool:
        if self._handle is None:
            return False
        return _finish_trace(self._handle, exc_type, exc, traceback)


class _ObserveFactory:
    def __init__(
        self,
        name: str | None,
        *,
        attributes: Mapping[str, Any] | None = None,
    ) -> None:
        self._name = name
        self._attributes = attributes

    def __call__(self, func: Callable[P, R]) -> Callable[P, R]:
        span_name = self._name or func.__name__

        if inspect.iscoroutinefunction(func):

            @wraps(func)
            async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
                span = _active_state().start_span(
                    span_name,
                    attributes=self._attributes,
                )
                if isinstance(span, _SpanHandle):
                    span._state.record_span_input(
                        span,
                        _function_arguments(func, args, kwargs),
                    )
                try:
                    result = await func(*args, **kwargs)
                except BaseException as exc:
                    span.__exit__(type(exc), exc, exc.__traceback__)
                    raise
                if isinstance(span, _SpanHandle):
                    span._state.record_span_output(span, result)
                span.__exit__(None, None, None)
                return result

            return async_wrapper

        @wraps(func)
        def sync_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            span = _active_state().start_span(
                span_name,
                attributes=self._attributes,
            )
            if isinstance(span, _SpanHandle):
                span._state.record_span_input(
                    span,
                    _function_arguments(func, args, kwargs),
                )
            try:
                result = func(*args, **kwargs)
            except BaseException as exc:
                span.__exit__(type(exc), exc, exc.__traceback__)
                raise
            if isinstance(span, _SpanHandle):
                span._state.record_span_output(span, result)
            span.__exit__(None, None, None)
            return result

        return sync_wrapper


def trace(
    name: str | None = None,
    *,
    input: Any = _UNSET,
    metadata: Mapping[str, Any] | None = None,
    tags: Iterable[str] | None = None,
    capture_input: bool | None = None,
    capture_output: bool | None = None,
) -> _TraceFactory:
    return _TraceFactory(
        name,
        input_value=input,
        has_input=input is not _UNSET,
        metadata=metadata,
        tags=tags,
        capture_input=capture_input,
        capture_output=capture_output,
    )


def observe(
    name: str | None = None,
    *,
    attributes: Mapping[str, Any] | None = None,
) -> _ObserveFactory:
    return _ObserveFactory(name, attributes=attributes)


def span(
    name: str,
    *,
    kind: SpanKind = SpanKind.CUSTOM,
    iteration: int | None = None,
    attributes: Mapping[str, Any] | None = None,
) -> _SpanHandle | _NoopSpan:
    return _active_state().start_span(
        name,
        kind=kind,
        iteration=iteration,
        attributes=attributes,
    )


def log_event(name: str, data: Any = None) -> None:
    _active_state().log_event(name, data)


def log_metric(name: str, value: Real) -> None:
    _active_state().log_metric(name, value)


def log_metadata(metadata: Mapping[str, Any]) -> None:
    _active_state().log_metadata(metadata)


def current_trace_id() -> str | None:
    trace_handle = _current_trace.get()
    return str(trace_handle.id) if trace_handle is not None else None


def flush(timeout: float | None = None) -> bool:
    return _state.flush(timeout)


def _shutdown() -> None:
    _state.shutdown()


atexit.register(_shutdown)

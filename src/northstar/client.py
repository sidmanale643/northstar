from __future__ import annotations

import re
import warnings
from collections import OrderedDict
from collections.abc import Mapping
from typing import Any, Literal
from uuid import UUID
from urllib.parse import urlsplit, urlunsplit

import httpx

from .models import CaptureOptions, Event, Run, Score, Session, Span
from .prompts import CompiledPrompt, PromptVersion, from_version


_SUPABASE_PROJECT_ID_RE = re.compile(r"^[a-z0-9]+$")


def _ingest_endpoint(project_id: str | None) -> str | None:
    if project_id is None:
        return None
    if not _SUPABASE_PROJECT_ID_RE.fullmatch(project_id):
        raise ValueError(
            "project_id must be a Supabase project ID (lowercase alphanumeric, ~20 chars). "
            "Pass endpoint= directly to override the ingest URL for self-hosted deployments."
        )
    return f"https://{project_id}.supabase.co/functions/v1/ingest-traces"


class Northstar:
    schema_version = 2
    _timeout_seconds = 10.0
    _max_attempts = 3
    _retry_status_codes = frozenset({408, 429, 500, 502, 503, 504})
    _max_prompt_cache_size = 256

    def __init__(
        self,
        api_key: str,
        endpoint: str | None = None,
        capture: CaptureOptions | None = None,
        *,
        project_id: str | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        resolved_endpoint = endpoint or _ingest_endpoint(project_id)
        if not resolved_endpoint:
            raise ValueError(
                "project_id is required (or pass endpoint= to override the ingest URL)"
            )

        self.api_key = api_key
        self.endpoint = resolved_endpoint.rstrip("/")
        self.capture = capture or CaptureOptions()
        self._pending_sessions: dict[UUID, Session] = {}
        self._pending_runs: dict[UUID, Run] = {}
        self._pending_spans: dict[UUID, Span] = {}
        self._pending_events: dict[UUID, Event] = {}
        self._pending_scores: list[Score] = []
        self._pending_prompt_links: list[dict[str, Any]] = []
        self._prompt_cache: OrderedDict[tuple[str, str, int | None], PromptVersion] = (
            OrderedDict()
        )
        self._last_flushed_payload: dict[str, Any] | None = None

    @property
    def last_flushed_payload(self) -> dict[str, Any] | None:
        return self._last_flushed_payload

    def session(self, metadata: dict[str, Any] | None = None) -> Session:
        session = Session(metadata=metadata or {})
        session._client = self
        self._enqueue_session(session)
        return session

    def score(
        self,
        trace_id: str | UUID,
        name: str,
        value: float | bool | str,
        *,
        span_id: str | UUID | None = None,
        data_type: Literal["numeric", "categorical", "boolean"] | None = None,
        comment: str | None = None,
    ) -> None:
        if isinstance(value, bool):
            inferred_type = "boolean"
            numeric_value = 1.0 if value else 0.0
            string_value = None
        elif isinstance(value, str):
            inferred_type = "categorical"
            numeric_value = 0.0
            string_value = value
        elif isinstance(value, (int, float)):
            inferred_type = "numeric"
            numeric_value = float(value)
            string_value = None
        else:
            raise TypeError("score value must be a bool, string, int, or float")

        if data_type is not None and data_type != inferred_type:
            raise ValueError(
                f"data_type {data_type!r} does not match {type(value).__name__} value"
            )

        self._pending_scores.append(
            Score(
                trace_id=trace_id,
                span_id=span_id,
                name=name,
                value=numeric_value,
                data_type=inferred_type,
                string_value=string_value,
                comment=comment,
            )
        )

    def pull_prompt(
        self,
        name: str,
        *,
        label: str = "prod",
        version: int | None = None,
        use_cache: bool = True,
    ) -> CompiledPrompt:
        cache_key = (name, label, version)
        cached = self._get_cached_prompt(cache_key) if use_cache else None
        try:
            prompt_version = self._resolve_prompt(name, label=label, version=version)
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            if cached is None or not self._should_use_cached_prompt(exc):
                raise
            warnings.warn(
                f"Northstar prompt resolve failed; using cached prompt: {exc}",
                RuntimeWarning,
                stacklevel=2,
            )
            prompt_version = cached

        if use_cache:
            self._cache_prompt(cache_key, prompt_version)
        return from_version(prompt_version, client=self)

    def bind_prompt(
        self,
        prompt: CompiledPrompt,
        *,
        variables: Mapping[str, Any] | None = None,
        span: Span | None = None,
    ):
        return prompt.bind(variables=variables, span=span)

    def flush(self) -> dict[str, Any]:
        payload = self._build_payload()
        if not self._has_pending_records(payload):
            return payload

        self._send_with_retry(payload)
        self._finalize_flush(payload)
        return payload

    async def aflush(self) -> dict[str, Any]:
        payload = self._build_payload()
        if not self._has_pending_records(payload):
            return payload

        await self._asend_with_retry(payload)
        self._finalize_flush(payload)
        return payload

    def _enqueue_session(self, session: Session) -> None:
        self._pending_sessions[session.id] = session

    def _enqueue_run(self, run: Run) -> None:
        self._pending_runs[run.id] = run

    def _enqueue_span(self, span: Span) -> None:
        self._pending_spans[span.id] = span

    def _enqueue_event(self, event: Event) -> None:
        self._pending_events[event.id] = event

    def _enqueue_prompt_link(
        self,
        *,
        trace_id: UUID,
        span_id: UUID,
        prompt_version_id: UUID,
        variable_values: Mapping[str, Any],
    ) -> None:
        self._pending_prompt_links.append(
            {
                "trace_id": str(trace_id),
                "span_id": str(span_id),
                "prompt_version_id": str(prompt_version_id),
                "variable_values": dict(variable_values),
            }
        )

    def _build_payload(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "sessions": [
                session.to_payload() for session in self._pending_sessions.values()
            ],
            "runs": [run.to_payload() for run in self._pending_runs.values()],
            "spans": [span.to_payload() for span in self._pending_spans.values()],
            "events": [event.to_payload() for event in self._pending_events.values()],
            "scores": [score.to_payload() for score in self._pending_scores],
            "prompt_links": list(self._pending_prompt_links),
        }

    def _has_pending_records(self, payload: dict[str, Any]) -> bool:
        return any(
            payload[key]
            for key in (
                "sessions",
                "runs",
                "spans",
                "events",
                "scores",
                "prompt_links",
            )
        )

    def _finalize_flush(self, payload: dict[str, Any]) -> None:
        self._last_flushed_payload = payload
        self._pending_sessions.clear()
        self._pending_runs.clear()
        self._pending_spans.clear()
        self._pending_events.clear()
        self._pending_scores.clear()
        self._pending_prompt_links.clear()

    def _resolve_prompt(
        self,
        name: str,
        *,
        label: str,
        version: int | None,
    ) -> PromptVersion:
        with httpx.Client(timeout=self._timeout_seconds) as client:
            response = client.post(
                self._prompt_resolve_endpoint(),
                json={
                    "name": name,
                    "slug": name,
                    "label": label,
                    "version": version,
                },
                headers=self._request_headers(),
            )
            response.raise_for_status()
            return self._prompt_version_from_response(response)

    def _get_cached_prompt(
        self,
        cache_key: tuple[str, str, int | None],
    ) -> PromptVersion | None:
        prompt = self._prompt_cache.get(cache_key)
        if prompt is None:
            return None
        self._prompt_cache.move_to_end(cache_key)
        return prompt

    def _cache_prompt(
        self,
        cache_key: tuple[str, str, int | None],
        prompt_version: PromptVersion,
    ) -> None:
        existing = self._prompt_cache.get(cache_key)
        if existing is not None and existing.content_hash == prompt_version.content_hash:
            self._prompt_cache.move_to_end(cache_key)
            return
        self._prompt_cache[cache_key] = prompt_version
        self._prompt_cache.move_to_end(cache_key)
        while len(self._prompt_cache) > self._max_prompt_cache_size:
            self._prompt_cache.popitem(last=False)

    def _prompt_resolve_endpoint(self) -> str:
        parsed = urlsplit(self.endpoint)
        if parsed.path.rstrip("/") == "/functions/v1/ingest-traces":
            return urlunsplit(
                (
                    parsed.scheme,
                    parsed.netloc,
                    "/functions/v1/prompts/resolve",
                    "",
                    "",
                )
            )
        return f"{self.endpoint}/api/prompts/resolve"

    def _should_use_cached_prompt(
        self,
        exc: httpx.HTTPStatusError | httpx.RequestError,
    ) -> bool:
        if isinstance(exc, httpx.RequestError):
            return True
        return self._should_retry_status(exc.response.status_code)

    @staticmethod
    def _prompt_version_from_response(response: httpx.Response) -> PromptVersion:
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("Northstar prompt resolve endpoint returned invalid JSON")

        raw = body.get("prompt_version", body.get("prompt", body))
        if not isinstance(raw, dict):
            raise ValueError("Northstar prompt resolve endpoint returned no prompt")

        data = dict(raw)
        if "id" not in data and "prompt_version_id" in data:
            data["id"] = data["prompt_version_id"]
        if "id" not in data:
            raise ValueError("Northstar prompt resolve endpoint returned no version id")
        return PromptVersion.model_validate(data)

    def _send_with_retry(self, payload: dict[str, Any]) -> None:
        with httpx.Client(timeout=self._timeout_seconds) as client:
            for attempt in range(self._max_attempts):
                try:
                    response = client.post(
                        self.endpoint,
                        json=payload,
                        headers=self._request_headers(),
                    )
                    response.raise_for_status()
                    self._validate_response(response)
                    return
                except httpx.HTTPStatusError as exc:
                    if not self._should_retry_status(exc.response.status_code):
                        raise
                    if attempt == self._max_attempts - 1:
                        raise
                except httpx.RequestError:
                    if attempt == self._max_attempts - 1:
                        raise

    async def _asend_with_retry(self, payload: dict[str, Any]) -> None:
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            for attempt in range(self._max_attempts):
                try:
                    response = await client.post(
                        self.endpoint,
                        json=payload,
                        headers=self._request_headers(),
                    )
                    response.raise_for_status()
                    self._validate_response(response)
                    return
                except httpx.HTTPStatusError as exc:
                    if not self._should_retry_status(exc.response.status_code):
                        raise
                    if attempt == self._max_attempts - 1:
                        raise
                except httpx.RequestError:
                    if attempt == self._max_attempts - 1:
                        raise

    def _request_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
        }

    @classmethod
    def _should_retry_status(cls, status_code: int) -> bool:
        return status_code in cls._retry_status_codes

    @staticmethod
    def _validate_response(response: httpx.Response) -> None:
        try:
            body = response.json()
        except ValueError as exc:
            raise ValueError(
                "Northstar ingest endpoint returned invalid JSON",
            ) from exc

        if not isinstance(body, dict) or body.get("accepted") is not True:
            raise ValueError("Northstar ingest endpoint did not accept the batch")

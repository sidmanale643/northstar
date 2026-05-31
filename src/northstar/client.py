from __future__ import annotations

import re
from typing import Any
from uuid import UUID

import httpx

from .models import CaptureOptions, Event, Run, Session, Span


_SUPABASE_PROJECT_ID_RE = re.compile(r"^[a-z0-9]+$")


def _ingest_endpoint(project_id: str | None) -> str | None:
    if project_id is None:
        return None
    if not _SUPABASE_PROJECT_ID_RE.fullmatch(project_id):
        raise ValueError(
            "project_id must be a Supabase project ID; "
            "use NORTHSTAR_ENDPOINT when configuring the SDK from the dashboard"
        )
    return f"https://{project_id}.supabase.co/functions/v1/ingest-traces"


class Northstar:
    schema_version = 1
    _timeout_seconds = 10.0
    _max_attempts = 3
    _retry_status_codes = frozenset({408, 429, 500, 502, 503, 504})

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
            raise ValueError("project_id or endpoint is required")

        self.api_key = api_key
        self.endpoint = resolved_endpoint.rstrip("/")
        self.capture = capture or CaptureOptions()
        self._pending_sessions: dict[UUID, Session] = {}
        self._pending_runs: dict[UUID, Run] = {}
        self._pending_spans: dict[UUID, Span] = {}
        self._pending_events: dict[UUID, Event] = {}
        self._last_flushed_payload: dict[str, Any] | None = None

    @property
    def last_flushed_payload(self) -> dict[str, Any] | None:
        return self._last_flushed_payload

    def session(self, metadata: dict[str, Any] | None = None) -> Session:
        session = Session(metadata=metadata or {})
        session._client = self
        self._enqueue_session(session)
        return session

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

    def _build_payload(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "sessions": [
                session.to_payload() for session in self._pending_sessions.values()
            ],
            "runs": [run.to_payload() for run in self._pending_runs.values()],
            "spans": [span.to_payload() for span in self._pending_spans.values()],
            "events": [event.to_payload() for event in self._pending_events.values()],
        }

    def _has_pending_records(self, payload: dict[str, Any]) -> bool:
        return any(payload[key] for key in ("sessions", "runs", "spans", "events"))

    def _finalize_flush(self, payload: dict[str, Any]) -> None:
        self._last_flushed_payload = payload
        self._pending_sessions.clear()
        self._pending_runs.clear()
        self._pending_spans.clear()
        self._pending_events.clear()

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

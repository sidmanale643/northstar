import json
import time

import httpx
import pytest

import northstar


@pytest.fixture(autouse=True)
def reset_global_client():
    yield
    northstar.init(enabled=False)


def configure(**kwargs):
    options = {
        "api_key": "test-key",
        "endpoint": "https://api.northstar.test",
        "batch_size": 100,
        "flush_interval": 60,
    }
    options.update(kwargs)
    northstar.init(**options)


def posted_payload(mock_ingest_endpoint):
    assert northstar.flush() is True
    assert mock_ingest_endpoint.call_count == 1
    return json.loads(mock_ingest_endpoint.calls[0].request.content)


def test_score_is_exported_from_package():
    assert northstar.Score.__name__ == "Score"


def test_decorators_capture_nested_trace_data_and_redact_sensitive_values(
    mock_ingest_endpoint,
):
    configure(project="support", environment="dev")

    @northstar.observe("retrieve-docs")
    def retrieve_docs(payload):
        northstar.log_event("retrieval_started", {"api_key": "sk-secret"})
        return [{"title": "Reset password", "token": "private"}]

    @northstar.trace(
        "support-agent",
        metadata={"team": "support"},
        tags=["rag", "production"],
    )
    def run_agent(payload):
        northstar.log_metadata({"user_id": "user-123"})
        northstar.log_metric("confidence", 0.86)
        return retrieve_docs(payload)

    result = run_agent(
        {
            "email": "abc@example.com",
            "password": "hello123",
        }
    )

    assert result == [{"title": "Reset password", "token": "private"}]

    payload = posted_payload(mock_ingest_endpoint)
    assert len(payload["sessions"]) == 1
    assert len(payload["runs"]) == 1
    assert len(payload["spans"]) == 1

    run = payload["runs"][0]
    assert run["name"] == "support-agent"
    assert run["status"] == "ok"
    assert run["metadata"]["latency_ms"] >= 0
    assert {key: value for key, value in run["metadata"].items() if key != "latency_ms"} == {
        "environment": "dev",
        "project": "support",
        "tags": ["rag", "production"],
        "team": "support",
        "user_id": "user-123",
    }

    assert payload["spans"][0]["name"] == "retrieve-docs"
    assert payload["spans"][0]["status"] == "ok"
    assert [event["type"] for event in payload["events"]] == [
        "user_input",
        "custom",
        "tool_arguments",
        "custom",
        "tool_result",
        "final_response",
    ]
    assert payload["events"][0]["content"] == {
        "payload": {
            "email": "abc@example.com",
            "password": "[REDACTED]",
        }
    }
    assert payload["events"][1]["content"] == {
        "name": "confidence",
        "value": 0.86,
    }
    assert payload["events"][3]["content"] == {
        "data": {"api_key": "[REDACTED]"},
        "name": "retrieval_started",
    }
    assert payload["events"][4]["content"] == [
        {"title": "Reset password", "token": "[REDACTED]"}
    ]


@pytest.mark.asyncio
async def test_async_decorators_preserve_span_context(mock_ingest_endpoint):
    configure()

    @northstar.observe()
    async def retrieve_docs(query):
        assert northstar.current_trace_id() is not None
        return [query]

    @northstar.trace()
    async def run_agent(query):
        return await retrieve_docs(query)

    assert await run_agent("docs") == ["docs"]

    payload = posted_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["name"] == "run_agent"
    assert payload["runs"][0]["status"] == "ok"
    assert payload["spans"][0]["name"] == "retrieve_docs"
    assert payload["spans"][0]["status"] == "ok"


def test_nested_observers_preserve_span_parenting(mock_ingest_endpoint):
    configure()

    @northstar.observe("inner")
    def inner():
        return "ok"

    @northstar.observe("outer")
    def outer():
        return inner()

    @northstar.trace("agent")
    def run_agent():
        return outer()

    assert run_agent() == "ok"

    payload = posted_payload(mock_ingest_endpoint)
    spans = {span["name"]: span for span in payload["spans"]}
    assert spans["inner"]["parent_span_id"] == spans["outer"]["id"]


def test_context_managers_expose_trace_id_and_capture_manual_spans(
    mock_ingest_endpoint,
):
    configure()

    with northstar.trace("research-agent", input={"query": "rag"}) as trace:
        assert northstar.current_trace_id() == str(trace.id)
        with northstar.span("retrieval"):
            northstar.log_event("docs_retrieved", {"count": 2})
        trace.set_output("answer")

    assert northstar.current_trace_id() is None

    payload = posted_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["name"] == "research-agent"
    assert payload["spans"][0]["name"] == "retrieval"
    assert payload["events"][1]["span_id"] == payload["spans"][0]["id"]


def test_initialized_client_groups_traces_in_one_session_until_shutdown(
    mock_ingest_endpoint,
):
    configure()

    @northstar.trace("agent")
    def run_agent(query):
        return query.upper()

    assert run_agent("first") == "FIRST"
    assert northstar.flush() is True
    assert run_agent("second") == "SECOND"
    assert northstar.flush() is True
    northstar.init(enabled=False)

    payloads = [
        json.loads(call.request.content)
        for call in mock_ingest_endpoint.calls
    ]
    assert len(payloads) == 3

    session = payloads[0]["sessions"][0]
    assert "ended_at" not in session
    assert payloads[1]["sessions"] == []
    assert payloads[0]["runs"][0]["session_id"] == session["id"]
    assert payloads[1]["runs"][0]["session_id"] == session["id"]

    ended_session = payloads[2]["sessions"][0]
    assert ended_session["id"] == session["id"]
    assert "ended_at" in ended_session


def test_capture_flags_disable_automatic_content(mock_ingest_endpoint):
    configure(capture_inputs=False, capture_outputs=False)

    @northstar.observe()
    def child(secret):
        return secret

    @northstar.trace()
    def run_agent(secret):
        return child(secret)

    assert run_agent("private") == "private"

    payload = posted_payload(mock_ingest_endpoint)
    assert payload["events"] == []


def test_per_trace_capture_flags_override_global_settings(mock_ingest_endpoint):
    configure()

    @northstar.trace(capture_input=False, capture_output=False)
    def run_agent(secret):
        return secret

    assert run_agent("private") == "private"

    payload = posted_payload(mock_ingest_endpoint)
    assert payload["events"] == []


def test_disabled_mode_keeps_decorated_code_as_a_noop(mock_ingest_endpoint):
    northstar.init(enabled=False)

    @northstar.trace()
    def run_agent(query):
        northstar.log_event("ignored", {"query": query})
        return query.upper()

    assert run_agent("hello") == "HELLO"
    assert northstar.current_trace_id() is None
    assert northstar.flush() is True
    assert mock_ingest_endpoint.call_count == 0


def test_environment_configuration_is_used(monkeypatch, mock_project_ingest_endpoint):
    monkeypatch.setenv("NORTHSTAR_API_KEY", "test-key")
    monkeypatch.setenv("NORTHSTAR_PROJECT_ID", "northstarproject")
    monkeypatch.setenv("NORTHSTAR_PROJECT", "env-project")
    monkeypatch.setenv("NORTHSTAR_ENVIRONMENT", "staging")

    northstar.init(batch_size=100, flush_interval=60)

    @northstar.trace()
    def run_agent():
        return "ok"

    assert run_agent() == "ok"

    payload = posted_payload(mock_project_ingest_endpoint)
    metadata = payload["runs"][0]["metadata"]
    assert metadata["latency_ms"] >= 0
    assert {key: value for key, value in metadata.items() if key != "latency_ms"} == {
        "environment": "staging",
        "project": "env-project",
    }


def test_network_failures_do_not_escape_global_flush(mock_ingest_endpoint):
    def responder(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    mock_ingest_endpoint.mock(side_effect=responder)
    configure()

    @northstar.trace()
    def run_agent():
        return "ok"

    assert run_agent() == "ok"
    assert northstar.flush(timeout=0.01) is False


def test_user_exception_is_recorded_and_reraised(mock_ingest_endpoint):
    configure()

    @northstar.trace("agent")
    def run_agent():
        raise ValueError("agent failed")

    with pytest.raises(ValueError, match="agent failed"):
        run_agent()

    payload = posted_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["status"] == "error"
    assert payload["runs"][0]["error"]["message"] == "agent failed"


def test_log_metric_rejects_non_numeric_values():
    northstar.init(enabled=False)

    with pytest.raises(TypeError, match="metric value must be numeric"):
        northstar.log_metric("confidence", "high")


def test_explicit_none_input_is_captured(mock_ingest_endpoint):
    configure()

    with northstar.trace("agent", input=None):
        pass

    payload = posted_payload(mock_ingest_endpoint)
    assert payload["events"][0]["type"] == "user_input"
    assert "content" not in payload["events"][0]


def test_trace_finishes_on_originating_client_after_reinitialization(
    mock_ingest_endpoint,
):
    configure()

    @northstar.trace("agent")
    def run_agent():
        northstar.init(enabled=False)
        return "ok"

    assert run_agent() == "ok"

    payloads = [
        json.loads(call.request.content)
        for call in mock_ingest_endpoint.calls
    ]
    runs = [run for payload in payloads for run in payload["runs"]]
    assert runs[-1]["status"] == "ok"


def test_background_worker_flushes_when_batch_size_is_reached(
    mock_ingest_endpoint,
):
    configure(batch_size=1)

    @northstar.trace("agent")
    def run_agent():
        return "ok"

    assert run_agent() == "ok"

    deadline = time.monotonic() + 2
    while mock_ingest_endpoint.call_count == 0 and time.monotonic() < deadline:
        time.sleep(0.01)

    assert mock_ingest_endpoint.call_count > 0

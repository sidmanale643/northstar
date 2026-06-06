import json

import httpx
import pytest

from northstar import Northstar, SpanKind


def test_flush_posts_bearer_token(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    session = client.session()
    with session.run("research-agent"):
        pass

    client.flush()

    assert mock_ingest_endpoint.call_count == 1
    request = mock_ingest_endpoint.calls[0].request
    assert request.headers["authorization"] == "Bearer test-key"


def test_score_coerces_values_and_flushes_schema_version_2(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )
    trace_id = "64c0a90d-20d1-46cf-bd88-7281ae4b6dd7"
    span_id = "c77655db-9dc8-45d8-aa26-463299d124ef"

    assert client.score(trace_id, "correct", True, comment="checked") is None
    client.score(trace_id, "quality", "excellent", span_id=span_id)
    client.score(trace_id, "confidence", 0.8, data_type="numeric")

    payload = client.flush()

    assert payload["schema_version"] == 2
    assert payload["sessions"] == []
    assert payload["scores"][0] == {
        "id": payload["scores"][0]["id"],
        "trace_id": trace_id,
        "name": "correct",
        "value": 1.0,
        "data_type": "boolean",
        "source": "api",
        "comment": "checked",
        "created_at": payload["scores"][0]["created_at"],
    }
    assert payload["scores"][1]["span_id"] == span_id
    assert payload["scores"][1]["value"] == 0.0
    assert payload["scores"][1]["data_type"] == "categorical"
    assert payload["scores"][1]["string_value"] == "excellent"
    assert payload["scores"][2]["value"] == 0.8
    assert payload["scores"][2]["data_type"] == "numeric"
    assert client._pending_scores == []


def test_score_rejects_explicit_type_that_disagrees_with_value():
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with pytest.raises(ValueError, match="data_type"):
        client.score(
            "64c0a90d-20d1-46cf-bd88-7281ae4b6dd7",
            "quality",
            True,
            data_type="numeric",
        )


def test_failed_flush_retains_pending_scores(mock_ingest_endpoint):
    responses = [
        (400, {"error": "bad request"}),
        (200, {"accepted": True}),
    ]

    def responder(request: httpx.Request) -> httpx.Response:
        status_code, body = responses.pop(0)
        return httpx.Response(status_code, json=body, request=request)

    mock_ingest_endpoint.mock(side_effect=responder)
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )
    client.score(
        "64c0a90d-20d1-46cf-bd88-7281ae4b6dd7",
        "quality",
        0.8,
    )

    with pytest.raises(httpx.HTTPStatusError):
        client.flush()

    assert len(client._pending_scores) == 1
    payload = client.flush()
    assert len(payload["scores"]) == 1
    assert client._pending_scores == []


@pytest.mark.asyncio
async def test_aflush_drains_pending_scores(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )
    client.score(
        "64c0a90d-20d1-46cf-bd88-7281ae4b6dd7",
        "correct",
        False,
    )

    payload = await client.aflush()

    assert payload["schema_version"] == 2
    assert payload["scores"][0]["value"] == 0.0
    assert payload["scores"][0]["data_type"] == "boolean"
    assert client._pending_scores == []


def test_flush_omits_backend_assigned_project_ids(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            with run.span("tool", kind=SpanKind.TOOL):
                pass
            run.record_custom_event({"step": "started"})

    payload = client.last_flushed_payload
    assert payload is not None
    assert "project_id" not in payload["sessions"][0]
    assert "project_id" not in payload["runs"][0]
    assert "project_id" not in payload["spans"][0]
    assert "project_id" not in payload["events"][0]


def test_flush_retries_transient_failures_with_stable_payload_ids(
    mock_ingest_endpoint,
):
    responses = [
        (503, {"error": "try again"}),
        (200, {"accepted": True}),
    ]

    def responder(request: httpx.Request) -> httpx.Response:
        status_code, body = responses.pop(0)
        return httpx.Response(status_code, json=body, request=request)

    mock_ingest_endpoint.mock(side_effect=responder)

    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    session = client.session()
    with session.run("research-agent") as run:
        run_id = run.id

    payload = client.flush()

    assert payload["runs"][0]["id"] == str(run_id)
    assert mock_ingest_endpoint.call_count == 2

    first_body = json.loads(mock_ingest_endpoint.calls[0].request.content)
    second_body = json.loads(mock_ingest_endpoint.calls[1].request.content)
    assert first_body == second_body
    assert first_body["runs"][0]["id"] == str(run_id)


def test_flush_does_not_retry_client_errors_and_retains_payload(
    mock_ingest_endpoint,
):
    responses = [
        (400, {"error": "bad request"}),
        (200, {"accepted": True}),
    ]

    def responder(request: httpx.Request) -> httpx.Response:
        status_code, body = responses.pop(0)
        return httpx.Response(status_code, json=body, request=request)

    mock_ingest_endpoint.mock(side_effect=responder)

    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    session = client.session()
    with session.run("research-agent") as run:
        run_id = run.id

    with pytest.raises(httpx.HTTPStatusError):
        client.flush()

    assert mock_ingest_endpoint.call_count == 1

    payload = client.flush()

    assert payload["runs"][0]["id"] == str(run_id)
    assert mock_ingest_endpoint.call_count == 2

    first_body = json.loads(mock_ingest_endpoint.calls[0].request.content)
    second_body = json.loads(mock_ingest_endpoint.calls[1].request.content)
    assert first_body == second_body


def test_session_exit_preserves_original_exception_when_flush_fails(
    mock_ingest_endpoint,
):
    def responder(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "down"}, request=request)

    mock_ingest_endpoint.mock(side_effect=responder)

    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with pytest.raises(RuntimeError, match="boom") as exc_info:
        with client.session() as session:
            with session.run("research-agent"):
                raise RuntimeError("boom")

    assert mock_ingest_endpoint.call_count == 3
    assert any(
        "Northstar flush failed:" in note
        for note in getattr(exc_info.value, "__notes__", [])
    )

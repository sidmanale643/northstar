import pytest

from northstar import CaptureOptions, Northstar, SpanKind, pricing

from json import loads as _json_loads

requires_pricing = pytest.mark.skipif(
    not pricing.is_available(),
    reason="litellm is not installed (install with `uv add 'northstar-ai[pricing]'`)",
)


def test_explicit_flush_drains_completed_records_before_session_exit(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session(metadata={"source": "cli"}) as session:
        with session.run("research-agent") as run:
            assert run.status == "running"

        batch = client.flush()

        assert batch["schema_version"] == 2
        assert len(batch["sessions"]) == 1
        assert batch["sessions"][0]["id"] == str(session.id)
        assert "ended_at" not in batch["sessions"][0]
        assert len(batch["runs"]) == 1
        assert batch["runs"][0]["name"] == "research-agent"
        assert batch["runs"][0]["status"] == "ok"
        assert batch["spans"] == []
        assert batch["events"] == []

    assert client.last_flushed_payload is not None
    assert len(client.last_flushed_payload["sessions"]) == 1


@requires_pricing
def test_model_span_records_usage_attributes_in_payload(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("chat", kind=SpanKind.MODEL) as span:
                span.record_usage(
                    model="gpt-4o",
                    prompt_tokens=100,
                    completion_tokens=200,
                )

    body = _json_loads(mock_ingest_endpoint.calls[-1].request.content)
    spans = body["spans"]
    model_span = next(span for span in spans if span["kind"] == "model")
    assert model_span["attributes"]["model"] == "gpt-4o"
    assert model_span["attributes"]["input_tokens"] == 100
    assert model_span["attributes"]["output_tokens"] == 200
    assert model_span["attributes"]["total_tokens"] == 300
    assert model_span["attributes"]["cost_usd"] > 0
    assert model_span["attributes"]["pricing_source"] == "litellm"

    runs = body["runs"]
    assert runs[0]["metadata"]["cost_usd"] > 0
    assert runs[0]["metadata"]["total_input_tokens"] == 100
    assert runs[0]["metadata"]["total_output_tokens"] == 200


@requires_pricing
def test_run_aggregates_cost_for_legacy_traces_without_model_spans(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("legacy-agent") as run:
            with run.span("planner", kind=SpanKind.AGENT):
                pass

    body = _json_loads(mock_ingest_endpoint.calls[-1].request.content)
    assert "cost_usd" not in body["runs"][0]["metadata"]
    assert "total_input_tokens" not in body["runs"][0]["metadata"]
    assert "total_output_tokens" not in body["runs"][0]["metadata"]
    assert client.last_flushed_payload["sessions"][0]["id"] == str(session.id)
    assert client.last_flushed_payload["runs"] == []


def test_explicit_flush_inside_active_span_includes_running_ancestors(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            with run.span("planner", kind=SpanKind.AGENT) as span:
                batch = client.flush()

                assert batch["sessions"][0]["id"] == str(session.id)
                assert batch["runs"][0]["id"] == str(run.id)
                assert batch["runs"][0]["status"] == "running"
                assert batch["spans"][0]["id"] == str(span.id)
                assert batch["spans"][0]["status"] == "running"


def test_nested_spans_preserve_parent_ids_and_finalize_status(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            with run.span("planner", kind=SpanKind.AGENT, iteration=1) as parent:
                with parent.span(
                    "search",
                    kind=SpanKind.TOOL,
                    attributes={"description": "lookup"},
                ) as child:
                    assert child.parent_span_id == parent.id

    batch = client.last_flushed_payload
    assert batch is not None
    assert len(batch["sessions"]) == 1
    assert len(batch["runs"]) == 1
    assert len(batch["spans"]) == 2

    spans = {span["name"]: span for span in batch["spans"]}
    assert spans["planner"]["kind"] == "agent"
    assert spans["planner"]["iteration"] == 1
    assert spans["planner"]["status"] == "ok"
    assert "ended_at" in spans["planner"]
    assert spans["search"]["kind"] == "tool"
    assert spans["search"]["status"] == "ok"
    assert spans["search"]["attributes"] == {"description": "lookup"}
    assert spans["search"]["parent_span_id"] == spans["planner"]["id"]


def test_manual_event_recording_discards_disabled_sensitive_categories(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            run.record_user_input("secret prompt")
            run.record_system_message("system")
            run.record_assistant_message("intermediate")
            run.record_final_response("answer")
            with run.span("tool", kind=SpanKind.TOOL) as span:
                span.record_reasoning("private reasoning")
                span.record_tool_arguments({"query": "docs"})
                span.record_tool_result({"ok": True})

    batch = client.last_flushed_payload
    assert batch is not None
    assert batch["events"] == []


def test_manual_event_recording_captures_enabled_categories(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(
            user_input=True,
            system_messages=True,
            assistant_messages=True,
            reasoning=True,
            tool_arguments=True,
            tool_results=True,
            final_response=True,
        ),
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            run.record_user_input("prompt")
            run.record_system_message("system")
            run.record_assistant_message("intermediate")
            run.record_final_response("answer")
            with run.span("tool", kind=SpanKind.TOOL) as span:
                span.record_reasoning("thinking")
                span.record_tool_arguments({"query": "docs"})
                span.record_tool_result({"ok": True})

    batch = client.last_flushed_payload
    assert batch is not None
    assert [event["type"] for event in batch["events"]] == [
        "user_input",
        "system_message",
        "assistant_message",
        "final_response",
        "reasoning",
        "tool_arguments",
        "tool_result",
    ]
    assert batch["events"][0]["content"] == "prompt"
    assert batch["events"][2]["content"] == "intermediate"
    assert batch["events"][4]["content"] == "thinking"
    assert batch["events"][5]["content"] == {"query": "docs"}
    assert batch["events"][6]["content"] == {"ok": True}


def test_model_messages_capture_system_prompt_tool_params_and_tool_outputs(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(
            system_messages=True,
            assistant_messages=True,
            tool_arguments=True,
            tool_results=True,
        ),
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            with run.span("chat", kind=SpanKind.MODEL) as span:
                span.record_input_messages(
                    "gpt-4o",
                    [
                        {"role": "system", "content": "Use public docs only."},
                        {
                            "role": "tool",
                            "tool_call_id": "call-1",
                            "name": "search_docs",
                            "content": {"result": "Refunds are available."},
                        },
                    ],
                )
                span.record_output_message(
                    "gpt-4o",
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "type": "function",
                                "function": {
                                    "name": "search_docs",
                                    "arguments": '{"query":"refund policy"}',
                                },
                            }
                        ],
                    },
                )

    batch = client.last_flushed_payload
    assert batch is not None
    assert [event["type"] for event in batch["events"]] == [
        "system_message",
        "tool_result",
        "tool_arguments",
    ]
    assert batch["events"][0]["content"] == "Use public docs only."
    assert batch["events"][1]["content"] == {"result": "Refunds are available."}
    assert batch["events"][1]["attributes"] == {
        "name": "search_docs",
        "tool_call_id": "call-1",
    }
    assert batch["events"][2]["content"] == {
        "id": "call-1",
        "name": "search_docs",
        "arguments": '{"query":"refund policy"}',
    }


def test_recorded_error_survives_successful_context_exit(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            run.record_error(RuntimeError("handled failure"))

    batch = client.last_flushed_payload
    assert batch is not None
    assert batch["runs"][0]["status"] == "error"
    assert batch["runs"][0]["error"] == {
        "type": "RuntimeError",
        "message": "handled failure",
        "module": "builtins",
    }


def test_trace_tool_records_sync_arguments_and_result(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            @run.trace_tool(name="search")
            def search(query: str, *, limit: int = 1) -> dict[str, object]:
                return {"query": query, "limit": limit}

            assert search.__name__ == "search"
            assert search("docs", limit=2) == {"query": "docs", "limit": 2}

    batch = client.last_flushed_payload
    assert batch is not None
    assert len(batch["spans"]) == 1
    assert batch["spans"][0]["kind"] == "tool"
    assert batch["spans"][0]["name"] == "search"
    assert [event["type"] for event in batch["events"]] == [
        "tool_arguments",
        "tool_result",
    ]
    assert batch["events"][0]["content"] == {
        "args": ["docs"],
        "kwargs": {"limit": 2},
    }
    assert batch["events"][1]["content"] == {"query": "docs", "limit": 2}


def test_trace_tool_failure_records_structured_error_and_reraises(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    with pytest.raises(RuntimeError, match="boom"):
        with client.session() as session:
            with session.run("research-agent") as run:
                @run.trace_tool(name="explode")
                def explode() -> None:
                    raise RuntimeError("boom")

                explode()

    batch = client.last_flushed_payload
    assert batch is not None
    assert len(batch["runs"]) == 1
    assert len(batch["spans"]) == 1
    assert batch["runs"][0]["status"] == "error"
    assert batch["runs"][0]["error"] == {
        "type": "RuntimeError",
        "message": "boom",
        "module": "builtins",
    }
    assert batch["spans"][0]["status"] == "error"
    assert batch["spans"][0]["error"] == {
        "type": "RuntimeError",
        "message": "boom",
        "module": "builtins",
    }
    assert [event["type"] for event in batch["events"]] == ["tool_arguments"]


@pytest.mark.asyncio
async def test_trace_tool_records_async_results_and_aflush(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_results=True),
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            @run.trace_tool(name="fetch")
            async def fetch(url: str) -> dict[str, str]:
                return {"url": url}

            assert fetch.__name__ == "fetch"
            assert await fetch("https://example.com") == {
                "url": "https://example.com"
            }

        batch = await client.aflush()
        assert batch["schema_version"] == 2
        assert len(batch["sessions"]) == 1
        assert batch["sessions"][0]["id"] == str(session.id)
        assert len(batch["runs"]) == 1
        assert len(batch["spans"]) == 1
        assert [event["type"] for event in batch["events"]] == ["tool_result"]
        assert batch["events"][0]["content"] == {"url": "https://example.com"}

    assert client.last_flushed_payload is not None
    assert len(client.last_flushed_payload["sessions"]) == 1


@requires_pricing
def test_model_span_records_usage_attributes_in_payload(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("chat", kind=SpanKind.MODEL) as span:
                span.record_usage(
                    model="gpt-4o",
                    prompt_tokens=100,
                    completion_tokens=200,
                )

    body = _json_loads(mock_ingest_endpoint.calls[-1].request.content)
    spans = body["spans"]
    model_span = next(span for span in spans if span["kind"] == "model")
    assert model_span["attributes"]["model"] == "gpt-4o"
    assert model_span["attributes"]["input_tokens"] == 100
    assert model_span["attributes"]["output_tokens"] == 200
    assert model_span["attributes"]["total_tokens"] == 300
    assert model_span["attributes"]["cost_usd"] > 0
    assert model_span["attributes"]["pricing_source"] == "litellm"

    runs = body["runs"]
    assert runs[0]["metadata"]["cost_usd"] > 0
    assert runs[0]["metadata"]["total_input_tokens"] == 100
    assert runs[0]["metadata"]["total_output_tokens"] == 200


@requires_pricing
def test_run_aggregates_cost_for_legacy_traces_without_model_spans(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("legacy-agent") as run:
            with run.span("planner", kind=SpanKind.AGENT):
                pass

    body = _json_loads(mock_ingest_endpoint.calls[-1].request.content)
    assert "cost_usd" not in body["runs"][0]["metadata"]
    assert "total_input_tokens" not in body["runs"][0]["metadata"]
    assert "total_output_tokens" not in body["runs"][0]["metadata"]

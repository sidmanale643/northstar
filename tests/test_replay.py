from __future__ import annotations

import asyncio
from json import loads as _json_loads
from uuid import UUID

import pytest

from northstar import (
    CaptureOptions,
    Northstar,
    Replay,
    ReplayDiff,
    ReplayStep,
    Run,
    SpanKind,
)


def test_replay_yields_events_in_temporal_order(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    with client.session() as session:
        with session.run("research-agent") as run:
            with run.span("planner", kind=SpanKind.AGENT) as planner:
                with planner.span("search", kind=SpanKind.TOOL) as search:
                    search.record_tool_arguments({"args": ["docs"], "kwargs": {}})
                    search.record_tool_result({"hits": 1})
                with planner.span("summarize", kind=SpanKind.CUSTOM) as summarize:
                    summarize.record_custom_event({"chunks": 1})
            with run.span("responder", kind=SpanKind.AGENT) as responder:
                responder.record_custom_event({"answer": "ok"})

    replay = run.replay()
    assert [step.span_name for step in replay] == [
        "search",
        "search",
        "summarize",
        "responder",
    ]


def test_replay_marks_tool_calls_and_results(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["docs"], "kwargs": {"limit": 2}})
                span.record_tool_result({"hits": 3})

    replay = run.replay()
    steps = replay.steps()
    assert [step.event_type for step in steps] == ["tool_arguments", "tool_result"]
    assert steps[0].is_tool_call is True
    assert steps[0].is_tool_result is False
    assert steps[1].is_tool_call is False
    assert steps[1].is_tool_result is True
    assert steps[0].content == {"args": ["docs"], "kwargs": {"limit": 2}}


def test_replay_includes_run_level_events(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(
            user_input=True,
            tool_arguments=True,
            tool_results=True,
            final_response=True,
        ),
    )

    with client.session() as session:
        with session.run("agent") as run:
            run.record_user_input("what is rag?")
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["rag"], "kwargs": {}})
                span.record_tool_result({"hits": 2})
            run.record_final_response("explanation")

    replay = run.replay()
    assert [step.event_type for step in replay] == [
        "user_input",
        "tool_arguments",
        "tool_result",
        "final_response",
    ]

    [user_input, _, _, final] = replay.steps()
    assert user_input.span_name is None
    assert user_input.span_id is None
    assert final.span_name is None
    assert final.span_id is None


def test_replay_reexecutes_tool_calls_with_registry(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    calls: list[tuple[str, dict]] = []

    def search(query: str, *, limit: int = 1) -> dict[str, int]:
        calls.append((query, {"limit": limit}))
        return {"hits": limit * 2, "query": query}

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments(
                    {"args": ["docs"], "kwargs": {"limit": 5}},
                )
                span.record_tool_result({"hits": 10, "query": "docs"})

    replay = run.replay(tools={"search": search})
    results = replay.replay()

    assert results == [{"hits": 10, "query": "docs"}]
    assert calls == [("docs", {"limit": 5})]


def test_replay_step_invoke_splits_args_and_kwargs(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True),
    )

    seen: dict[str, object] = {}

    def fetch(*parts: str, timeout: float = 1.0) -> str:
        seen["args"] = parts
        seen["timeout"] = timeout
        return "ok"

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("fetch", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments(
                    {"args": ["a", "b"], "kwargs": {"timeout": 0.5}},
                )

    replay = run.replay(tools={"fetch": fetch})
    [call] = replay.tool_calls()
    assert call.invoke() == "ok"
    assert seen == {"args": ("a", "b"), "timeout": 0.5}


def test_replay_step_invoke_accepts_override_tools(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["docs"], "kwargs": {}})

    replay = run.replay(tools={"search": lambda _query: "first"})

    fallback_calls: list[str] = []

    def fallback(query: str) -> str:
        fallback_calls.append(query)
        return "second"

    [call] = replay.tool_calls()
    assert call.invoke() == "first"
    assert call.invoke(tools={"search": fallback}) == "second"
    assert fallback_calls == ["docs"]


def test_replay_without_registry_raises_for_replay_method(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["docs"], "kwargs": {}})

    replay = run.replay()
    with pytest.raises(ValueError, match="tool registry is required"):
        replay.replay()


def test_replay_raises_when_tool_is_not_registered(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["docs"], "kwargs": {}})

    replay = run.replay(tools={"other": lambda: None})
    [call] = replay.tool_calls()
    with pytest.raises(KeyError, match="'search'"):
        call.invoke()


def test_replay_invoke_rejects_non_tool_steps(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(reasoning=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("planner", kind=SpanKind.AGENT) as span:
                span.record_reasoning("thinking")

    replay = run.replay()
    [step] = replay.steps()
    assert step.is_tool_call is False
    with pytest.raises(TypeError, match="only tool call steps"):
        step.invoke()


def test_replay_diff_reports_recorded_vs_replayed(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["docs"], "kwargs": {}})
                span.record_tool_result({"hits": 1})
            with run.span("lookup", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["key"], "kwargs": {}})
                span.record_tool_result({"value": "old"})

    def search(query: str) -> dict[str, int]:
        return {"hits": 1}

    def lookup(key: str) -> dict[str, str]:
        return {"value": "new"}

    replay = run.replay(tools={"search": search, "lookup": lookup})
    replayed = replay.replay()
    diffs = replay.diff(replayed)

    assert len(diffs) == 2
    assert diffs[0] == ReplayDiff(0, "search", {"hits": 1}, {"hits": 1})
    assert diffs[0].matches() is True
    assert diffs[1] == ReplayDiff(1, "lookup", {"value": "old"}, {"value": "new"})
    assert diffs[1].matches() is False


def test_replay_survives_flush_because_run_retains_events(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["docs"], "kwargs": {}})
                span.record_tool_result({"hits": 1})

        client.flush()
        assert client._pending_events == {}

        replay = run.replay()
        assert [step.event_type for step in replay] == [
            "tool_arguments",
            "tool_result",
        ]


def test_replay_from_payload_reconstructs_full_run(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(
            user_input=True,
            tool_arguments=True,
            tool_results=True,
            final_response=True,
        ),
    )

    with client.session() as session:
        with session.run("agent") as run:
            run.record_user_input("what is rag?")
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["rag"], "kwargs": {}})
                span.record_tool_result({"hits": 2})
            run.record_final_response("explanation")

    payload = client.last_flushed_payload
    assert payload is not None
    assert payload["events"], "events should be in the payload"

    reconstructed = Run.from_payload(payload, run_id=run.id)

    assert isinstance(reconstructed, Run)
    assert reconstructed.id == run.id
    assert len(reconstructed._spans) == len(run._spans)
    assert len(reconstructed._events) == len(run._events)

    replay = reconstructed.replay()
    assert [step.event_type for step in replay] == [
        "user_input",
        "tool_arguments",
        "tool_result",
        "final_response",
    ]


def test_replay_from_payload_preserves_parent_child_relationships(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("planner", kind=SpanKind.AGENT) as parent:
                with parent.span("search", kind=SpanKind.TOOL) as child:
                    child.record_tool_arguments({"args": ["docs"], "kwargs": {}})
                    child.record_tool_result({"hits": 1})

    payload = client.last_flushed_payload
    assert payload is not None

    reconstructed = Run.from_payload(payload, run_id=run.id)

    [planner, search] = reconstructed._spans
    assert search.parent_span_id == planner.id

    replay = reconstructed.replay()
    assert [step.span_name for step in replay] == ["search", "search"]
    assert all(step.span_id is not None for step in replay)


def test_replay_from_payload_unknown_run_raises(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session():
        pass

    payload = client.last_flushed_payload
    assert payload is not None

    with pytest.raises(KeyError, match="run .* was not found"):
        Run.from_payload(payload, run_id="00000000-0000-0000-0000-000000000000")


def test_replay_from_payload_re_executes_tools(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    received: list[dict] = []

    def add(records: list[dict]) -> int:
        received.extend(records)
        return len(records)

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("add", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments(
                    {"args": [[{"id": 1}, {"id": 2}]], "kwargs": {}},
                )
                span.record_tool_result(2)

    payload = client.last_flushed_payload
    assert payload is not None
    reconstructed = Run.from_payload(payload, run_id=run.id)

    replay = reconstructed.replay(tools={"add": add})
    replayed = replay.replay()
    assert replayed == [2]
    assert received == [{"id": 1}, {"id": 2}]


def test_replay_with_no_steps_is_empty_and_falsy(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("planner", kind=SpanKind.AGENT):
                pass

    replay = run.replay()
    assert bool(replay) is False
    assert len(replay) == 0
    assert replay.steps() == []
    assert replay.tool_calls() == []
    assert replay.replay() == []


def test_replay_async_tools_with_areplay(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    async def search(query: str) -> dict[str, str]:
        await asyncio.sleep(0)
        return {"query": query}

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["docs"], "kwargs": {}})
                span.record_tool_result({"query": "docs"})

    replay = run.replay(tools={"search": search})
    replayed = asyncio.run(replay.areplay())
    assert replayed == [{"query": "docs"}]


def test_replay_via_trace_tool_decorator(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    seen: list[str] = []

    def lookup(item: str) -> str:
        seen.append(item)
        return f"value-for-{item}"

    with client.session() as session:
        with session.run("agent") as run:
            @run.trace_tool(name="lookup")
            def trace_lookup(item: str) -> str:
                return lookup(item)

            assert trace_lookup("alpha") == "value-for-alpha"

    replay = run.replay(tools={"lookup": lookup})
    assert [step.event_type for step in replay] == [
        "tool_arguments",
        "tool_result",
    ]
    results = replay.replay()
    assert results == ["value-for-alpha"]
    assert seen == ["alpha", "alpha"]


def test_replay_payload_contains_tool_call_content(mock_ingest_endpoint):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(tool_arguments=True, tool_results=True),
    )

    with client.session() as session:
        with session.run("agent") as run:
            with run.span("search", kind=SpanKind.TOOL) as span:
                span.record_tool_arguments({"args": ["docs"], "kwargs": {}})
                span.record_tool_result({"hits": 1})

    body = _json_loads(mock_ingest_endpoint.calls[-1].request.content)
    events = [e for e in body["events"] if e["type"] == "tool_arguments"]
    assert events, "tool_arguments event should be sent in the payload"

    reconstructed = Run.from_payload(body, run_id=run.id)
    [call] = reconstructed.replay().tool_calls()
    assert call.content == {"args": ["docs"], "kwargs": {}}
    assert isinstance(call.span_id, UUID)

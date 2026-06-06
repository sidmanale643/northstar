from northstar import CaptureOptions, Northstar, SpanKind


def test_complete_agent_run_serializes_span_tree_and_optional_content(
    mock_ingest_endpoint,
):
    client = Northstar(
        api_key="test-key",
        endpoint="https://api.northstar.test",
        capture=CaptureOptions(
            user_input=True,
            system_messages=True,
            reasoning=True,
            tool_arguments=True,
            tool_results=True,
            final_response=True,
        ),
    )

    with client.session(metadata={"source": "test"}) as session:
        with session.run("research-agent") as run:
            run.record_user_input("Compare two tracing SDK designs.")
            run.record_system_message("Use public documentation only.")

            for iteration in (1, 2):
                with run.span(
                    f"iteration-{iteration}",
                    kind=SpanKind.AGENT,
                    iteration=iteration,
                ) as agent_span:
                    with agent_span.span(
                        "responses.create",
                        kind=SpanKind.MODEL,
                        iteration=iteration,
                        attributes={
                            "provider": "openai",
                            "requested_model": "example-model",
                            "response_model": "example-model",
                            "input_tokens": 100 * iteration,
                            "output_tokens": 25 * iteration,
                            "reasoning_tokens": 10 * iteration,
                            "cost_amount": 0.001 * iteration,
                            "cost_currency": "USD",
                        },
                    ) as model_span:
                        model_span.record_reasoning(
                            {"summary": f"exposed reasoning {iteration}"},
                        )

                    with agent_span.span(
                        "search-docs",
                        kind=SpanKind.TOOL,
                        iteration=iteration,
                        attributes={"tool_type": "http"},
                    ) as tool_span:
                        tool_span.record_tool_arguments(
                            {"query": f"tracing sdk {iteration}"},
                        )
                        tool_span.record_tool_result({"matches": iteration})

            run.record_final_response("Use normalized spans and explicit capture.")

    batch = client.last_flushed_payload
    assert batch is not None
    assert batch["schema_version"] == 2
    assert len(batch["sessions"]) == 1
    assert len(batch["runs"]) == 1
    assert batch["runs"][0]["status"] == "ok"
    assert len(batch["spans"]) == 6

    spans = {span["name"]: span for span in batch["spans"]}
    assert spans["iteration-1"]["kind"] == "agent"
    assert spans["iteration-2"]["iteration"] == 2

    model_spans = [span for span in batch["spans"] if span["kind"] == "model"]
    assert model_spans[0]["parent_span_id"] == spans["iteration-1"]["id"]
    assert model_spans[0]["attributes"]["input_tokens"] == 100
    assert model_spans[0]["attributes"]["cost_amount"] == 0.001

    tool_spans = [span for span in batch["spans"] if span["kind"] == "tool"]
    assert tool_spans[1]["parent_span_id"] == spans["iteration-2"]["id"]
    assert tool_spans[1]["attributes"] == {"tool_type": "http"}

    assert [event["type"] for event in batch["events"]] == [
        "user_input",
        "system_message",
        "reasoning",
        "tool_arguments",
        "tool_result",
        "reasoning",
        "tool_arguments",
        "tool_result",
        "final_response",
    ]

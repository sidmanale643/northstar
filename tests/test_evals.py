import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from northstar.evals import (
    BinaryJudgeOutput,
    BadToolFailureRecovery,
    CaseStatus,
    Contains,
    CostUnder,
    Dataset,
    DEFAULT_RUBRIC_JUDGE_MODEL,
    EvalSuite,
    FaithfulnessJudge,
    FailureOrigin,
    ForbiddenTools,
    GroundTruthMatch,
    GradeStatus,
    HallucinatedToolResultJudge,
    InvalidStateTransition,
    JudgeScoringConfig,
    LatencyUnder,
    MaxToolCalls,
    NotContains,
    PlanningActionMismatchJudge,
    PythonCodeGrader,
    RetrievalPrecisionRecall,
    RequiredTools,
    RegexGrader,
    RubricJudge,
    StaleContextUsage,
    StepCostAttribution,
    ToolArgumentsMatch,
    ToolOutputReferenced,
    ToolSequence,
    TypeScriptCodeGrader,
    UnnecessaryToolLoop,
    grader_plan,
    normalize_messages,
    normalize_trace_payload,
    numeric_judge_output_model,
)
from northstar.evals.graders import (
    JudgeAuthenticationError,
    _check_judge_prerequisites,
    _judge_failure_message,
    _required_api_key_env,
)


def write_jsonl(path, rows):
    path.write_text(
        "\n".join(json.dumps(row) for row in rows),
        encoding="utf-8",
    )


def write_json(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def one_case(**overrides):
    record = {
        "id": "case-1",
        "messages": [{"role": "assistant", "content": "hello"}],
    }
    record.update(overrides)
    return Dataset.from_records([record]).cases[0]


def trace_payload(
    *,
    spans=None,
    events=None,
    run_error=None,
):
    return {
        "schema_version": 1,
        "sessions": [
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "created_at": "2026-01-01T00:00:00+00:00",
                "metadata": {},
            }
        ],
        "runs": [
            {
                "id": "00000000-0000-0000-0000-000000000002",
                "session_id": "00000000-0000-0000-0000-000000000001",
                "name": "agent",
                "started_at": "2026-01-01T00:00:00+00:00",
                "ended_at": "2026-01-01T00:00:05+00:00",
                "status": "error" if run_error else "ok",
                "error": run_error,
                "metadata": {"cost_usd": 0.03},
            }
        ],
        "spans": spans or [],
        "events": events or [],
    }


def trace_span(
    span_id,
    name,
    *,
    kind="tool",
    parent_span_id=None,
    status="ok",
    error=None,
    started_at="2026-01-01T00:00:01+00:00",
    attributes=None,
):
    return {
        "id": span_id,
        "run_id": "00000000-0000-0000-0000-000000000002",
        "parent_span_id": parent_span_id,
        "kind": kind,
        "name": name,
        "started_at": started_at,
        "ended_at": "2026-01-01T00:00:02+00:00",
        "status": status,
        "error": error,
        "attributes": attributes or {},
    }


def trace_event(
    event_id,
    event_type,
    *,
    span_id=None,
    content=None,
    attributes=None,
    created_at="2026-01-01T00:00:02+00:00",
):
    return {
        "id": event_id,
        "run_id": "00000000-0000-0000-0000-000000000002",
        "span_id": span_id,
        "type": event_type,
        "created_at": created_at,
        "content": content,
        "attributes": attributes or {},
    }


def test_jsonl_loader_requires_only_id_and_messages(tmp_path):
    dataset_path = tmp_path / "dataset.jsonl"
    write_jsonl(dataset_path, [{"id": "case-1", "messages": []}])

    dataset = Dataset.from_jsonl(dataset_path)

    assert len(dataset.cases) == 1
    assert dataset.cases[0].id == "case-1"
    assert dataset.cases[0].expected.goal is None


def test_json_loader_accepts_array_cases_and_single_case(tmp_path):
    array_path = tmp_path / "array.json"
    single_path = tmp_path / "single.json"
    write_json(
        array_path,
        [
            {"id": "case-1", "messages": []},
            {"id": "case-2", "messages": []},
        ],
    )
    write_json(single_path, {"id": "case-3", "messages": []})

    assert [case.id for case in Dataset.from_json(array_path)] == ["case-1", "case-2"]
    assert [case.id for case in Dataset.from_json(single_path)] == ["case-3"]


def test_json_loader_accepts_object_with_cases(tmp_path):
    dataset_path = tmp_path / "dataset.json"
    write_json(
        dataset_path,
        {"cases": [{"id": "case-1", "messages": []}]},
    )

    dataset = Dataset.from_path(dataset_path)

    assert len(dataset) == 1
    assert dataset.cases[0].id == "case-1"


def test_dataset_loaders_report_invalid_json_and_validation_errors(tmp_path):
    bad_jsonl = tmp_path / "bad.jsonl"
    bad_json = tmp_path / "bad.json"
    bad_case = tmp_path / "bad-case.json"
    unsupported = tmp_path / "dataset.csv"

    bad_jsonl.write_text('{"id": "case-1"', encoding="utf-8")
    bad_json.write_text('{"cases": [', encoding="utf-8")
    write_json(bad_case, {"id": "case-1"})
    unsupported.write_text("id,messages\n", encoding="utf-8")

    with pytest.raises(ValueError, match="line 1"):
        Dataset.from_jsonl(bad_jsonl)
    with pytest.raises(ValueError, match="Invalid JSON dataset"):
        Dataset.from_json(bad_json)
    with pytest.raises(ValueError, match="Invalid eval case"):
        Dataset.from_json(bad_case)
    with pytest.raises(ValueError, match="Unsupported eval dataset format"):
        Dataset.from_path(unsupported)


def test_normalize_messages_extracts_openai_style_transcript():
    run = normalize_messages(
        [
            {"role": "system", "content": "You are concise."},
            {"role": "user", "content": "Find the refund policy."},
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
            {
                "role": "tool",
                "tool_call_id": "call-1",
                "name": "search_docs",
                "content": "Refunds are available for 30 days.",
            },
            {
                "role": "assistant",
                "content": [{"type": "text", "text": "The refund window is 30 days."}],
            },
        ]
    )

    assert run.system_prompts == ["You are concise."]
    assert run.user_messages == ["Find the refund policy."]
    assert run.final_response == "The refund window is 30 days."
    assert [tool.name for tool in run.tool_calls] == ["search_docs"]
    assert run.tool_calls[0].arguments == '{"query":"refund policy"}'
    assert run.tool_outputs[0].tool_call_id == "call-1"
    assert run.tool_outputs[0].name == "search_docs"
    assert run.tool_interactions[0].call.name == "search_docs"
    assert run.tool_interactions[0].output.content == "Refunds are available for 30 days."


def test_normalize_trace_payload_builds_grader_dag():
    parent_id = "00000000-0000-0000-0000-000000000010"
    child_id = "00000000-0000-0000-0000-000000000011"
    arg_event_id = "00000000-0000-0000-0000-000000000020"
    result_event_id = "00000000-0000-0000-0000-000000000021"
    payload = trace_payload(
        spans=[
            trace_span(parent_id, "planner", kind="agent"),
            trace_span(child_id, "search", parent_span_id=parent_id),
        ],
        events=[
            trace_event(
                arg_event_id,
                "tool_arguments",
                span_id=child_id,
                content={"args": ["docs"], "kwargs": {"limit": 2}},
                created_at="2026-01-01T00:00:02+00:00",
            ),
            trace_event(
                result_event_id,
                "tool_result",
                span_id=child_id,
                content={"hits": [{"id": "doc-1"}]},
                created_at="2026-01-01T00:00:03+00:00",
            ),
        ],
    )

    dag = normalize_trace_payload(payload, "00000000-0000-0000-0000-000000000002")

    assert dag.run.run_id == "00000000-0000-0000-0000-000000000002"
    assert [span.name for span in dag.spans] == ["planner", "search"]
    assert dag.spans[1].parent_span_id == parent_id
    assert [event.type for event in dag.events] == ["tool_arguments", "tool_result"]
    assert dag.events[0].content["kwargs"]["limit"] == 2
    assert dag.events[1].content["hits"][0]["id"] == "doc-1"
    assert {"parent_child", "span_event", "next_event"} <= {
        edge.kind for edge in dag.edges
    }


def test_default_eval_suite_runs_deterministic_field_driven_graders():
    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "type": "function",
                                "function": {
                                    "name": "search_docs",
                                    "arguments": json.dumps(
                                        {"query": "refund policy", "limit": 3}
                                    ),
                                },
                        }
                    ],
                },
                {
                    "role": "tool",
                    "tool_call_id": "call-1",
                    "name": "search_docs",
                    "content": "Refunds are available for 30 days.",
                },
                {
                    "role": "assistant",
                    "content": "Refunds are available for 30 days.",
                },
                ],
                "expected": {
                    "max_tool_calls": 1,
                    "required_tools": ["search_docs"],
                    "forbidden_tools": ["delete_file"],
                    "tool_sequence": ["search_docs"],
                    "tool_arguments": [
                        {"name": "search_docs", "arguments": {"query": "refund policy"}}
                    ],
                    "require_tool_output_reference": True,
                    "contains": ["refunds"],
                    "not_contains": ["wire transfer"],
                    "ground_truth": "refunds are available for 30 days",
                    "max_latency_ms": 10,
                    "max_cost_usd": 0.03,
                },
                "metrics": {"latency_ms": 8, "cost_usd": 0.02},
            }
        ]
    )

    result = EvalSuite().run(dataset)

    assert result.total_cases == 1
    assert result.evaluated_cases == 1
    assert result.passed_cases == 1
    assert result.failed_cases == 0
    assert result.pass_rate == 1.0
    assert result.skipped_grades == 0
    assert result.metadata["plan"] == "deterministic"
    assert "tool_sequence" in result.metadata["grader_names"]
    assert result.case_results[0].status == CaseStatus.PASSED
    assert {grade.status for grade in result.case_results[0].grades} == {
        GradeStatus.PASSED
    }


def test_graders_skip_when_their_dataset_fields_are_missing():
    case = one_case()
    run = normalize_messages(case.messages, metrics=case.metrics, metadata=case.metadata)

    grades = [
        MaxToolCalls().grade(case, run),
        RequiredTools().grade(case, run),
        ForbiddenTools().grade(case, run),
        ToolArgumentsMatch().grade(case, run),
        ToolSequence().grade(case, run),
        ToolOutputReferenced().grade(case, run),
        Contains().grade(case, run),
        NotContains().grade(case, run),
        GroundTruthMatch().grade(case, run),
        LatencyUnder().grade(case, run),
        CostUnder().grade(case, run),
    ]

    assert {grade.status for grade in grades} == {GradeStatus.SKIPPED}


def test_trace_graders_skip_when_trace_is_missing():
    case = one_case()
    run = normalize_messages(case.messages)

    grades = [
        BadToolFailureRecovery().grade(case, run),
        UnnecessaryToolLoop().grade(case, run),
        StaleContextUsage().grade(case, run),
        InvalidStateTransition().grade(case, run),
        RetrievalPrecisionRecall().grade(case, run),
        StepCostAttribution().grade(case, run),
        FailureOrigin().grade(case, run),
    ]

    assert {grade.status for grade in grades} == {GradeStatus.SKIPPED}


def test_trace_deterministic_graders_fail_on_evidence():
    tool_id = "00000000-0000-0000-0000-000000000030"
    model_id = "00000000-0000-0000-0000-000000000031"
    stale_event_id = "00000000-0000-0000-0000-000000000040"
    payload = trace_payload(
        spans=[
            trace_span(
                tool_id,
                "search",
                status="error",
                error={"type": "RuntimeError", "message": "timeout"},
            ),
            trace_span(
                model_id,
                "chat",
                kind="model",
                attributes={"cost_usd": 0.2, "input_tokens": 10, "output_tokens": 20},
            ),
        ],
        events=[
            trace_event(
                "00000000-0000-0000-0000-000000000041",
                "tool_arguments",
                span_id=tool_id,
                content={"query": "docs"},
                created_at="2026-01-01T00:00:01+00:00",
            ),
            trace_event(
                stale_event_id,
                "custom",
                content={"state": "search"},
                attributes={"stale_context": True},
                created_at="2026-01-01T00:00:04+00:00",
            ),
            trace_event(
                "00000000-0000-0000-0000-000000000042",
                "custom",
                content={"state": "answer"},
                created_at="2026-01-01T00:00:05+00:00",
            ),
        ],
    )
    case = one_case(
        trace=payload,
        expected={
            "trace": {
                "allowed_state_transitions": [
                    {"from_state": "plan", "to_state": "search"}
                ],
                "max_step_cost_usd": 0.1,
            }
        },
    )
    run = normalize_messages(
        case.messages,
        trace=normalize_trace_payload(payload, "00000000-0000-0000-0000-000000000002"),
    )

    assert BadToolFailureRecovery().grade(case, run).status == GradeStatus.FAILED
    assert StaleContextUsage().grade(case, run).metadata["event_ids"] == [
        stale_event_id
    ]
    assert InvalidStateTransition().grade(case, run).status == GradeStatus.FAILED
    cost_grade = StepCostAttribution().grade(case, run)
    assert cost_grade.status == GradeStatus.FAILED
    assert cost_grade.metadata["over_limit"][0]["span_id"] == model_id
    failure_grade = FailureOrigin().grade(case, run)
    assert failure_grade.status == GradeStatus.FAILED
    assert failure_grade.metadata["failure_origin_span"]["id"] == tool_id


def test_trace_deterministic_graders_pass_on_clean_evidence():
    tool_id = "00000000-0000-0000-0000-000000000050"
    model_id = "00000000-0000-0000-0000-000000000051"
    payload = trace_payload(
        spans=[
            trace_span(tool_id, "search"),
            trace_span(
                model_id,
                "chat",
                kind="model",
                attributes={"cost_usd": 0.02, "input_tokens": 10, "output_tokens": 20},
            ),
        ],
        events=[
            trace_event(
                "00000000-0000-0000-0000-000000000060",
                "tool_arguments",
                span_id=tool_id,
                content={"query": "docs"},
                created_at="2026-01-01T00:00:01+00:00",
            ),
            trace_event(
                "00000000-0000-0000-0000-000000000061",
                "tool_result",
                span_id=tool_id,
                content={"hits": [{"id": "doc-1"}, {"id": "doc-2"}]},
                created_at="2026-01-01T00:00:02+00:00",
            ),
            trace_event(
                "00000000-0000-0000-0000-000000000062",
                "tool_arguments",
                span_id=tool_id,
                content={"query": "faq"},
                created_at="2026-01-01T00:00:02.500000+00:00",
            ),
            trace_event(
                "00000000-0000-0000-0000-000000000063",
                "reasoning",
                content={"state": "plan"},
                created_at="2026-01-01T00:00:03+00:00",
            ),
            trace_event(
                "00000000-0000-0000-0000-000000000064",
                "custom",
                content={"state": "search"},
                created_at="2026-01-01T00:00:04+00:00",
            ),
        ],
    )
    case = one_case(
        trace=payload,
        expected={
            "trace": {
                "allowed_state_transitions": [
                    {"from_state": "plan", "to_state": "search"}
                ],
                "relevant_retrieval_ids": ["doc-1", "doc-2"],
                "min_retrieval_precision": 1,
                "min_retrieval_recall": 1,
                "max_step_cost_usd": 0.1,
            }
        },
    )
    run = normalize_messages(
        case.messages,
        trace=normalize_trace_payload(payload, "00000000-0000-0000-0000-000000000002"),
    )

    assert UnnecessaryToolLoop().grade(case, run).status == GradeStatus.PASSED
    assert StaleContextUsage().grade(case, run).status == GradeStatus.PASSED
    assert InvalidStateTransition().grade(case, run).status == GradeStatus.PASSED
    retrieval_grade = RetrievalPrecisionRecall().grade(case, run)
    assert retrieval_grade.status == GradeStatus.PASSED
    assert retrieval_grade.metadata["precision"] == 1.0
    assert StepCostAttribution().grade(case, run).status == GradeStatus.PASSED


def test_trace_loop_and_retrieval_graders_fail_on_thresholds():
    tool_id = "00000000-0000-0000-0000-000000000070"
    repeated_events = [
        trace_event(
            f"00000000-0000-0000-0000-00000000008{index}",
            "tool_arguments",
            span_id=tool_id,
            content={"query": "same"},
            created_at=f"2026-01-01T00:00:0{index}+00:00",
        )
        for index in range(4)
    ]
    payload = trace_payload(
        spans=[trace_span(tool_id, "search")],
        events=[
            *repeated_events,
            trace_event(
                "00000000-0000-0000-0000-000000000090",
                "tool_result",
                span_id=tool_id,
                content={"hits": [{"id": "doc-1"}, {"id": "irrelevant"}]},
                created_at="2026-01-01T00:00:05+00:00",
            ),
        ],
    )
    case = one_case(
        trace=payload,
        expected={
            "trace": {
                "relevant_retrieval_ids": ["doc-1", "doc-2"],
                "min_retrieval_precision": 1,
                "min_retrieval_recall": 1,
            }
        },
    )
    run = normalize_messages(
        case.messages,
        trace=normalize_trace_payload(payload, "00000000-0000-0000-0000-000000000002"),
    )

    loop_grade = UnnecessaryToolLoop().grade(case, run)
    assert loop_grade.status == GradeStatus.FAILED
    assert loop_grade.metadata["loop_signatures"][0]["count"] == 4
    retrieval_grade = RetrievalPrecisionRecall().grade(case, run)
    assert retrieval_grade.status == GradeStatus.FAILED
    assert retrieval_grade.metadata["true_positive_count"] == 1


def test_bad_tool_failure_recovery_passes_with_later_recovery_event():
    tool_id = "00000000-0000-0000-0000-000000000071"
    payload = trace_payload(
        spans=[
            trace_span(
                tool_id,
                "search",
                status="error",
                error={"type": "RuntimeError", "message": "timeout"},
            )
        ],
        events=[
            trace_event(
                "00000000-0000-0000-0000-000000000091",
                "tool_arguments",
                span_id=tool_id,
                content={"query": "docs"},
                created_at="2026-01-01T00:00:01+00:00",
            ),
            trace_event(
                "00000000-0000-0000-0000-000000000092",
                "final_response",
                content="Recovered with a fallback answer.",
                created_at="2026-01-01T00:00:04+00:00",
            ),
        ],
    )
    case = one_case(trace=payload)
    run = normalize_messages(
        case.messages,
        trace=normalize_trace_payload(payload, "00000000-0000-0000-0000-000000000002"),
    )

    assert BadToolFailureRecovery().grade(case, run).status == GradeStatus.PASSED


def test_trace_llm_judges_receive_bounded_trace_context():
    tool_id = "00000000-0000-0000-0000-000000000072"
    payload = trace_payload(
        spans=[trace_span(tool_id, "search")],
        events=[
            trace_event(
                "00000000-0000-0000-0000-000000000093",
                "tool_result",
                span_id=tool_id,
                content={"result": "Refunds are available for 30 days."},
            )
        ],
    )
    case = one_case(trace=payload, expected={"goal": "answer refund policy"})
    run = normalize_messages(
        [{"role": "assistant", "content": "Refunds are available for 30 days."}],
        trace=normalize_trace_payload(payload, "00000000-0000-0000-0000-000000000002"),
    )
    seen_contexts = []

    def completion(**kwargs):
        user_message = kwargs["messages"][1]["content"]
        context = json.loads(user_message)
        seen_contexts.append(context)
        assert "trace" in context
        assert len(context["trace"]["events"]) == 1
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 1,
                                "reason": "Tool result supports the answer.",
                                "feedback": "No fix needed.",
                                "evidence": ["tool_result: 30 days"],
                            }
                        )
                    }
                }
            ]
        }

    grades = [
        HallucinatedToolResultJudge(completion_fn=completion).grade(case, run),
        PlanningActionMismatchJudge(completion_fn=completion).grade(case, run),
    ]

    assert {grade.status for grade in grades} == {GradeStatus.PASSED}
    assert all(grade.metadata["trace_context_event_count"] == 1 for grade in grades)
    assert len(seen_contexts) == 2


def test_output_graders_fail_when_expected_output_is_missing():
    run = normalize_messages([{"role": "assistant", "content": None}])

    contains_case = one_case(
        messages=[{"role": "assistant", "content": None}],
        expected={"contains": ["refund"]},
    )
    not_contains_case = one_case(
        messages=[{"role": "assistant", "content": None}],
        expected={"not_contains": ["refund"]},
    )

    assert Contains().grade(contains_case, run).status == GradeStatus.FAILED
    assert NotContains().grade(not_contains_case, run).status == GradeStatus.FAILED


def test_limit_graders_read_thresholds_from_expected_fields():
    run = normalize_messages(
        [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [{"name": "search_docs", "arguments": {}}],
            }
        ]
    )
    passing = one_case(
        expected={
            "max_tool_calls": 1,
            "max_latency_ms": 10,
            "max_cost_usd": 0.03,
        },
        metrics={"latency_ms": 8, "cost_usd": 0.02},
    )
    failing = one_case(
        expected={
            "max_tool_calls": 0,
            "max_latency_ms": 7,
            "max_cost_usd": 0.01,
        },
        metrics={"latency_ms": 8, "cost_usd": 0.02},
    )
    missing_metrics = one_case(
        expected={"max_latency_ms": 7, "max_cost_usd": 0.01},
    )

    assert MaxToolCalls().grade(passing, run).status == GradeStatus.PASSED
    assert LatencyUnder().grade(passing, run).status == GradeStatus.PASSED
    assert CostUnder().grade(passing, run).status == GradeStatus.PASSED
    assert MaxToolCalls().grade(failing, run).status == GradeStatus.FAILED
    assert LatencyUnder().grade(failing, run).status == GradeStatus.FAILED
    assert CostUnder().grade(failing, run).status == GradeStatus.FAILED
    assert LatencyUnder().grade(missing_metrics, run).status == GradeStatus.FAILED
    assert CostUnder().grade(missing_metrics, run).status == GradeStatus.FAILED


def test_ground_truth_match_uses_normalized_substring_matching():
    matching_case = one_case(
        messages=[
            {
                "role": "assistant",
                "content": "Refunds   are AVAILABLE for\n30 days.",
            }
        ],
        expected={"ground_truth": "refunds are available for 30 days"},
    )
    mismatched_case = one_case(
        messages=[{"role": "assistant", "content": "No details."}],
        expected={"ground_truth": "refunds are available for 30 days"},
    )

    assert (
        GroundTruthMatch()
        .grade(matching_case, normalize_messages(matching_case.messages))
        .status
        == GradeStatus.PASSED
    )
    assert (
        GroundTruthMatch()
        .grade(mismatched_case, normalize_messages(mismatched_case.messages))
        .status
        == GradeStatus.FAILED
    )


def test_tool_arguments_match_uses_expected_argument_subset():
    matching_case = one_case(
        messages=[
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "calculator",
                            "arguments": json.dumps(
                                {"expression": "19 + 23", "precision": 0}
                            ),
                        },
                    }
                ],
            }
        ],
        expected={
            "tool_arguments": [
                {
                    "name": "calculator",
                    "arguments": {"expression": "19 + 23"},
                }
            ]
        },
    )
    wrong_value = one_case(
        messages=[
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "calculator",
                            "arguments": json.dumps({"expression": "19 + 24"}),
                        },
                    }
                ],
            }
        ],
        expected={
            "tool_arguments": [
                {
                    "name": "calculator",
                    "arguments": {"expression": "19 + 23"},
                }
            ]
        },
    )
    missing_tool = one_case(
        messages=[{"role": "assistant", "content": "No tools."}],
        expected={
            "tool_arguments": [
                {
                    "name": "calculator",
                    "arguments": {"expression": "19 + 23"},
                }
            ]
        },
    )

    assert (
        ToolArgumentsMatch()
        .grade(matching_case, normalize_messages(matching_case.messages))
        .status
        == GradeStatus.PASSED
    )
    assert (
        ToolArgumentsMatch().grade(wrong_value, normalize_messages(wrong_value.messages)).status
        == GradeStatus.FAILED
    )
    assert (
        ToolArgumentsMatch()
        .grade(missing_tool, normalize_messages(missing_tool.messages))
        .status
        == GradeStatus.FAILED
    )


def test_tool_sequence_requires_exact_trajectory_order():
    matching_case = one_case(
        messages=[
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {"function": {"name": "search_docs", "arguments": "{}"}},
                    {"function": {"name": "summarize", "arguments": "{}"}},
                ],
            }
        ],
        expected={"tool_sequence": ["search_docs", "summarize"]},
    )
    mismatched_case = one_case(
        messages=matching_case.messages,
        expected={"tool_sequence": ["summarize", "search_docs"]},
    )

    assert (
        ToolSequence().grade(matching_case, normalize_messages(matching_case.messages)).status
        == GradeStatus.PASSED
    )
    assert (
        ToolSequence()
        .grade(mismatched_case, normalize_messages(mismatched_case.messages))
        .status
        == GradeStatus.FAILED
    )


def test_tool_output_referenced_scores_grounding_overlap():
    grounded_case = one_case(
        messages=[
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "function": {"name": "search_docs", "arguments": "{}"},
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "call-1",
                "name": "search_docs",
                "content": "Refunds are available for 30 days after purchase.",
            },
            {
                "role": "assistant",
                "content": "Refunds are available for 30 days after purchase.",
            },
        ],
        expected={"require_tool_output_reference": True},
    )
    ungrounded_case = one_case(
        messages=[
            *grounded_case.messages[:2],
            {"role": "assistant", "content": "Contact support for account setup."},
        ],
        expected={"require_tool_output_reference": True},
    )

    grounded = ToolOutputReferenced().grade(
        grounded_case,
        normalize_messages(grounded_case.messages),
    )
    ungrounded = ToolOutputReferenced().grade(
        ungrounded_case,
        normalize_messages(ungrounded_case.messages),
    )

    assert grounded.status == GradeStatus.PASSED
    assert grounded.score is not None and grounded.score >= grounded.threshold
    assert ungrounded.status == GradeStatus.FAILED
    assert ungrounded.score is not None and ungrounded.score < ungrounded.threshold


def test_skipped_grades_do_not_affect_case_status_or_pass_rate():
    dataset = Dataset.from_records(
        [
            {
                "id": "passed",
                "messages": [{"role": "assistant", "content": "Refunds are available."}],
                "expected": {"contains": ["refunds"]},
            },
            {
                "id": "failed",
                "messages": [{"role": "assistant", "content": "No details."}],
                "expected": {"contains": ["refunds"]},
            },
            {
                "id": "not-evaluated",
                "messages": [{"role": "assistant", "content": "No checks configured."}],
            },
        ]
    )

    result = EvalSuite(graders=[Contains(), RequiredTools()]).run(dataset)

    assert result.total_cases == 3
    assert result.evaluated_cases == 2
    assert result.not_evaluated_cases == 1
    assert result.passed_cases == 1
    assert result.failed_cases == 1
    assert result.pass_rate == 0.5
    assert result.skipped_grades == 4
    assert [case.status for case in result.case_results] == [
        CaseStatus.PASSED,
        CaseStatus.FAILED,
        CaseStatus.NOT_EVALUATED,
    ]


def test_rubric_judge_is_explicit_and_uses_injected_completion():
    calls = []

    def completion(**kwargs):
        calls.append(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 1.0,
                                "reason": "The goal was achieved.",
                                "feedback": "The response is complete.",
                            }
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "The refund window is 30 days."}],
                "expected": {"goal": "Explain the refund window."},
            }
        ]
    )

    result = EvalSuite(
        graders=[
            RubricJudge(
                "goal_achieved",
                model="gpt-4o-mini",
                completion_fn=completion,
            )
        ]
    ).run(dataset)

    grade = result.case_results[0].grades[0]
    assert calls[0]["model"] == "gpt-4o-mini"
    assert calls[0]["response_format"] is not BinaryJudgeOutput
    assert grade.status == GradeStatus.PASSED
    assert grade.reason == "The goal was achieved."
    assert grade.feedback == "The response is complete."
    assert grade.score == 1.0
    assert grade.threshold == 0.5
    assert grade.metadata["judge_model"] == "gpt-4o-mini"


def test_rubric_judge_prompt_sets_grading_boundaries():
    captured = {}

    def completion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 1.0,
                                "reason": "The answer satisfies the rubric.",
                                "feedback": "No change needed.",
                            }
                        )
                    }
                }
            ]
        }

    case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are available for 30 days."}],
        expected={
            "goal": "Explain refunds.",
            "rubric": "Pass if the response gives the refund window.",
            "context": ["Refunds are available for 30 days."],
        },
    )

    RubricJudge(
        "answer_quality",
        completion_fn=completion,
    ).grade(case, normalize_messages(case.messages))

    system_prompt = captured["messages"][0]["content"]
    assert "Judge only the supplied final_response" in system_prompt
    assert "Do not reward unsupported claims" in system_prompt
    assert "`feedback` must be non-empty, actionable" in system_prompt
    assert "Use the full scale" in system_prompt


def test_faithfulness_judge_prompt_penalizes_unsupported_claims():
    captured = {}

    def completion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 0.2,
                                "reason": "The answer invents unsupported terms.",
                                "feedback": "Remove claims absent from the context.",
                            }
                        )
                    }
                }
            ]
        }

    case = one_case(
        messages=[{"role": "assistant", "content": "Refunds include crypto rebates."}],
        expected={"context": ["Refunds are available for 30 days."]},
    )

    FaithfulnessJudge(completion_fn=completion).grade(
        case,
        normalize_messages(case.messages),
    )

    system_prompt = captured["messages"][0]["content"]
    assert "Judge only whether final_response is supported" in system_prompt
    assert "claims that are not supported by those sources as failures" in system_prompt
    assert "copied or summarized from the supplied inputs" in system_prompt


def test_rubric_judge_accepts_score_confidence_and_evidence():
    def completion(**kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 0.82,
                                "confidence": 0.74,
                                "reason": "The answer is mostly complete.",
                                "feedback": "Tighten citation coverage.",
                                "evidence": ["refund window is 30 days"],
                            }
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "Refunds are 30 days."}],
                "expected": {"goal": "Explain refunds."},
            }
        ]
    )

    grade = EvalSuite(
        graders=[
            RubricJudge(
                "goal_achieved",
                model="gpt-4o-mini",
                completion_fn=completion,
                threshold=0.8,
            )
        ]
    ).run(dataset).case_results[0].grades[0]

    assert grade.status == GradeStatus.PASSED
    assert grade.score == 0.82
    assert grade.threshold == 0.8
    assert grade.confidence == 0.74
    assert grade.evidence == ["refund window is 30 days"]


def test_eval_suite_runs_multiple_named_rubric_judges_independently():
    def completion(**kwargs):
        passed = kwargs["model"] == "strict-model"
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "passed": passed,
                                "reason": "Checked by the configured judge.",
                                "feedback": "Review the judge-specific result.",
                            }
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "Refunds are 30 days."}],
                "expected": {"goal": "Explain refunds."},
            }
        ]
    )

    result = EvalSuite(
        graders=[
            RubricJudge(
                "strict_quality",
                model="strict-model",
                completion_fn=completion,
                scoring=JudgeScoringConfig(mode="binary"),
            ),
            RubricJudge(
                "format_gate",
                model="format-model",
                completion_fn=completion,
                scoring=JudgeScoringConfig(mode="binary"),
            ),
        ]
    ).run(dataset)

    grades = result.case_results[0].grades
    assert [grade.name for grade in grades] == ["strict_quality", "format_gate"]
    assert [grade.status for grade in grades] == [
        GradeStatus.PASSED,
        GradeStatus.FAILED,
    ]
    assert grades[0].metadata["judge_model"] == "strict-model"
    assert grades[1].metadata["judge_model"] == "format-model"


def test_rubric_judge_binary_scoring_accepts_pass_fail_label():
    def completion(**kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "passed": True,
                                "label": "safe",
                                "reason": "The answer avoids unsafe details.",
                                "feedback": "No change needed.",
                            }
                        )
                    }
                }
            ]
        }

    case = one_case(
        messages=[{"role": "assistant", "content": "I can explain safe alternatives."}],
    )
    grade = RubricJudge(
        "safety_gate",
        rubric="Pass only if the answer avoids unsafe instructions.",
        completion_fn=completion,
        scoring=JudgeScoringConfig(mode="binary"),
    ).grade(case, normalize_messages(case.messages))

    assert grade.status == GradeStatus.PASSED
    assert grade.score == 1.0
    assert grade.threshold == 1.0
    assert grade.label == "safe"
    assert grade.metadata["scoring_mode"] == "binary"
    assert grade.metadata["raw_score"] == 1.0
    assert grade.metadata["scale"] == [0.0, 1.0]


def test_rubric_judge_numeric_scoring_normalizes_and_applies_threshold():
    def completion(**kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 4,
                                "reason": "The answer is correct and grounded.",
                                "feedback": "Add one more citation.",
                                "evidence": ["refunds are 30 days"],
                            }
                        )
                    }
                }
            ]
        }

    case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are available for 30 days."}],
    )
    grade = RubricJudge(
        "answer_quality",
        rubric="Grade correctness, faithfulness, and clarity.",
        completion_fn=completion,
        scoring=JudgeScoringConfig(
            mode="numeric",
            min_score=0,
            max_score=5,
            passing_score=4,
            labels={4: "good"},
        ),
    ).grade(case, normalize_messages(case.messages))

    assert grade.status == GradeStatus.PASSED
    assert grade.score == 0.8
    assert grade.threshold == 0.8
    assert grade.label == "good"
    assert grade.evidence == ["refunds are 30 days"]
    assert grade.metadata["raw_score"] == 4.0
    assert grade.metadata["passing_score"] == 4.0
    assert grade.metadata["scale"] == [0.0, 5.0]


def test_python_code_grader_passes_and_fails_from_boolean_return():
    passing_case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are available for 30 days."}],
    )
    failing_case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are unavailable."}],
    )
    grader = PythonCodeGrader(
        "python_output_check",
        "def validate(output, case, run):\n    return '30 days' in output",
    )

    assert grader.grade(passing_case, normalize_messages(passing_case.messages)).status == GradeStatus.PASSED
    assert grader.grade(failing_case, normalize_messages(failing_case.messages)).status == GradeStatus.FAILED


def test_python_code_grader_accepts_structured_return():
    case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are available for 30 days."}],
    )
    grader = PythonCodeGrader(
        "python_structured",
        "\n".join(
            [
                "def validate(output, case, run):",
                "    return {",
                "        'passed': True,",
                "        'reason': 'Output includes refund timing.',",
                "        'feedback': 'No change needed.',",
                "        'score': 0.9,",
                "        'metadata': {'case_id': case['id']},",
                "    }",
            ]
        ),
    )

    grade = grader.grade(case, normalize_messages(case.messages))

    assert grade.status == GradeStatus.PASSED
    assert grade.reason == "Output includes refund timing."
    assert grade.feedback == "No change needed."
    assert grade.score == 0.9
    assert grade.metadata["case_id"] == "case-1"


def test_typescript_code_grader_passes_and_fails_from_boolean_return():
    passing_case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are available for 30 days."}],
    )
    failing_case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are unavailable."}],
    )
    grader = TypeScriptCodeGrader(
        "typescript_output_check",
        "export function validate(output, evalCase, run) {\n  return output.includes('30 days')\n}",
    )

    assert grader.grade(passing_case, normalize_messages(passing_case.messages)).status == GradeStatus.PASSED
    assert grader.grade(failing_case, normalize_messages(failing_case.messages)).status == GradeStatus.FAILED


def test_regex_grader_matches_configured_target():
    passing_case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are available for 30 days."}],
    )
    failing_case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are unavailable."}],
    )
    grader = RegexGrader("regex_refund_window", r"refunds.+30 days", flags=["ignorecase"])

    assert grader.grade(passing_case, normalize_messages(passing_case.messages)).status == GradeStatus.PASSED
    assert grader.grade(failing_case, normalize_messages(failing_case.messages)).status == GradeStatus.FAILED


def test_code_grader_errors_and_invalid_returns_fail_grade():
    case = one_case(messages=[{"role": "assistant", "content": "hello"}])
    run = normalize_messages(case.messages)

    error_grade = PythonCodeGrader(
        "python_error",
        "def validate(output, case, run):\n    raise RuntimeError('broken')",
    ).grade(case, run)
    invalid_grade = PythonCodeGrader(
        "python_invalid",
        "def validate(output, case, run):\n    return {'reason': 'missing passed'}",
    ).grade(case, run)

    assert error_grade.status == GradeStatus.FAILED
    assert error_grade.metadata["error_type"] == "RuntimeError"
    assert invalid_grade.status == GradeStatus.FAILED
    assert invalid_grade.reason == "Custom grader returned an invalid result."


def test_eval_suite_runs_multiple_custom_graders_with_deterministic_graders():
    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "Refunds are available for 30 days."}],
                "expected": {"contains": ["Refunds"]},
            }
        ]
    )

    result = EvalSuite(
        graders=[
            Contains(),
            RegexGrader("regex_refund_window", r"30 days"),
            PythonCodeGrader(
                "python_non_empty",
                "def validate(output, case, run):\n    return bool(output)",
            ),
        ],
        plan="custom",
    ).run(dataset)

    grades = result.case_results[0].grades
    assert [grade.name for grade in grades] == [
        "contains",
        "regex_refund_window",
        "python_non_empty",
    ]
    assert {grade.status for grade in grades} == {GradeStatus.PASSED}


def test_rubric_judge_numeric_scoring_rejects_out_of_range_score():
    def completion(**kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 6,
                                "reason": "The answer is excellent.",
                                "feedback": "No changes.",
                            }
                        )
                    }
                }
            ]
        }

    case = one_case(
        messages=[{"role": "assistant", "content": "Refunds are available for 30 days."}],
    )
    grade = RubricJudge(
        "answer_quality",
        rubric="Grade correctness, faithfulness, and clarity.",
        completion_fn=completion,
        scoring=JudgeScoringConfig(
            mode="numeric",
            min_score=0,
            max_score=5,
            passing_score=4,
        ),
    ).grade(case, normalize_messages(case.messages))

    assert grade.status == GradeStatus.FAILED
    assert grade.reason == "LLM judge returned invalid JSON."
    assert grade.feedback == "The judge response did not include valid pass/fail feedback."
    assert grade.metadata["raw_response"]


def test_numeric_judge_scoring_requires_passing_score():
    with pytest.raises(ValueError, match="passing_score is required"):
        JudgeScoringConfig(mode="numeric", min_score=0, max_score=5)


def test_faithfulness_judge_grades_context_without_goal_or_rubric():
    def completion(**kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 0.2,
                                "reason": "The answer invents unsupported terms.",
                                "feedback": "Remove claims absent from the context.",
                            }
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "Refunds include crypto rebates."}],
                "expected": {"context": ["Refunds are available for 30 days."]},
            }
        ]
    )

    grade = EvalSuite(
        graders=[
            FaithfulnessJudge(
                completion_fn=completion,
            )
        ]
    ).run(dataset).case_results[0].grades[0]

    assert grade.status == GradeStatus.FAILED
    assert grade.score == 0.2
    assert grade.threshold == 0.7


def test_named_grader_plans_are_available():
    assert [grader.name for grader in grader_plan("deterministic")] == [
        "max_tool_calls",
        "required_tools",
        "forbidden_tools",
        "tool_arguments_match",
        "tool_sequence",
        "tool_output_referenced",
        "contains",
        "not_contains",
        "ground_truth_match",
        "latency_under",
        "cost_under",
    ]
    assert grader_plan("quality")[-1].name == "rubric_judge"
    assert grader_plan("agentic")[-1].name == "faithfulness_judge"
    assert [grader.name for grader in grader_plan("trace")] == [
        "bad_tool_failure_recovery",
        "unnecessary_tool_loop",
        "stale_context_usage",
        "invalid_state_transition",
        "retrieval_precision_recall",
        "step_cost_attribution",
        "failure_origin",
        "hallucinated_tool_result_judge",
        "planning_action_mismatch_judge",
    ]


def test_rubric_judge_defaults_to_openrouter_deepseek_v4_flash_model():
    calls = []

    def completion(**kwargs):
        calls.append(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 1.0,
                                "reason": "The goal was achieved.",
                                "feedback": "The response is complete.",
                            }
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "The refund window is 30 days."}],
                "expected": {"goal": "Explain the refund window."},
            }
        ]
    )

    EvalSuite(
        graders=[
            RubricJudge(
                "goal_achieved",
                completion_fn=completion,
            )
        ]
    ).run(dataset)

    assert DEFAULT_RUBRIC_JUDGE_MODEL == "openrouter/deepseek/deepseek-v4-flash"
    assert calls[0]["model"] == DEFAULT_RUBRIC_JUDGE_MODEL


def test_rubric_judge_fails_when_feedback_is_missing():
    def completion(**kwargs):
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=json.dumps(
                            {
                                "passed": True,
                                "reason": "Looks good.",
                            }
                        )
                    )
                )
            ]
        )

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "The refund window is 30 days."}],
                "expected": {"goal": "Explain the refund window."},
            }
        ]
    )

    result = EvalSuite(
        graders=[
            RubricJudge(
                "goal_achieved",
                model="gpt-4o-mini",
                completion_fn=completion,
            )
        ]
    ).run(dataset)

    grade = result.case_results[0].grades[0]
    assert grade.status == GradeStatus.FAILED
    assert grade.reason == "LLM judge returned invalid JSON."
    assert grade.feedback == "The judge response did not include valid pass/fail feedback."


def test_rubric_judge_passes_pydantic_schema_as_response_format():
    captured = {}

    def completion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "passed": True,
                                "reason": "ok",
                                "feedback": "fine",
                            }
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "hi"}],
                "expected": {"goal": "greet"},
            }
        ]
    )
    EvalSuite(
        graders=[
            RubricJudge(
                "rubric_judge",
                model="gpt-4o-mini",
                completion_fn=completion,
                scoring=JudgeScoringConfig(mode="binary"),
            )
        ]
    ).run(dataset)

    assert captured["response_format"] is BinaryJudgeOutput


def test_rubric_judge_numeric_response_format_enforces_score_range():
    captured = {}

    def completion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {"score": 4, "reason": "ok", "feedback": "fine"}
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "hi"}],
                "expected": {"goal": "greet"},
            }
        ]
    )
    EvalSuite(
        graders=[
            RubricJudge(
                "rubric_judge",
                model="gpt-4o-mini",
                completion_fn=completion,
                scoring=JudgeScoringConfig(
                    mode="numeric", min_score=0, max_score=5, passing_score=4
                ),
            )
        ]
    ).run(dataset)

    schema_model = captured["response_format"]
    assert schema_model is not BinaryJudgeOutput
    schema = schema_model.model_json_schema()
    score_schema = schema["properties"]["score"]
    assert score_schema["minimum"] == 0
    assert score_schema["maximum"] == 5


def test_rubric_judge_strips_ansi_codes_before_parsing():
    payload = json.dumps(
        {
            "passed": True,
            "reason": "ok",
            "feedback": "fine",
        }
    )

    def completion(**kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": (
                            "\x1b[1;31mGiven the input, here is the verdict:\x1b[0m\n"
                            f"{payload}\n\x1b[0m"
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "hi"}],
                "expected": {"goal": "greet"},
            }
        ]
    )
    grade = EvalSuite(
        graders=[
            RubricJudge(
                "rubric_judge",
                completion_fn=completion,
                scoring=JudgeScoringConfig(mode="binary"),
            )
        ]
    ).run(dataset).case_results[0].grades[0]

    assert grade.status == GradeStatus.PASSED
    assert grade.reason == "ok"


def test_judge_invalid_payload_returns_invalid_judge_result():
    def completion(**kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": "not even close to json \x1b[1;31mGiven\x1b[0m"
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "hi"}],
                "expected": {"goal": "greet"},
            }
        ]
    )
    grade = EvalSuite(
        graders=[
            RubricJudge(
                "rubric_judge",
                completion_fn=completion,
                scoring=JudgeScoringConfig(mode="binary"),
            )
        ]
    ).run(dataset).case_results[0].grades[0]

    assert grade.status == GradeStatus.FAILED
    assert grade.reason == "LLM judge returned invalid JSON."
    assert "raw_response" in grade.metadata


def test_binary_judge_output_rejects_missing_feedback():
    with pytest.raises(ValidationError):
        BinaryJudgeOutput.model_validate_json(
            json.dumps({"passed": True, "reason": "ok"})
        )


def test_binary_judge_output_rejects_empty_reason():
    with pytest.raises(ValidationError):
        BinaryJudgeOutput.model_validate_json(
            json.dumps({"passed": True, "reason": "   ", "feedback": "fine"})
        )


def test_numeric_judge_output_model_rejects_out_of_range_score():
    schema = numeric_judge_output_model(min_score=0, max_score=5)
    with pytest.raises(ValidationError):
        schema.model_validate_json(
            json.dumps({"score": 6, "reason": "ok", "feedback": "fine"})
        )


def test_numeric_judge_output_model_accepts_in_range_score():
    schema = numeric_judge_output_model(min_score=0, max_score=5)
    parsed = schema.model_validate_json(
        json.dumps({"score": 4, "reason": "ok", "feedback": "fine"})
    )
    assert parsed.score == 4
    assert parsed.confidence is None
    assert parsed.evidence == []


def test_faithfulness_judge_passes_pydantic_schema_as_response_format():
    captured = {}

    def completion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {"score": 0.9, "reason": "faithful", "feedback": "ok"}
                        )
                    }
                }
            ]
        }

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "hi"}],
                "expected": {"context": ["ctx"]},
            }
        ]
    )
    EvalSuite(
        graders=[FaithfulnessJudge(completion_fn=completion)]
    ).run(dataset)

    assert captured["response_format"] is not BinaryJudgeOutput
    schema = captured["response_format"].model_json_schema()
    assert schema["properties"]["score"]["minimum"] == 0.0
    assert schema["properties"]["score"]["maximum"] == 1.0


def test_required_api_key_env_maps_providers():
    assert _required_api_key_env("openrouter/openai/gpt-4o") == "OPENROUTER_API_KEY"
    assert _required_api_key_env("openai/gpt-4o") == "OPENAI_API_KEY"
    assert _required_api_key_env("anthropic/claude-3-5-sonnet") == "ANTHROPIC_API_KEY"
    assert _required_api_key_env("gemini/gemini-pro") == "GEMINI_API_KEY"
    assert _required_api_key_env("groq/llama-3.1-70b") == "GROQ_API_KEY"
    assert _required_api_key_env("mistral/mistral-large") == "MISTRAL_API_KEY"
    assert _required_api_key_env("cohere/command-r-plus") == "COHERE_API_KEY"
    assert _required_api_key_env("deepseek/deepseek-v4-flash") == "DEEPSEEK_API_KEY"
    assert _required_api_key_env("openrouter/deepseek/deepseek-v4-flash") == "OPENROUTER_API_KEY"
    assert _required_api_key_env("unknown-provider/some-model") is None


def test_required_api_key_env_maps_bare_model_names():
    assert _required_api_key_env("gpt-4o") == "OPENAI_API_KEY"
    assert _required_api_key_env("o1-mini") == "OPENAI_API_KEY"
    assert _required_api_key_env("claude-3-5-sonnet-20241022") == "ANTHROPIC_API_KEY"
    assert _required_api_key_env("gemini-1.5-pro") == "GEMINI_API_KEY"
    assert _required_api_key_env("text-embedding-3-small") == "OPENAI_API_KEY"
    assert _required_api_key_env("llama-3.1-70b") is None


def test_check_judge_prerequisites_raises_when_api_key_missing(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(JudgeAuthenticationError) as exc_info:
        _check_judge_prerequisites("openrouter/openai/gpt-oss-120b:free")
    message = str(exc_info.value)
    assert "OPENROUTER_API_KEY" in message
    assert "openrouter" in message


def test_check_judge_prerequisites_passes_when_api_key_set(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    _check_judge_prerequisites("openrouter/openai/gpt-oss-120b:free")


def test_check_judge_prerequisites_skipped_for_unknown_provider():
    _check_judge_prerequisites("ollama/llama3")


def test_rubric_judge_raises_when_api_key_missing(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    case = one_case(
        messages=[{"role": "assistant", "content": "hi"}],
        expected={"goal": "greet"},
    )
    with pytest.raises(JudgeAuthenticationError, match="OPENROUTER_API_KEY"):
        RubricJudge(
            "rubric_judge",
            model="openrouter/openai/gpt-oss-120b:free",
        ).grade(case, normalize_messages(case.messages))


def test_rubric_judge_skips_prerequisite_check_when_completion_fn_set(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    case = one_case(
        messages=[{"role": "assistant", "content": "hi"}],
        expected={"goal": "greet"},
    )

    def completion(**kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "score": 1.0,
                                "reason": "ok",
                                "feedback": "fine",
                            }
                        )
                    }
                }
            ]
        }

    grade = RubricJudge(
        "rubric_judge",
        model="openrouter/openai/gpt-oss-120b:free",
        completion_fn=completion,
    ).grade(case, normalize_messages(case.messages))
    assert grade.status == GradeStatus.PASSED


def test_judge_authentication_error_returns_actionable_feedback():
    class FakeAuthError(Exception):
        pass

    exc = FakeAuthError(
        'AuthenticationError: OpenrouterException - {"error":{"message":"Missing Authentication header","code":401}}'
    )
    reason, feedback = _judge_failure_message(exc, "openrouter/openai/gpt-oss-120b:free")
    assert "not authenticated" in reason
    assert "OPENROUTER_API_KEY" in feedback
    assert "401" in feedback


def test_judge_authentication_error_for_unknown_provider_omits_env_var_name():
    exc = Exception("401 unauthorized")
    reason, feedback = _judge_failure_message(exc, "some-obscure-provider/some-model")
    assert "not authenticated" in reason
    assert "API key" in feedback
    assert "401" in feedback


def test_judge_rate_limit_returns_actionable_feedback():
    exc = Exception("RateLimitError: 429 too many requests")
    reason, feedback = _judge_failure_message(exc, "openai/gpt-4o")
    assert "rate-limited" in reason
    assert "429" in feedback


def test_judge_context_window_returns_actionable_feedback():
    exc = Exception("context_length_exceeded: maximum context length is 8192")
    reason, feedback = _judge_failure_message(exc, "openai/gpt-4o")
    assert "context window" in reason


def test_judge_not_found_returns_actionable_feedback():
    exc = Exception("404 model not found")
    reason, feedback = _judge_failure_message(exc, "openai/gpt-5-pretend")
    assert "not found" in reason
    assert "openai" in feedback


def test_judge_unknown_error_falls_back_to_generic_feedback():
    exc = Exception("some weird error")
    reason, feedback = _judge_failure_message(exc, "openai/gpt-4o")
    assert "raised Exception" in reason
    assert feedback == "The LLM judge errored before producing feedback."


def test_eval_suite_returns_actionable_feedback_for_auth_error(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    def completion(**kwargs):
        raise Exception(
            'litellm.AuthenticationError: OpenrouterException - '
            '{"error":{"message":"Missing Authentication header","code":401}}'
        )

    dataset = Dataset.from_records(
        [
            {
                "id": "case-1",
                "messages": [{"role": "assistant", "content": "hi"}],
                "expected": {"goal": "greet"},
            }
        ]
    )
    grade = EvalSuite(
        graders=[
            RubricJudge(
                "rubric_judge",
                model="openrouter/openai/gpt-oss-120b:free",
                completion_fn=completion,
            )
        ]
    ).run(dataset).case_results[0].grades[0]

    assert grade.status == GradeStatus.FAILED
    assert "not authenticated" in grade.reason
    assert "OPENROUTER_API_KEY" in grade.feedback
    assert grade.metadata["judge_model"] == "openrouter/openai/gpt-oss-120b:free"
    assert grade.metadata["error_type"] == "Exception"

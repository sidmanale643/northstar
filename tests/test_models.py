from uuid import uuid4

import pytest
from pydantic import ValidationError

from northstar import (
    CaptureOptions,
    Event,
    EventType,
    Run,
    Score,
    Session,
    Span,
    SpanKind,
)


class TestCaptureOptions:
    def test_sensitive_categories_default_to_false(self):
        assert CaptureOptions().model_dump() == {
            "user_input": False,
            "system_messages": False,
            "assistant_messages": False,
            "reasoning": False,
            "tool_arguments": False,
            "tool_results": False,
            "final_response": False,
        }

    def test_can_enable_individual_categories(self):
        capture = CaptureOptions(
            assistant_messages=True,
            tool_arguments=True,
            final_response=True,
        )
        assert capture.assistant_messages is True
        assert capture.tool_arguments is True
        assert capture.final_response is True
        assert capture.tool_results is False


class TestSession:
    def test_serialization_omits_optional_fields(self):
        session = Session(metadata={"source": "test"})

        payload = session.to_payload()

        assert payload["metadata"] == {"source": "test"}
        assert "project_id" not in payload
        assert "ended_at" not in payload
        assert isinstance(payload["created_at"], str)

    def test_accepts_backend_assigned_project_id(self):
        project_id = uuid4()
        session = Session(project_id=project_id)

        assert session.project_id == project_id


class TestRun:
    def test_defaults_to_running_status(self):
        run = Run(session_id=uuid4(), name="research-agent")

        payload = run.to_payload()

        assert payload["status"] == "running"
        assert payload["metadata"] == {}
        assert "ended_at" not in payload
        assert "error" not in payload


class TestSpan:
    def test_serializes_enum_fields_and_attributes(self):
        span = Span(
            run_id=uuid4(),
            kind=SpanKind.MODEL,
            name="planner",
            attributes={"input_tokens": 123},
        )

        payload = span.to_payload()

        assert payload["kind"] == "model"
        assert payload["status"] == "running"
        assert payload["attributes"] == {"input_tokens": 123}
        assert "parent_span_id" not in payload
        assert "iteration" not in payload


class TestEvent:
    def test_serializes_nested_content(self):
        event = Event(
            run_id=uuid4(),
            span_id=uuid4(),
            type=EventType.TOOL_RESULT,
            content={"ok": True, "items": [1, 2]},
            attributes={"mime_type": "application/json"},
        )

        payload = event.to_payload()

        assert payload["type"] == "tool_result"
        assert payload["content"] == {"ok": True, "items": [1, 2]}
        assert payload["attributes"] == {"mime_type": "application/json"}


class TestScore:
    def test_serializes_categorical_score(self):
        trace_id = uuid4()
        score = Score(
            trace_id=trace_id,
            name="quality",
            value=0.0,
            data_type="categorical",
            string_value="excellent",
            comment="reviewed",
        )

        payload = score.to_payload()

        assert payload["trace_id"] == str(trace_id)
        assert payload["data_type"] == "categorical"
        assert payload["value"] == 0.0
        assert payload["string_value"] == "excellent"
        assert payload["source"] == "api"

    @pytest.mark.parametrize(
        ("data_type", "value", "string_value"),
        [
            ("categorical", 0.0, None),
            ("numeric", 0.5, "unexpected"),
            ("boolean", 0.5, None),
        ],
    )
    def test_rejects_incoherent_values(self, data_type, value, string_value):
        with pytest.raises(ValidationError):
            Score(
                trace_id=uuid4(),
                name="quality",
                value=value,
                data_type=data_type,
                string_value=string_value,
            )

    def test_rejects_blank_name_and_unknown_fields(self):
        with pytest.raises(ValidationError):
            Score(
                trace_id=uuid4(),
                name=" ",
                value=1.0,
                data_type="numeric",
                unknown=True,
            )

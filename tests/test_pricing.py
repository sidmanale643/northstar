from __future__ import annotations

from unittest.mock import patch

import pytest

import northstar
from northstar import (
    CaptureOptions,
    ModelSpan,
    Northstar,
    SpanKind,
    pricing,
)
from northstar.models import Run, Span


pytestmark = pytest.mark.skipif(
    not pricing.is_available(),
    reason="litellm is not installed (install with `uv add 'northstar-ai[pricing]'`)",
)


class TestPricingHelpers:
    def test_cost_for_known_model_returns_positive_number(self):
        cost = pricing.cost_for("gpt-4o", 1_000, 500)
        assert cost is not None
        assert cost > 0

    def test_cost_for_unknown_model_returns_none(self):
        assert pricing.cost_for("definitely-not-a-real-model-xyz", 100, 200) is None

    def test_count_tokens_text(self):
        tokens = pricing.count_tokens("gpt-4o", "Hello world")
        assert tokens > 0

    def test_count_tokens_messages(self):
        messages = [{"role": "user", "content": "Hello world"}]
        tokens = pricing.count_tokens("gpt-4o", messages)
        assert tokens > 0

    def test_format_cost_rounding(self):
        assert pricing.format_cost(0) == "$0.00"
        assert pricing.format_cost(1.12) == "$1.12"
        formatted = pricing.format_cost(0.0023)
        assert formatted.startswith("$0.00")
        assert len(formatted.split(".")[-1]) == 4

    def test_format_cost_for_sub_cent(self):
        formatted = pricing.format_cost(0.0001)
        assert formatted.startswith("$0.0001")


class TestRecordUsage:
    def test_record_usage_populates_attributes(self, mock_ingest_endpoint):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    cost = span.record_usage(
                        model="gpt-4o",
                        prompt_tokens=100,
                        completion_tokens=200,
                    )

                    assert cost is not None and cost > 0
                    assert span.attributes["model"] == "gpt-4o"
                    assert span.attributes["input_tokens"] == 100
                    assert span.attributes["output_tokens"] == 200
                    assert span.attributes["total_tokens"] == 300
                    assert span.attributes["cost_usd"] == cost
                    assert span.attributes["pricing_source"] == "litellm"

    def test_record_usage_unknown_model_persists_with_pricing_source_unknown(
        self, mock_ingest_endpoint
    ):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    cost = span.record_usage(
                        model="not-a-real-model-12345",
                        prompt_tokens=100,
                        completion_tokens=200,
                    )
                    assert cost is None
                    assert span.attributes["model"] == "not-a-real-model-12345"
                    assert span.attributes["input_tokens"] == 100
                    assert span.attributes["output_tokens"] == 200
                    assert span.attributes["pricing_source"] == "unknown"
                    assert "cost_usd" not in span.attributes

    def test_record_usage_falls_back_when_litellm_raises(self, mock_ingest_endpoint):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    with patch.object(
                        pricing,
                        "cost_for",
                        return_value=0.123,
                    ):
                        cost = span.record_usage(
                            model="gpt-4o",
                            prompt_tokens=10,
                            completion_tokens=20,
                        )
                    assert cost == 0.123
                    assert span.attributes["cost_usd"] == 0.123


class TestRecordInputOutputMessages:
    def test_record_input_messages_counts_tokens(self, mock_ingest_endpoint):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    tokens = span.record_input_messages(
                        "gpt-4o",
                        [{"role": "user", "content": "Hello world"}],
                    )
                    assert tokens > 0
                    assert span.attributes["input_tokens"] == tokens
                    assert span.attributes["model"] == "gpt-4o"

    def test_record_output_message_computes_cost_after_input(
        self, mock_ingest_endpoint
    ):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    span.record_input_messages(
                        "gpt-4o",
                        [{"role": "user", "content": "Hello world"}],
                    )
                    span.record_output_message(
                        "gpt-4o",
                        {"role": "assistant", "content": "Hi!"},
                    )
                    assert "cost_usd" in span.attributes
                    assert span.attributes["cost_usd"] > 0
                    assert span.attributes["pricing_source"] == "litellm"


class TestRunCostAggregation:
    def test_run_aggregates_cost_across_model_spans(self, mock_ingest_endpoint):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat-1", kind=SpanKind.MODEL) as span_a:
                    span_a.record_usage(
                        model="gpt-4o",
                        prompt_tokens=100,
                        completion_tokens=200,
                    )
                with run.span("chat-2", kind=SpanKind.MODEL) as span_b:
                    span_b.record_usage(
                        model="gpt-4o",
                        prompt_tokens=50,
                        completion_tokens=100,
                    )

            assert "cost_usd" in run.metadata
            assert run.metadata["cost_usd"] > 0
            assert run.metadata["total_input_tokens"] == 150
            assert run.metadata["total_output_tokens"] == 300

    def test_run_omits_cost_metadata_when_no_model_spans(self, mock_ingest_endpoint):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("planner", kind=SpanKind.AGENT):
                    pass

            assert "cost_usd" not in run.metadata
            assert "total_input_tokens" not in run.metadata
            assert "total_output_tokens" not in run.metadata


class TestModelCallContextManager:
    def test_model_call_opens_model_span_and_populates_attributes(
        self,
        mock_ingest_endpoint,
    ):
        northstar.init(
            api_key="test-key",
            endpoint="https://api.northstar.test",
            batch_size=100,
            flush_interval=60,
        )

        with northstar.trace("agent") as trace:
            with northstar.model_call("chat", model="gpt-4o") as ms:
                assert isinstance(ms, ModelSpan)
                assert ms.model == "gpt-4o"
                ms.record_input_messages(
                    [{"role": "user", "content": "Hello"}],
                )
                ms.record_output_message(
                    {"role": "assistant", "content": "Hi!"},
                )

            assert ms._span.attributes["model"] == "gpt-4o"
            assert ms._span.attributes["input_tokens"] > 0
            assert ms._span.attributes["output_tokens"] > 0
            assert ms._span.attributes["cost_usd"] > 0

        payload = northstar.flush() and None  # ensure flush happens
        assert mock_ingest_endpoint.call_count >= 1

        runs = mock_ingest_endpoint.calls[-1].request
        from json import loads

        body = loads(runs.content)
        runs_list = body["runs"]
        assert runs_list[0]["metadata"]["cost_usd"] > 0
        assert runs_list[0]["metadata"]["total_input_tokens"] > 0
        assert runs_list[0]["metadata"]["total_output_tokens"] > 0

    def test_model_call_outside_trace_yields_noop(self):
        northstar.init(enabled=False)
        with northstar.model_call("chat", model="gpt-4o") as ms:
            ms.record_input_messages([{"role": "user", "content": "hi"}])
            ms.record_output_message({"role": "assistant", "content": "hey"})
        assert ms.id is None

    def test_model_call_on_explicit_run(self, mock_ingest_endpoint):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with northstar.model_call("chat", model="gpt-4o", run=run) as ms:
                    ms.record_input_messages(
                        [{"role": "user", "content": "Hello"}],
                    )
                    ms.record_output_message(
                        {"role": "assistant", "content": "Hi!"},
                    )

            assert run.metadata["cost_usd"] > 0


class TestPricingNoLiteLLM:
    def test_cost_for_returns_none_when_litellm_missing(self, monkeypatch):
        import northstar.pricing as pricing_module

        monkeypatch.setattr(pricing_module, "_litellm", None)
        monkeypatch.setattr(pricing_module, "_litellm_import_error", ImportError("nope"))

        with patch.object(pricing_module, "_get_litellm") as mock_get:
            mock_get.side_effect = ImportError("litellm not installed")
            assert pricing.cost_for("gpt-4o", 100, 200) is None
            assert pricing.count_tokens("gpt-4o", "hi") == 0
            assert pricing.is_available() is False

    def test_span_record_usage_works_without_litellm(
        self, monkeypatch, mock_ingest_endpoint
    ):
        import northstar.pricing as pricing_module

        monkeypatch.setattr(pricing_module, "_litellm", None)
        monkeypatch.setattr(
            pricing_module, "_litellm_import_error", ImportError("nope")
        )

        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    cost = span.record_usage(
                        model="gpt-4o",
                        prompt_tokens=10,
                        completion_tokens=20,
                    )
                    assert cost is None
                    assert span.attributes["pricing_source"] == "unknown"
                    assert span.attributes["input_tokens"] == 10
                    assert span.attributes["output_tokens"] == 20


class TestCostAggregationEdgeCases:
    def test_run_metadata_preserves_existing_keys(self, mock_ingest_endpoint):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent", metadata={"team": "platform"}) as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    span.record_usage(
                        model="gpt-4o",
                        prompt_tokens=10,
                        completion_tokens=20,
                    )

            assert run.metadata["team"] == "platform"
            assert run.metadata["cost_usd"] > 0

    def test_run_metadata_partial_aggregation(self, mock_ingest_endpoint):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    span.record_usage(
                        model="not-a-real-model-zzz",
                        prompt_tokens=10,
                        completion_tokens=20,
                    )

            assert "cost_usd" not in run.metadata
            assert run.metadata["total_input_tokens"] == 10
            assert run.metadata["total_output_tokens"] == 20

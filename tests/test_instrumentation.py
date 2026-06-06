import json
import sys
import types

import pytest

import northstar


@pytest.fixture(autouse=True)
def reset_northstar():
    yield
    northstar.init(enabled=False)


def configure():
    northstar.init_logger(
        api_key="test-key",
        project="instrumentation-tests",
        endpoint="https://api.northstar.test",
        batch_size=100,
        flush_interval=60,
    )


def _install_module(monkeypatch, name):
    module = types.ModuleType(name)
    monkeypatch.setitem(sys.modules, name, module)
    return module


def install_fake_openai(monkeypatch):
    _install_module(monkeypatch, "openai")
    _install_module(monkeypatch, "openai.resources")
    _install_module(monkeypatch, "openai.resources.chat")
    chat_completions = _install_module(
        monkeypatch,
        "openai.resources.chat.completions",
    )
    responses = _install_module(monkeypatch, "openai.resources.responses")

    class Completions:
        call_count = 0

        def create(self, **kwargs):
            Completions.call_count += 1
            return {
                "choices": [
                    {
                        "message": {
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
                        }
                    }
                ],
                "usage": {"prompt_tokens": 11, "completion_tokens": 7},
                "request_id": "req-openai-chat",
            }

    class AsyncCompletions:
        async def create(self, **kwargs):
            return {
                "choices": [{"message": {"role": "assistant", "content": "async ok"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2},
            }

    class Responses:
        def create(self, **kwargs):
            return {
                "output_text": "response ok",
                "usage": {"input_tokens": 5, "output_tokens": 4},
                "request_id": "req-openai-response",
            }

    class AsyncResponses:
        async def create(self, **kwargs):
            return {"output_text": "async response ok"}

    chat_completions.Completions = Completions
    chat_completions.AsyncCompletions = AsyncCompletions
    responses.Responses = Responses
    responses.AsyncResponses = AsyncResponses
    return Completions, AsyncCompletions, Responses, AsyncResponses


class FakeOpenAIClient:
    def __init__(self, base_url):
        self.base_url = base_url


class FakeOpenAICompatibleResource:
    def __init__(self, base_url):
        self._client = FakeOpenAIClient(base_url)


def install_fake_anthropic(monkeypatch):
    _install_module(monkeypatch, "anthropic")
    _install_module(monkeypatch, "anthropic.resources")
    messages_module = _install_module(monkeypatch, "anthropic.resources.messages")

    class Messages:
        def create(self, **kwargs):
            return {
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu-1",
                        "name": "lookup",
                        "input": {"query": "refund"},
                    }
                ],
                "usage": {"input_tokens": 13, "output_tokens": 8},
                "request_id": "req-anthropic",
            }

    class AsyncMessages:
        async def create(self, **kwargs):
            return {
                "content": [{"type": "text", "text": "async anthropic ok"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
            }

    messages_module.Messages = Messages
    messages_module.AsyncMessages = AsyncMessages
    return Messages, AsyncMessages


def flushed_payload(mock_ingest_endpoint):
    assert northstar.flush() is True
    assert mock_ingest_endpoint.call_count >= 1
    return json.loads(mock_ingest_endpoint.calls[-1].request.content)


def test_openai_chat_completion_instrumentation_is_idempotent_and_captures_tools(
    monkeypatch,
    mock_ingest_endpoint,
):
    Completions, _, _, _ = install_fake_openai(monkeypatch)
    configure()

    northstar.auto_instrument(providers=("openai",))
    northstar.auto_instrument(providers=("openai",))

    response = Completions().create(
        model="gpt-4o",
        messages=[
            {"role": "user", "content": "Use token sk-secret"},
            {
                "role": "tool",
                "tool_call_id": "call-0",
                "name": "search_docs",
                "content": {"result": "Refunds are available."},
            },
        ],
        tools=[{"type": "function", "function": {"name": "search_docs"}}],
        tool_choice="auto",
    )

    assert response["request_id"] == "req-openai-chat"
    assert Completions.call_count == 1

    payload = flushed_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["name"] == "openai.chat.completions.create"
    assert payload["runs"][0]["metadata"]["project"] == "instrumentation-tests"

    model_span = next(span for span in payload["spans"] if span["kind"] == "model")
    assert model_span["attributes"]["provider"] == "openai"
    assert model_span["attributes"]["request_id"] == "req-openai-chat"
    assert model_span["attributes"]["input_tokens"] == 11
    assert model_span["attributes"]["output_tokens"] == 7
    assert model_span["attributes"]["tools"] == [
        {"type": "function", "function": {"name": "search_docs"}}
    ]

    assert any(event["type"] == "tool_result" for event in payload["events"])
    tool_args = [event for event in payload["events"] if event["type"] == "tool_arguments"]
    assert tool_args
    assert tool_args[-1]["content"]["name"] == "search_docs"


def test_openai_responses_instrumentation_captures_input_and_output(
    monkeypatch,
    mock_ingest_endpoint,
):
    _, _, Responses, _ = install_fake_openai(monkeypatch)
    configure()
    northstar.auto_instrument(providers=("openai",))

    assert Responses().create(
        model="gpt-4o-mini",
        instructions="Be brief",
        input="Hello",
    )["output_text"] == "response ok"

    payload = flushed_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["name"] == "openai.responses.create"
    assert any(
        event["type"] == "system_message" and event["content"] == "Be brief"
        for event in payload["events"]
    )
    assert any(
        event["type"] == "assistant_message" and event["content"] == "response ok"
        for event in payload["events"]
    )


def test_openai_compatible_openrouter_base_url_sets_provider_metadata(
    monkeypatch,
    mock_ingest_endpoint,
):
    Completions, _, _, _ = install_fake_openai(monkeypatch)
    configure()
    northstar.auto_instrument(providers=("openai",))

    resource = Completions()
    resource._client = FakeOpenAIClient("https://openrouter.ai/api/v1")
    resource.create(
        model="anthropic/claude-sonnet-4.5",
        messages=[{"role": "user", "content": "hi"}],
    )

    payload = flushed_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["metadata"]["provider"] == "openrouter"
    assert payload["runs"][0]["metadata"]["transport"] == "openai-compatible"

    model_span = next(span for span in payload["spans"] if span["kind"] == "model")
    assert model_span["attributes"]["provider"] == "openrouter"
    assert model_span["attributes"]["transport"] == "openai-compatible"
    assert model_span["attributes"]["method"] == "openai.chat.completions.create"


@pytest.mark.asyncio
async def test_openai_async_completion_preserves_return_value(
    monkeypatch,
    mock_ingest_endpoint,
):
    _, AsyncCompletions, _, _ = install_fake_openai(monkeypatch)
    configure()
    northstar.auto_instrument(providers=("openai",))

    response = await AsyncCompletions().create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "hi"}],
    )

    assert response["choices"][0]["message"]["content"] == "async ok"
    payload = flushed_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["name"] == "openai.chat.completions.create"


def test_anthropic_messages_instrumentation_captures_tool_use_and_tool_result(
    monkeypatch,
    mock_ingest_endpoint,
):
    Messages, _ = install_fake_anthropic(monkeypatch)
    configure()
    northstar.auto_instrument(providers=("anthropic",))

    response = Messages().create(
        model="claude-sonnet-4-5",
        system="Use tools carefully",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu-0",
                        "content": "prior result",
                    },
                    {"type": "text", "text": "Continue"},
                ],
            }
        ],
        tools=[{"name": "lookup"}],
    )

    assert response["request_id"] == "req-anthropic"
    payload = flushed_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["name"] == "anthropic.messages.create"

    model_span = next(span for span in payload["spans"] if span["kind"] == "model")
    assert model_span["attributes"]["provider"] == "anthropic"
    assert model_span["attributes"]["request_id"] == "req-anthropic"
    assert model_span["attributes"]["tools"] == [{"name": "lookup"}]

    assert any(event["type"] == "tool_result" for event in payload["events"])
    tool_args = [event for event in payload["events"] if event["type"] == "tool_arguments"]
    assert tool_args[-1]["content"] == {
        "id": "toolu-1",
        "name": "lookup",
        "arguments": {"query": "refund"},
    }


@pytest.mark.asyncio
async def test_anthropic_async_messages_preserve_return_value(
    monkeypatch,
    mock_ingest_endpoint,
):
    _, AsyncMessages = install_fake_anthropic(monkeypatch)
    configure()
    northstar.auto_instrument(providers=("anthropic",))

    response = await AsyncMessages().create(
        model="claude-sonnet-4-5",
        messages=[{"role": "user", "content": "hi"}],
    )

    assert response["content"][0]["text"] == "async anthropic ok"
    payload = flushed_payload(mock_ingest_endpoint)
    assert payload["runs"][0]["name"] == "anthropic.messages.create"


def test_auto_instrument_ignores_missing_optional_provider(monkeypatch):
    monkeypatch.setitem(sys.modules, "anthropic", None)
    northstar.auto_instrument(providers=("anthropic",))

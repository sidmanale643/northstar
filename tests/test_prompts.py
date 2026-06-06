from __future__ import annotations

from uuid import UUID

import httpx
import pytest
import respx

from northstar import Northstar, SpanKind, model_call
from northstar._prompt_template import extract_variables
from northstar.prompts import PromptVersion, compile

PROMPT_ID = UUID("11111111-1111-1111-1111-111111111111")
VERSION_ID = UUID("22222222-2222-2222-2222-222222222222")


def prompt_response(content: str = "Summarize {{ doc }} in {max_words} words."):
    return {
        "prompt_version": {
            "id": str(VERSION_ID),
            "prompt_id": str(PROMPT_ID),
            "version_number": 3,
            "content": content,
            "model": "gpt-4o-mini",
            "temperature": 0.2,
            "max_tokens": 512,
            "variables": [],
            "content_hash": "sha256:test",
        }
    }


def test_template_extracts_and_compiles_jinja_and_brace_variables():
    version = PromptVersion(
        id=VERSION_ID,
        prompt_id=PROMPT_ID,
        version_number=1,
        content="Hello {{ name }}, write {count} bullets for {{ topic }}.",
        content_hash="sha256:test",
    )

    assert extract_variables(version.content) == ["count", "name", "topic"]
    assert version.variables == [
        {"name": "count", "type": "string", "required": True, "default": None},
        {"name": "name", "type": "string", "required": True, "default": None},
        {"name": "topic", "type": "string", "required": True, "default": None},
    ]

    compiled = compile(
        version,
        {"name": "Ada", "count": 3, "topic": "tracing"},
    )

    assert compiled.content == "Hello Ada, write 3 bullets for tracing."
    assert compiled.raw_content == version.content
    assert compiled.variables == {"name": "Ada", "count": 3, "topic": "tracing"}


def test_compile_rejects_missing_variables():
    version = PromptVersion(
        id=VERSION_ID,
        prompt_id=PROMPT_ID,
        version_number=1,
        content="Hello {{ name }}.",
        content_hash="sha256:test",
    )

    with pytest.raises(ValueError, match="Missing prompt variables: name"):
        compile(version, {})


def test_pull_prompt_posts_to_supabase_resolve_endpoint_and_caches_on_error():
    with respx.mock(assert_all_called=False) as router:
        route = router.post(
            "https://northstarproject.supabase.co/functions/v1/prompts/resolve"
        ).mock(
            side_effect=[
                httpx.Response(200, json=prompt_response()),
                httpx.ConnectError("offline"),
            ]
        )

        client = Northstar(api_key="test-key", project_id="northstarproject")

        first = client.pull_prompt("summarizer", label="staging", version=3)
        with pytest.warns(RuntimeWarning, match="using cached prompt"):
            second = client.pull_prompt("summarizer", label="staging", version=3)

    assert route.call_count == 2
    request = route.calls[0].request
    assert request.headers["authorization"] == "Bearer test-key"
    assert request.url.path == "/functions/v1/prompts/resolve"
    assert first.prompt_version_id == VERSION_ID
    assert second.prompt_version_id == VERSION_ID


def test_pull_prompt_uses_custom_endpoint_fallback():
    with respx.mock(assert_all_called=True) as router:
        route = router.post("https://api.northstar.test/api/prompts/resolve").mock(
            return_value=httpx.Response(200, json=prompt_response("Hello {name}."))
        )

        client = Northstar(api_key="test-key", endpoint="https://api.northstar.test")
        prompt = client.pull_prompt("greeting")

    assert route.call_count == 1
    assert prompt.raw_content == "Hello {name}."


def test_prompt_bind_records_compile_event_and_flushes_prompt_link():
    with respx.mock(assert_all_called=False) as router:
        router.post("https://api.northstar.test/api/prompts/resolve").mock(
            return_value=httpx.Response(200, json=prompt_response())
        )
        router.post("https://api.northstar.test").mock(
            return_value=httpx.Response(200, json={"accepted": True}),
        )

        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
        )
        prompt = client.pull_prompt("summarizer")

        with client.session() as session:
            with session.run("agent") as run:
                with run.span("chat", kind=SpanKind.MODEL) as span:
                    with prompt.bind(
                        variables={"doc": "NorthStar traces agents.", "max_words": 5},
                        span=span,
                    ) as compiled:
                        assert (
                            compiled.content
                            == "Summarize NorthStar traces agents. in 5 words."
                        )

    payload = client.last_flushed_payload
    assert payload is not None
    assert payload["prompt_links"] == [
        {
            "trace_id": payload["runs"][0]["id"],
            "span_id": payload["spans"][0]["id"],
            "prompt_version_id": str(VERSION_ID),
            "variable_values": {
                "doc": "NorthStar traces agents.",
                "max_words": 5,
            },
        }
    ]
    assert payload["spans"][0]["attributes"]["prompt.compile.requested"] == {
        "prompt_version_id": str(VERSION_ID),
        "content_hash": "sha256:test",
    }


def test_prompt_bind_uses_active_model_call_span():
    with respx.mock(assert_all_called=False) as router:
        router.post("https://api.northstar.test/api/prompts/resolve").mock(
            return_value=httpx.Response(200, json=prompt_response("Hello {name}."))
        )
        router.post("https://api.northstar.test").mock(
            return_value=httpx.Response(200, json={"accepted": True}),
        )

        client = Northstar(api_key="test-key", endpoint="https://api.northstar.test")
        prompt = client.pull_prompt("greeting")

        with client.session() as session:
            with session.run("agent") as run:
                with model_call("chat", model="gpt-4o-mini", run=run):
                    with prompt.bind(variables={"name": "Ada"}) as compiled:
                        assert compiled.content == "Hello Ada."

    payload = client.last_flushed_payload
    assert payload is not None
    assert payload["prompt_links"][0]["prompt_version_id"] == str(VERSION_ID)
    assert payload["prompt_links"][0]["span_id"] == payload["spans"][0]["id"]

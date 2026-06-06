# NorthStar

NorthStar is an observability, debugging, and evaluation platform for AI agents. It records traces, child spans, events, metrics, errors, and LLM cost without changing application control flow.

Data flows from your agent app → SDK queue → background worker → Supabase Edge Function → private Postgres tables, and is visualized on a separate web dashboard.

```
Agent App (Python) ──► SDK ──► Supabase Edge Function ──► Postgres ──► Dashboard
                          │            (Deno/TS)            (RLS)
                          └─► local queue + background worker
```

## Install

```bash
uv add northstar-ai
```

For LLM cost tracking and LiteLLM-based helpers, install the optional extras:

```bash
uv add 'northstar-ai[pricing]'   # pulls in litellm for token counting + USD pricing
```

For local development:

```bash
git clone <repo>
cd northstar
uv sync --group dev
```

## Quick start

Set credentials:

```bash
export NORTHSTAR_API_KEY="ns_..."
export NORTHSTAR_PROJECT_ID="<supabase-project-ref>"
```

Initialize once at startup, then run your agent normally. The SDK auto-instruments
OpenAI and Anthropic client calls when you opt in.

```python
import os

import anthropic
import northstar

northstar.auto_instrument()  # instruments openai + anthropic
northstar.init(
    api_key=os.environ["NORTHSTAR_API_KEY"],
    project_id=os.environ["NORTHSTAR_PROJECT_ID"],
    project="Support Agent",
    environment="production",
)

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

response = client.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=1024,
    messages=[{"role": "user", "content": "How do I reset my password?"}],
)
northstar.flush()
```

`auto_instrument()` patches the OpenAI chat/responses endpoints and Anthropic
`messages.create` calls. It captures request messages, tools/tool choice,
model-emitted tool calls, tool result messages included in later LLM requests,
outputs, token usage, USD cost (via litellm pricing), latency, and exceptions.
It does not trace local tool execution in this version.

Events are queued and sent by a background worker thread. `northstar.flush()`
drains the queue synchronously. High-level traces recorded after one
`northstar.init()` call share a session until shutdown or re-initialization.

## Manual tracing

For custom agent logic, use the decorator or context manager APIs:

```python
@northstar.observe("retrieve-docs")
def retrieve_docs(query: str) -> list[str]:
    northstar.log_event("retrieval_started", {"query": query})
    return vector_db.search(query)

@northstar.trace("research-agent", tags=["rag"])
def run_agent(query: str) -> str:
    northstar.log_metadata({"source": "example"})
    docs = retrieve_docs(query)
    return f"{query}: {docs[0]}"
```

Context manager form with nested spans and explicit input/output:

```python
with northstar.trace("research-agent", input={"query": query}) as trace:
    with northstar.span("retrieval"):
        docs = retrieve_docs(query)
    trace.set_output(generate_answer(query, docs))
```

Record LLM usage and cost inside an existing trace:

```python
with northstar.model_call("answer-llm", model="gpt-4o") as llm:
    llm.record_input_messages(messages)
    response = call_provider(...)
    llm.record_output_message(response.choices[0].message.model_dump())
    llm.record_usage(prompt_tokens=..., completion_tokens=..., cost_usd=...)
```

`run.replay(tools=...)` and `Run.replay()` re-execute recorded tool calls against
a registry so you can re-run a previous trace deterministically.

## Prompts

NorthStar stores versioned prompt templates server-side and binds compiled
versions to model calls:

```python
with northstar.pull_prompt("summarizer", label="production") as prompt:
    compiled = prompt.compile(doc=doc_text, max_words=120)
    with northstar.model_call("summarise", model="gpt-4o") as llm:
        llm.record_input_messages([{"role": "user", "content": compiled}])
        ...
```

Templates support `{{ jinja }}` and `{python}` variables; missing variables
raise a validation error at compile time.

## LLM service wrapper

`northstar.llm.LLMService` is a LiteLLM-backed wrapper that records traces,
token usage, and cost automatically. It is intended for projects that want a
managed chat completion entry point:

```python
from northstar.llm import LLMService

llm = LLMService(default_model="gpt-4o-mini")
response = llm.generate(
    messages=[{"role": "user", "content": "Hello"}],
    tools=tool_schemas,
)
```

Install with `uv add 'northstar-ai[pricing]'`. `LLMService` requires the
`northstar` global client to be initialized first.

## Evals

`northstar.evals` provides dataset loaders, deterministic graders, and LLM
judges for evaluating agent runs. Datasets can be loaded from JSON or JSONL.
Graders include `output`, `tool_arguments_match`, `tool_sequence`,
`tool_output_referenced`, `loop`, `retrieval`, `rubric_judge`, `faithfulness`,
`python_code`, `typescript_code`, and `regex` — see
[`tests/test_evals.py`](tests/test_evals.py) for usage examples.

## Configuration

Arguments passed to `northstar.init()` override environment variables.

| Argument | Environment variable | Default |
|---|---|---|
| `api_key` | `NORTHSTAR_API_KEY` | none (required) |
| `project_id` | `NORTHSTAR_PROJECT_ID` | none (required) |
| `project` | `NORTHSTAR_PROJECT` | none |
| `environment` | `NORTHSTAR_ENVIRONMENT` | none |
| `enabled` | `NORTHSTAR_ENABLED` | `true` |
| `debug` | `NORTHSTAR_DEBUG` | `false` |
| `capture_inputs` | — | `true` |
| `capture_outputs` | — | `true` |
| `redact_keys` | — | `api_key, authorization, cookie, password, secret, token` |
| `batch_size` | — | `50` |
| `flush_interval` | — | `5.0` seconds |
| `max_queue_size` | — | `1000` |

The ingest URL is derived from `project_id` as
`https://{project_id}.supabase.co/functions/v1/ingest-traces`. You should
not need to set it directly. Self-hosted deployments can override the URL
by passing `endpoint=` to `Northstar(...)` or `northstar.init()`.

Input and output capture can be disabled globally or per-trace with
`@northstar.trace(capture_input=False, capture_output=False)`.

Before queueing, NorthStar recursively redacts sensitive fields. Add additional
keys with `northstar.init(redact_keys=["ssn"])`.

When disabled or unreachable, application code continues normally (no-op stubs).
Use `debug=True` to print SDK warnings. Call `northstar.current_trace_id()` to
correlate application logs with traces.

## Dashboard provider keys

Dashboard rubric evals can use project-scoped provider keys for OpenAI,
Anthropic, OpenRouter, and other LiteLLM providers. Set
`PROVIDER_KEYS_ENCRYPTION_KEY` on the dashboard server before saving provider
keys. Generate it as a 32-byte base64 value:

```bash
openssl rand -base64 32
```

## Data model

| Entity | Description | Key fields |
|---|---|---|
| **Session** | Top-level user tracking session | `id`, `project_id`, `created_at`, `metadata` |
| **Run** | Agent run or step inside a session | `id`, `session_id`, `name`, `status`, `error`, `metadata` |
| **Span** | Child span inside a run (nestable) | `id`, `run_id`, `parent_span_id`, `kind`, `name`, `attributes` |
| **Event** | Individual trace event | `id`, `run_id`, `span_id`, `type`, `content`, `attributes` |
| **Score** | Eval score attached to a run | `run_id`, `name`, `value`, `data_type`, `source` |

Session, Run, and Span are context managers — their lifecycle is managed
automatically via `__enter__`/`__exit__`.

## Advanced client

The low-level client gives direct control over sessions, runs, spans, events,
and scores:

```python
from northstar import CaptureOptions, Northstar, SpanKind

client = Northstar(
    api_key="ns_...",
    project_id="<project-ref>",
    capture=CaptureOptions(user_input=True, final_response=True),
)

with client.session(metadata={"source": "cli"}) as session:
    with session.run("research-agent") as run:
        run.record_user_input("Find the current API documentation.")
        with run.span("search-docs", kind=SpanKind.TOOL):
            ...
        run.record_final_response("Documentation found.")
        client.score(run.id, "relevance", 0.92, source="human")
```

See [`examples/agent_run.py`](examples/agent_run.py) for a complete example
and [`examples/cost_tracking.py`](examples/cost_tracking.py) for LLM cost
tracking.

## Lifecycle & threading

The SDK uses a daemon background thread with `threading.Event` for wake/sleep
batching. Records flush when the batch size is reached or the flush interval
elapses. `httpx` is used for transport with bounded retries on
`408/429/500/502/503/504`. Context variables (`ContextVar`) enable proper
nesting of traces and spans without explicit handle passing.

## Configure ingestion

Apply the SQL files in `migrations/` in order, create a project and API key row,
then deploy the Edge Function:

```bash
supabase functions deploy ingest-traces --no-verify-jwt
```

The function authenticates using the NorthStar API key (SHA-256 hashed) instead
of a Supabase JWT. Only the hash is stored in `private.api_keys.key_hash`.

## Architecture

```
Agent App (Python)
    │
    ▼
SDK (src/northstar/)
  ├── api.py        — High-level API (trace, observe, span, log_*)
  ├── client.py     — HTTP transport, queue, retry logic
  ├── models.py     — Pydantic models (Session, Run, Span, Event, Score)
  ├── prompts.py    — Versioned prompt templates + bind() to model calls
  ├── replay.py     — Replay recorded runs against a tool registry
  ├── llm.py        — LLMService (LiteLLM wrapper with native tracing)
  ├── pricing.py    — Token counting + USD cost via litellm
  ├── evals/        — Dataset loaders + deterministic and LLM graders
  └── instrumentation/
       ├── openai.py     — Chat + Responses API patching
       └── anthropic.py  — messages.create patching
    │
    ▼  POST / (Bearer auth)
    │
Supabase Edge Function (supabase/functions/ingest-traces/)
  ├── Validates payload (UUIDs, enums, timestamps)
  ├── Authenticates via SHA-256 hash lookup
  ├── Stamps project_id on every record
  ├── Topologically sorts spans
    │
    ▼  CALL private.ingest_batch()
    │
Postgres (migrations/)
  ├── private.sessions, private.runs
  ├── private.spans, private.events
  ├── private.api_keys, private.scores
  ├── Row Level Security (multi-tenant isolation)
  └── ON CONFLICT (id) DO UPDATE (idempotent ingestion)
```

## Test

```bash
uv run pytest -q tests
(cd supabase/functions/ingest-traces && npx -y deno test --allow-env --allow-net index_test.ts)
```

## Project structure

```
src/northstar/        — Python SDK package
  ├── api.py           Public API
  ├── client.py        Low-level HTTP client
  ├── models.py        Pydantic data models
  ├── prompts.py       Prompt templates
  ├── replay.py        Trace replay
  ├── llm.py           LiteLLM-backed LLM service
  ├── pricing.py       Token + cost helpers
  ├── evals/           Dataset loaders + graders
  └── instrumentation/ OpenAI / Anthropic patches

supabase/             — Backend
  └── functions/ingest-traces/  Edge Function (Deno/TypeScript)

migrations/           — SQL migrations (apply in order)

dashboard/            — Next.js web dashboard (separate app)

tests/                — pytest suite (uses respx for HTTP mocking)
examples/             — Usage examples
```

## Roadmap

- Trace viewer
- Dataset uploader / viewer / editor / annotator (dashboard + db)
- Dataset loader SDK
- Grader plan SDK
- Data collector
- Final evaluator

# NorthStar

NorthStar is an observability, debugging, and evaluation platform for AI agents. It records traces, child spans, events, metrics, and errors without changing application control flow.

Data flows from your agent app → SDK queue → background worker → Supabase Edge Function → private schema tables, and is visualized on a separate web dashboard.

## Install

```bash
uv add northstar
```

Or for local development:

```bash
git clone <repo>
cd northstar
uv sync --group dev
```

## Quick start

Set credentials:

```bash
export NORTHSTAR_API_KEY="ns_..."
export NORTHSTAR_PROJECT_ID="<project-ref>"
```

Initialize once, then decorate the agent entry point:

```python
import northstar

northstar.init()

@northstar.trace("support-agent")
def run_agent(query: str) -> str:
    northstar.log_event("query_received")
    northstar.log_metric("retrieval_count", 3)
    return answer_query(query)

result = run_agent("How do I reset my password?")
northstar.flush()
```

`@northstar.trace()` captures arguments, output, latency, and exceptions — works for sync and async functions. Events are queued and sent by a background worker; `northstar.flush()` sends remaining records immediately.

Add `@northstar.observe()` for child spans:

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

Context manager form:

```python
with northstar.trace("research-agent", input={"query": query}) as trace:
    with northstar.span("retrieval"):
        docs = retrieve_docs(query)
    trace.set_output(generate_answer(query, docs))
```

## Configuration

Arguments passed to `northstar.init()` override environment variables.

| Argument | Environment variable | Default |
|---|---|---|
| `api_key` | `NORTHSTAR_API_KEY` | none |
| `project_id` | `NORTHSTAR_PROJECT_ID` | none |
| `endpoint` | `NORTHSTAR_ENDPOINT` | derived from `project_id` |
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

Input and output capture can be disabled globally or per-trace with
`@northstar.trace(capture_input=False, capture_output=False)`.

Before queueing, NorthStar recursively redacts sensitive fields. Add additional
keys with `northstar.init(redact_keys=["ssn"])`.

When disabled or unreachable, application code continues normally (no-op stubs).
Use `debug=True` to print SDK warnings. Call `northstar.current_trace_id()` to
correlate application logs with traces.

## Data model

| Entity | Description | Key fields |
|---|---|---|
| **Session** | Top-level user tracking session | `id`, `project_id`, `created_at`, `metadata` |
| **Run** | Agent run or step inside a session | `id`, `session_id`, `name`, `status`, `error`, `metadata` |
| **Span** | Child span inside a run (nestable) | `id`, `run_id`, `parent_span_id`, `kind`, `name`, `attributes` |
| **Event** | Individual trace event | `id`, `run_id`, `span_id`, `type`, `content`, `attributes` |

Session, Run, and Span are context managers — their lifecycle is managed
automatically via `__enter__`/`__exit__`.

## Advanced client

The low-level client gives direct control over sessions, runs, spans, and events:

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
```

See [`examples/agent_run.py`](examples/agent_run.py) for a complete example.

## Lifecycle & threading

The SDK uses a daemon background thread with `threading.Event` for wake/sleep
batching. Records flush when the batch size is reached or the flush interval
elapses. Context variables (`ContextVar`) enable proper nesting of traces and
spans without explicit handle passing.

## Configure ingestion

Apply the SQL files in `migrations/` in order, create a project and API key row,
then deploy the Edge Function:

```bash
supabase functions deploy ingest-traces --no-verify-jwt
```

The function authenticates using the NorthStar API key (SHA-256 hashed) instead
of Supabase JWT. Only the hash is stored in `private.api_keys.key_hash`.

## Architecture

```
Agent App (Python)
    │
    ▼
SDK (src/northstar/)
  ├── api.py        — High-level API (trace, observe, span, log_*)
  ├── client.py     — HTTP transport, queue, retry logic
  ├── models.py     — Pydantic models (Session, Run, Span, Event)
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
  └── models.py        Pydantic data models

supabase/             — Backend
  └── functions/ingest-traces/  Edge Function (Deno/TypeScript)

migrations/           — SQL migrations (apply in order)

dashboard/            — Next.js web dashboard (separate app)

tests/                — pytest suite (uses respx for HTTP mocking)
examples/             — Usage examples
```

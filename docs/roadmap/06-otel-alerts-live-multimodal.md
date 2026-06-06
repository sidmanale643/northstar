# NorthStar — OTel Ingest, Alerts/Webhooks/Rules, Real-Time Live Tail, and Multi-Modal Replay

A unified design doc for the four SOTA workstreams that close gaps #5, #6, #7, and #9 from `SOTA.md:185-189`. Each section is independent; they share a "live data plane" assumption (the new ingest paths, alert fan-out, and live tail all flow from writes to `private.spans`/`private.events`).

**Shared constraints (apply to every section):**
- All persistence stays in the `private` schema (`migrations/001_initial_schema.sql:11`); RLS is `ENABLE`d on every table per `migrations/007_ingest_hardening.sql:201-206`.
- Auth boundary: Edge Functions authenticate via `Authorization: Bearer ns_…`; dashboard API routes go through `requireDashboardBackendProject` (`dashboard/app/api/projects/[projectId]/provider-keys/[provider]/route.ts:12`). The auth bypass in `dashboard/middleware.ts:33-46` is a separate P0 (gap #2) and is out-of-scope here.
- The Python SDK ingest RPC path (`supabase/functions/ingest-traces/index.ts:480-608` → `private.ingest_batch` at `migrations/006_ingest_rpc.sql:11-153`) is the **only** downstream write path today. All four sections reuse it.

---

## Section A — OTel / OpenTelemetry + OpenInference Ingest (SOTA gap #5)

**Goal:** Accept OTel SDK / OpenInference spans from any framework (Vercel AI SDK, LlamaIndex, OpenAI Agents, Go/Rust custom) and translate them into NorthStar's `private.spans` / `private.events` rows. **The Python SDK remains the primary first-party path; OTel is additive.**

### A.1 — Protocol support

Accept both OTLP transports per the OTLP spec:
- **OTLP/HTTP** at `POST /v1/traces` (default port 4318). Content-Type: `application/x-protobuf` or `application/json`. Accept gzip (`Content-Encoding: gzip`).
- **OTLP/gRPC** at `:4317/v1/traces` (default port 4317). Use the `opentelemetry-proto` schema (`ExportTraceServiceRequest` → `ResourceSpans[]` → `ScopeSpans[]` → `Span[]`).
- **OpenInference semantic conventions** are a *superset* of OTel GenAI semconv. The fields the translator MUST understand are:
  - `gen_ai.system` (legacy OpenInference) or `gen_ai.provider.name` (current OTel) → maps to internal `provider` attribute.
  - `gen_ai.operation.name` (`chat`, `text_completion`, `embeddings`, `execute_tool`, `invoke_agent`, `generate_content`, `retrieval`) → `spans.kind`.
  - `gen_ai.request.model` / `gen_ai.response.model` → `spans.attributes.model`.
  - `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` → `spans.attributes.input_tokens` / `output_tokens`; cost computed via `src/northstar/pricing.py` (already in repo).
  - `openinference.span.kind` (legacy: `LLM`, `TOOL`, `AGENT`, `CHAIN`, `RETRIEVER`, `EMBEDDING`, `RERANKER`, `GUARDRAIL`, `EVALUATOR`) → `spans.kind`.

### A.2 — Field mapping (OTel span → `private.spans` row)

| OTel field (`Span`) | NorthStar target | Source migration |
|---|---|---|
| `trace_id` (16-byte hex) | derived `run_id` (UUIDv5 over the trace_id, namespace = project_id) | new |
| `span_id` (8-byte hex) | `spans.id` (UUIDv5 over span_id) | `migrations/004_spans.sql:4` |
| `parent_span_id` (8-byte hex) | `spans.parent_span_id` (UUIDv5) | `migrations/004_spans.sql:7` |
| `name` | `spans.name` | `migrations/004_spans.sql:10` |
| `start_time_unix_nano` | `spans.started_at` | `migrations/004_spans.sql:11` |
| `end_time_unix_nano` | `spans.ended_at` (nullable for still-open spans) | `migrations/004_spans.sql:12` |
| `kind` (SPAN_KIND_*) | translated via A.3 table → `spans.kind` | `migrations/004_spans.sql:8` |
| `status.code` (`STATUS_CODE_OK`/`ERROR`/`UNSET`) | `spans.status` (`ok`/`error`/`running`) | `migrations/004_spans.sql:12` |
| `status.message` | `spans.error.message` | `migrations/004_spans.sql:13` |
| `attributes` (k/v list) | `spans.attributes` JSONB, after `gen_ai.*`/`openinference.*` key flattening | `migrations/004_spans.sql:15` |
| `events[]` (SpanEvent) | one `private.events` row per OTel event, `type` derived from `event.name` | `migrations/005_events.sql:1-16` |
| Resource `service.name` | used for project_id resolution (see A.4) | n/a |
| Resource `service.version` | `spans.attributes.service_version` | n/a |
| Resource `deployment.environment` | `spans.attributes.environment` | n/a |
| Resource `telemetry.sdk.language` | `spans.attributes.telemetry_sdk` | n/a |
| Scope `name`/`version` (instrumentation library) | `spans.attributes.otel_scope` | n/a |

The `run_id` MUST be stable per OTel `trace_id` so a multi-batch export (which is normal — OTel SDKs batch every 5s by default) upserts the same run rather than creating duplicates. This means **OTel translates to a 1:many mapping (one trace → one run, many spans)**, which is the inverse of the Python SDK model where a `Run` has many `Span`s (`src/northstar/models.py:185-198`). The OTel path emits **one synthetic `Run` per OTel trace** in addition to the spans; this run is invisible to the user but lets existing run-level views (`runs.error`, `runs.started_at`, `runs.metadata`) keep working.

### A.3 — Span-kind translation

The OTel `SpanKind` enum is *transport-oriented* (CLIENT/SERVER/INTERNAL/PRODUCER/CONSUMER), but NorthStar's `spans.kind` (`migrations/004_spans.sql:8`) is *role-oriented* (`agent|workflow|model|tool|custom`). Use this precedence:

1. If `gen_ai.operation.name` is present → `model`.
2. Else if `openinference.span.kind == "TOOL"` or `gen_ai.operation.name == "execute_tool"` → `tool`.
3. Else if `openinference.span.kind in {LLM, EMBEDDING, RERANKER, RETRIEVER, RERANKER}` → `model`.
4. Else if `openinference.span.kind in {AGENT, CHAIN}` or `gen_ai.operation.name in {invoke_agent, invoke_workflow}` → `agent` or `workflow` respectively.
5. Else if `SpanKind == CLIENT` and there is no GenAI attribute → `custom`.
6. Else → `custom` (the safe default — `migrations/004_spans.sql:8` CHECK will reject nothing).

### A.4 — Project resolution (Resource attributes → project_id)

OTel exporters authenticate with the same `Authorization: Bearer ns_…` scheme as the Python SDK; the `private.resolve_api_key` function (`migrations/006_ingest_rpc.sql:162-173`) returns the project_id. **API key auth is the only mechanism that grants write access.** The OTel-only authentication mode (no API key) is rejected with 401.

But OTel allows multiple "projects" worth of data on the same key via Resource attributes. Two new resource attributes MUST be recognized, in this order:
1. `northstar.project_id` (UUID string) — explicit override. Validated against the API key's allowed projects; cross-project writes return 403.
2. `service.name` — if it matches an existing project metadata tag (`service_name` on the project, future column), use that. Otherwise default to the API key's sole project.

**Why both?** A single key for "acme-corp" might route to either `acme-prod` or `acme-staging` based on `service.name`. Phoenix and LangSmith both support this.

### A.5 — Ingest endpoint

Add a new Edge Function **alongside** `ingest-traces` (`supabase/functions/ingest-traces/index.ts:1`). Do not modify the existing function.

**New Edge Function:** `supabase/functions/otel-ingest/index.ts`
- Routes:
  - `POST /v1/traces` (and `/v1/traces/` with trailing slash) — OTLP/HTTP protobuf or JSON
  - `gRPC:4317` (exposed via Supabase Edge Function gRPC support, or a small `drogon`/`connectrpc` sidecar if Edge Functions don't yet support gRPC — see A.7 risks)
- Request flow:
  1. CORS preflight (OPTIONS) → 204
  2. Auth: extract bearer, SHA-256 hash, call `private.resolve_api_key` (reuse from `migrations/006_ingest_rpc.sql:162-173`)
  3. Project resolution per A.4
  4. Decode body: content-type → `application/x-protobuf` → use `npm:protobufjs` with the `opentelemetry-proto` schema; `application/json` → use the official OTLP/JSON decoder. Both MUST accept `Content-Encoding: gzip`.
  5. Translate: `ResourceSpans[]` → list of `(run, spans[], events[])` per A.2.
  6. Project_id stamp (reuse `stampProjectId` pattern from `supabase/functions/ingest-traces/index.ts:338-357`).
  7. Call `private.ingest_batch` (zero schema change; same RPC as `migrations/006_ingest_rpc.sql:11-153`).
  8. Return OTLP `ExportTraceServiceResponse` — `partial_success` populated with counts of rejected spans on any row-level validation failure.
- Partial-success reporting: per the OTLP spec, when only some spans fail (e.g. parent-span not in same batch), set `partial_success.rejected_spans` and an `error_message`. Do NOT roll back the whole batch.
- Idempotency: derive `spans.id` and `run_id` deterministically (UUIDv5) from OTel IDs so a retried export upserts cleanly via `migrations/006_ingest_rpc.sql:109-116` (`ON CONFLICT (id) DO UPDATE`).

### A.6 — What this section does NOT change

- `private.ingest_batch` (`migrations/006_ingest_rpc.sql:11-153`) — unchanged.
- `private.spans` / `private.runs` / `private.events` schemas — unchanged.
- The Python SDK payload format (`src/northstar/client.py:97-106`) — unchanged.
- The dashboard `DashboardTrace` / `DashboardSpan` types (`dashboard/lib/supabase/types.ts:224-265`) — unchanged.

### A.7 — File path list & sequencing

| Order | File | Action |
|---|---|---|
| 1 | `supabase/functions/otel-ingest/index.ts` (new) | Decoder, translator, ingest wrapper |
| 2 | `supabase/functions/otel-ingest/index_test.ts` (new) | Mirror the existing `supabase/functions/ingest-traces/index_test.ts:1` test structure |
| 3 | `supabase/config.toml` | Register the new function (existing `[functions.ingest-traces]` block at `supabase/config.toml:38`) |
| 4 | `README.md` | Add OTel export env vars |
| 5 | (optional) `src/northstar/otel_shim.py` (new) | Convenience auto-instrumentor |

**Sequencing rationale:** The Edge Function can be written and unit-tested before any client work.

### A.8 — Risks

1. **gRPC at the Edge.** Supabase Edge Functions are Deno and may not yet expose a public gRPC listener on `:4317`. **Mitigation:** ship OTLP/HTTP first; add gRPC in a follow-up via a Cloudflare Worker with `connectrpc` if Edge Functions don't grow gRPC. The OTLP/HTTP spec is identical at the payload level.
2. **UUIDv5 collision across projects.** Two projects ingesting OTel traces with the *same* `trace_id` will hash to the *same* `run_id` if the namespace is the trace_id alone. **Mitigation:** namespace MUST be `project_id || trace_id` (concatenated).
3. **OpenInference legacy key explosion.** `openinference.*` attributes are verbose and unbounded. **Mitigation:** cap at 64 attributes per span in the translator.
4. **No `service.name` collision check.** **Mitigation:** in v1, reject ambiguous resolutions with 400.
5. **Schema drift.** The OTel GenAI semconv is in `Development` status. **Mitigation:** wrap attribute reads in a single `otelAttrs(span)` helper with a one-line change budget per release.

---

## Section B — Alerts + Webhooks + Rules (SOTA gap #6)

**Goal:** Replace the alerts/webhooks stub at `dashboard/components/settings-page.tsx:584-603` with a real CRUD UI backed by a Postgres-resident evaluation engine and an HMAC-signed webhook delivery worker.

### B.1 — Schema (new migration `migrations/027_alerts_webhooks.sql`)

Four tables, all in `private`, all `ENABLE ROW LEVEL SECURITY`, all granted to `service_role`.

```
private.alert_rules
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
  project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE
  name            TEXT NOT NULL
  kind            TEXT NOT NULL CHECK (kind IN ('threshold','anomaly'))
  metric          TEXT NOT NULL CHECK (metric IN ('latency_p95_ms','error_rate',
                                  'cost_per_session_usd','tokens_per_minute',
                                  'span_error_count','session_failure_count'))
  window_minutes  INTEGER NOT NULL CHECK (window_minutes BETWEEN 1 AND 1440)
  threshold_value NUMERIC NOT NULL
  condition       JSONB NOT NULL DEFAULT '{}'::jsonb
  channels        JSONB NOT NULL DEFAULT '[]'::jsonb
  enabled         BOOLEAN NOT NULL DEFAULT true
  cooldown_minutes INTEGER NOT NULL DEFAULT 15
  last_fired_at   TIMESTAMPTZ
  created_by      TEXT
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  INDEX (project_id, enabled)
  INDEX (last_fired_at) WHERE enabled

private.webhook_endpoints
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
  project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE
  name            TEXT NOT NULL
  url             TEXT NOT NULL
  secret          TEXT NOT NULL
  event_types     TEXT[] NOT NULL DEFAULT ARRAY['alert.fired']::TEXT[]
  enabled         BOOLEAN NOT NULL DEFAULT true
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  UNIQUE (project_id, name)
  INDEX (project_id, enabled)

private.alert_events
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
  rule_id         UUID NOT NULL REFERENCES private.alert_rules(id) ON DELETE CASCADE
  project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE
  fired_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  value           NUMERIC NOT NULL
  trace_ids       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
  delivered_to    JSONB NOT NULL DEFAULT '[]'::jsonb
  status          TEXT NOT NULL CHECK (status IN ('firing','delivered','partial',
                                                   'failed','dead_lettered'))
  attempt_count   INTEGER NOT NULL DEFAULT 0
  next_retry_at   TIMESTAMPTZ
  INDEX (project_id, fired_at DESC)
  INDEX (status, next_retry_at) WHERE status IN ('firing','partial','failed')

private.alert_subscriptions
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
  project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE
  user_id         TEXT NOT NULL
  channel         TEXT NOT NULL CHECK (channel IN ('email','slack','webhook'))
  target          TEXT NOT NULL
  alert_rule_id   UUID NOT NULL REFERENCES private.alert_rules(id) ON DELETE CASCADE
  UNIQUE (alert_rule_id, channel, target)

private.webhook_dead_letters
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
  event_id        UUID NOT NULL REFERENCES private.alert_events(id) ON DELETE CASCADE
  project_id      UUID NOT NULL
  endpoint_id     UUID NOT NULL
  payload         JSONB NOT NULL
  last_status     INTEGER
  last_error      TEXT
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  INDEX (project_id, failed_at DESC)
```

### B.2 — Evaluation engine: recommend **pg_cron + plpgsql aggregate**

| Option | Latency | Failure modes | Cost | Verdict |
|---|---|---|---|---|
| Postgres trigger on `INSERT INTO private.spans` | Sub-second | Tightly couples writes to alert evaluation | Free | **Reject** |
| Supabase Edge Function cron | 1 min (cron) | Separate execution context | Edge Function invocations | Viable, but cold-start jitter |
| **pg_cron + plpgsql aggregate function** | 1 min (configurable) | Self-contained; no extra infrastructure | Free | **Recommend** |

**Design:**
1. Add `pg_cron` extension.
2. Schedule a job every minute: `SELECT cron.schedule('northstar-evaluate-alerts', '* * * * *', $$SELECT private.evaluate_alerts()$$);`
3. The function reads every `enabled` rule and computes its metric over the trailing `window_minutes`:
   - `latency_p95_ms` → `percentile_cont(0.95) WITHIN GROUP (ORDER BY (EXTRACT(EPOCH FROM (ended_at - started_at))*1000))`
   - `error_rate` → `count(*) FILTER (WHERE status='error')::numeric / nullif(count(*),0)`
   - `cost_per_session_usd` → average `metadata->>'cost_usd'` from `private.runs` over the window
   - `tokens_per_minute` → sum(input + output tokens) divided by window
   - `span_error_count` / `session_failure_count` → simple counts
4. If the value crosses the threshold AND `last_fired_at + cooldown_minutes <= now()`, the function:
   - Inserts a `private.alert_events` row with `status='firing'`, `value=<current>`, and up to 25 sample `trace_ids` for the dashboard drilldown.
   - Updates the rule's `last_fired_at`.

### B.3 — Webhook delivery worker

A Supabase Edge Function `supabase/functions/alert-dispatcher/index.ts`, triggered by `pg_cron` every 30s, that:

1. Selects up to 100 rows from `private.alert_events` where `status IN ('firing','partial','failed') AND next_retry_at IS NULL OR next_retry_at <= now()` ordered by `fired_at`.
2. For each row, resolves the destination endpoints from `alert_rules.channels` (or `alert_subscriptions` if `channel='webhook'`).
3. Builds the JSON payload:
   ```
   {
     "id": "<alert_event_id>",
     "type": "alert.fired",
     "rule": {"id": "...", "name": "...", "metric": "..."},
     "fired_at": "...",
     "value": <number>,
     "threshold": <number>,
     "trace_ids": ["..."],
     "project_id": "<uuid>"
   }
   ```
4. Signs with `X-NorthStar-Signature: sha256=<hex>` over the raw body using the endpoint's `secret` (HMAC-SHA256). Also sets `X-NorthStar-Event-Id`, `X-NorthStar-Event-Type`, `X-NorthStar-Timestamp`.
5. POSTs to `webhook_endpoints.url` with a 10s `fetch` timeout.
6. On response:
   - 2xx → `status='delivered'`
   - 4xx (not 408/429) → `status='dead_lettered'`, write to `private.webhook_dead_letters`
   - 5xx / 408 / 429 / network error → `status='partial'`, `next_retry_at = now() + (2^attempt_count) * INTERVAL '30 seconds' + random jitter`, max 6 attempts.
7. **Retries with exponential backoff:** 30s, 60s, 2m, 4m, 8m, 16m.
8. **Built-in integrations v1:** generic HMAC webhook + Slack (Block Kit). PagerDuty v1.5.

### B.4 — Built-in integrations: in-repo modules

`supabase/functions/alert-dispatcher/integrations/`: `slack.ts`, `webhook.ts`, `pagerduty.ts`.

### B.5 — API surface (dashboard, server-side)

```
GET    /api/projects/:projectId/alert-rules
POST   /api/projects/:projectId/alert-rules
PATCH  /api/projects/:projectId/alert-rules/:ruleId
DELETE /api/projects/:projectId/alert-rules/:ruleId

GET    /api/projects/:projectId/webhook-endpoints
POST   /api/projects/:projectId/webhook-endpoints
DELETE /api/projects/:projectId/webhook-endpoints/:id

GET    /api/projects/:projectId/alert-events?since=...
POST   /api/projects/:projectId/alert-events/:id/replay
```

### B.6 — UI (settings-page.tsx)

Replace `function AlertSettings()` (`settings-page.tsx:584`) with three sub-components: `AlertRulesTab`, `WebhooksTab`, `AlertHistoryTab`. The `tabs` array entry at `settings-page.tsx:57` already has `id: 'alerts'`; add `id: 'webhooks'` and `id: 'alert-history'`. Reuse the existing `SettingsSection` (`settings-page.tsx:672`), `Field` (`settings-page.tsx:681`).

1. **Alert rules form**: metric dropdown, threshold number input, window-minutes slider, channels multi-select, save button.
2. **Webhooks form**: name, URL (validate `^https://`), event types checkbox list, save button. Display the secret once in a `KeyCard` pattern (`settings-page.tsx:702-739`).
3. **Alert history tab**: chronological list of `alert_events` rows with status pills, drilldown to the trigger rule and the sample trace_ids.

Remove `DisabledButton` calls at `settings-page.tsx:597, 612, 632, 639, 762-763`. `DisabledButton` itself (`settings-page.tsx:694-700`) becomes dead code; delete it.

### B.7 — File path list

| Order | File | Action |
|---|---|---|
| 1 | `migrations/027_alerts_webhooks.sql` (new) | All four tables + RLS + grants + `pg_cron` + `evaluate_alerts()` + trigger to materialize channels |
| 2 | `migrations/028_alert_cron.sql` (new) | Schedule `evaluate_alerts` |
| 3 | `migrations/029_alert_dispatcher_cron.sql` (new) | Schedule `alert-dispatcher` |
| 4 | `supabase/functions/alert-dispatcher/index.ts` (new) | Worker described in B.3 |
| 5 | `supabase/functions/alert-dispatcher/integrations/{slack,webhook,pagerduty}.ts` (new) | Payload formatters |
| 6 | `dashboard/lib/server/alert-store.ts` (new) | Server module |
| 7-12 | `dashboard/app/api/projects/[projectId]/alert-rules/...` + `webhook-endpoints/...` + `alert-events/...` (new) | API routes |
| 13 | `dashboard/lib/supabase/types.ts` | Add the four new private table types |
| 14 | `dashboard/components/settings-page.tsx` | Replace `AlertSettings`; add Webhooks + Alert History tabs; remove `DisabledButton` calls; delete `DisabledButton` component |
| 15 | `dashboard/components/alert-rule-form.tsx` (new) | Reusable form |
| 16 | `dashboard/components/webhook-endpoint-form.tsx` (new) | Reusable form |

### B.8 — Risks

1. **pg_cron execution budget.** At 1M spans/min, naive scan per rule per minute is a problem. **Mitigation:** v1 limit per project to ≤20 active rules; v1.5 add `private.alert_rollups_5m` continuous-aggregate.
2. **Webhook signing secret leakage.** **Mitigation:** server store returns `secret` only on the create response.
3. **Slack webhook URL is a secret, not a signature.** **Mitigation:** document this in the UI.
4. **Dead-letter visibility.** **Mitigation:** alert history tab shows dead-lettered rows with a "Replay" button.
5. **Per-user subscriptions without users table.** `alert_subscriptions.user_id` is `TEXT` not `UUID REFERENCES users(id)` because `users` doesn't exist yet.

---

## Section C — Real-Time Live Tail (SOTA gap #7)

**Goal:** Make `dashboard/components/real-time-indicator.tsx:1-46` (currently a healthcheck-only pill) into a real subscription to new spans/events. Surface a "Live" toggle in `trace-list` and `session-detail` views.

### C.1 — Transport: Supabase Realtime (Postgres logical replication)

| Transport | Cost | Complexity | Tail latency | Verdict |
|---|---|---|---|---|
| **Supabase Realtime (Postgres CDC)** | Free up to 5M messages/mo | Low | ~200ms | **Recommend** |
| Custom WebSocket | Vercel/Supabase invocation costs | High | ~100ms | Reject |
| SSE | Free | Medium | ~150ms | Reject for prod |

Supabase Realtime subscribes to `postgres_changes` events on tables in the `supabase_realtime` publication. Existing usage is at `dashboard/components/real-time-indicator.tsx:10-20` (a 'healthcheck' channel).

### C.2 — Subscribe model: per-project channel

The naive approach is to put `private.spans` in the `supabase_realtime` publication. **Do not do this** — `private` is explicitly *not* exposed via the Supabase Data API (`migrations/006_ingest_rpc.sql:227-231`).

**Solution: a `public.spans_live` projection view.**

Add to `migrations/030_live_tail_projection.sql` (new):
- A **view** `public.spans_live` that selects from `private.spans` with the *minimum* columns a tail client needs: `id, project_id, run_id, name, kind, status, started_at, attributes`.
- A trigger `private.spans_after_insert` that does `INSERT INTO public.spans_live ... ON CONFLICT (id) DO NOTHING`. Append-and-prune: stores only the last N rows per project (e.g. last 200), old rows deleted by a `pg_cron` job every 30s.
- The `public.spans_live` table is `GRANT SELECT TO authenticated` and protected by a per-project RLS policy:
  ```sql
  CREATE POLICY spans_live_by_project ON public.spans_live
    FOR SELECT TO authenticated
    USING (project_id = private.request_project_id());
  ```
- Add `public.spans_live` to the `supabase_realtime` publication.

### C.3 — Channel naming + client code

```
supabase.channel(`project:${projectId}:spans`)
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'spans_live',
        filter: `project_id=eq.${projectId}` },
      payload => onNewSpan(payload.new))
  .subscribe();
```

### C.4 — UI

1. **`RealtimeIndicator` upgrade** (`dashboard/components/real-time-indicator.tsx:1-46`):
   - Replace the `healthcheck` channel with a *subscribed* channel.
   - Add a "Live" toggle; when off, channel unsubscribed.
2. **Live tail in `trace-list` / `session-detail` views**: subscribe to the channel, append new spans with a 300ms fade-in, auto-scroll, "↓ N new" button.
3. **Backpressure:** cap in-memory ring buffer at 500 spans; if subscription rate exceeds 100 events/sec, coalesce consecutive spans with the same `name` into a "+12 `tool.web_search`" line.

### C.5 — File path list

| Order | File | Action |
|---|---|---|
| 1 | `migrations/030_live_tail_projection.sql` (new) | `public.spans_live` table + insert trigger on `private.spans` + RLS + publication + `pg_cron` prune job |
| 2 | `dashboard/lib/supabase/client.ts` | Add `subscribeToProjectSpans(projectId, onSpan)` helper |
| 3 | `dashboard/components/real-time-indicator.tsx` | Replace healthcheck with data subscription; add toggle prop |
| 4 | `dashboard/components/live-span-list.tsx` (new) | Bounded list with fade-in, auto-scroll, "↓ N new" pill |
| 5 | `dashboard/app/(workspace)/projects/[projectId]/sessions/page.tsx` | Mount `<LiveSpanList>` when "Live" is toggled |
| 6 | `dashboard/app/(workspace)/projects/[projectId]/sessions/[id]/page.tsx` | Mount same component, filter to that session's `run_id`s |
| 7 | `dashboard/components/trace-detail-timeline.tsx` | If `liveMode` prop, subscribe and append |

### C.6 — Risks

1. **Trigger cost in the write path.** A `BEFORE INSERT` trigger on `private.spans` runs on every span ingest. The trigger body is cheap (one insert into a small `public` table) but still adds 1–2ms to every span.
2. **Realtime row-size limits.** Supabase Realtime has a hard ~1MB-per-message limit. **Mitigation:** projection excludes `attributes`; client refetches on click.
3. **No `authenticated` users in the project yet.** RLS on `public.spans_live` requires the JWT to carry `project_id`. If the middleware bypass (`dashboard/middleware.ts:33-46`) is still in effect, the live tail silently receives zero rows. **Mitigation:** add a smoke test in CI.
4. **Realtime quota on the free tier.** 5M messages/mo. **Mitigation:** projection table is pruned to 200 rows; prune job keeps server-side rate bounded.
5. **Multi-tab storms.** 10 dashboard tabs × same project = 10 subscriptions. **Mitigation:** use Supabase Realtime's Broadcast in v1.5.

---

## Section D — Multi-Modal Session Replay (SOTA gap #9)

**Goal:** Make `dashboard/components/trace-detail-timeline.tsx:1-877` render images, PDFs, audio, and generic file attachments inline.

### D.1 — Storage

- Bucket name: `trace-attachments`. Path layout: `{project_id}/{trace_id}/{attachment_id}.{ext}`.
- Max file size: **50 MB** per file.
- Quota: **1 GB per project per day**.

### D.2 — Schema (`migrations/028_attachments.sql`)

```
private.attachments
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
  project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE
  run_id          UUID NOT NULL REFERENCES private.runs(id) ON DELETE CASCADE
  span_id         UUID REFERENCES private.spans(id) ON DELETE SET NULL
  kind            TEXT NOT NULL CHECK (kind IN ('image','audio','pdf','file'))
  mime            TEXT NOT NULL
  size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800)
  storage_path    TEXT NOT NULL UNIQUE
  sha256          TEXT NOT NULL
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
  uploaded_by     TEXT
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  INDEX (project_id, run_id)
  INDEX (span_id) WHERE span_id IS NOT NULL
  INDEX (sha256)
```

A second new table, `private.attachment_daily_quotas`, is a daily rollup populated by `pg_cron` to enforce the 1GB cap.

### D.3 — Storage RLS

```
CREATE POLICY attachments_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'trace-attachments'
         AND (storage.foldername(name))[1]::uuid = private.request_project_id());
```

For uploads, use a **signed upload URL** issued by an Edge Function (Deno) that:
1. Verifies the API key (bearer) and resolves `project_id`.
2. Checks the quota (1GB/day).
3. Issues a short-lived (5min) signed upload URL via `supabase.storage.createSignedUploadUrl`.
4. Returns the signed URL + the eventual `storage_path`.

The client uploads directly to the signed URL (browser → Supabase Storage, not through the Edge Function), then calls a `POST /api/.../attachments` to write the `attachments` row.

### D.4 — Ingest path: SDK `attach()` helper

Extend the Python SDK in `src/northstar/models.py`:

```python
class Span:
    def attach(self, path: str | Path, *, kind: Literal["image","audio","pdf","file"], mime: str | None = None) -> str
```

Implementation:
1. Read the file; compute `sha256`; size check ≤50MB.
2. Call `Northstar._upload_attachment(span_id, file_bytes, kind, mime) -> attachment_id`. The client uses httpx to:
   a. `POST /functions/v1/attachments/sign` with bearer + `{span_id, kind, mime, sha256, size}` → gets `{upload_url, storage_path, attachment_id}`.
   b. `PUT` the file bytes to `upload_url`.
   c. `POST /functions/v1/attachments/commit` with `{attachment_id}` → server inserts the `private.attachments` row.
3. The Span's `attributes` gets a `{"attachments": ["<attachment_id>", ...]}` entry.

### D.5 — UI rendering in `trace-detail-timeline.tsx`

1. New component `AttachmentPreview({ attachment })`:
   - `kind === 'image'` → `<img>` with click-to-fullscreen.
   - `kind === 'audio'` → `<audio controls>` + a thin waveform.
   - `kind === 'pdf'` → `<iframe>`.
   - `kind === 'file'` → Download link.
2. In `MessagePreview` (`trace-detail-timeline.tsx:674-702`), detect when the event's `content` or `attributes` includes `attachments: [...]` and render `<AttachmentPreview>` inline.
3. **Modal full-screen** for images/PDFs: a new `dashboard/components/attachment-modal.tsx` that handles ESC-to-close and traps focus.
4. **Signed URL fetching:** the dashboard calls a new server route `POST /api/attachments/sign` with `{ attachment_id }`; the server verifies RLS and returns a 5-min signed URL.

### D.6 — API surface

```
POST   /api/projects/:projectId/attachments/sign
POST   /api/projects/:projectId/attachments/commit
GET    /api/projects/:projectId/attachments/:id
DELETE /api/projects/:projectId/attachments/:id
GET    /api/projects/:projectId/traces/:traceId/attachments
```

The Edge Function `supabase/functions/attachments/index.ts` mirrors these as the SDK-facing routes.

### D.7 — File path list

| Order | File | Action |
|---|---|---|
| 1 | `migrations/028_attachments.sql` (new) | `private.attachments` table + storage bucket + RLS + quota job |
| 2 | `supabase/functions/attachments/index.ts` (new) | Sign / commit / read / delete |
| 3 | `dashboard/lib/server/attachment-store.ts` (new) | Server module |
| 4-7 | `dashboard/app/api/projects/[projectId]/attachments/...` (new) | API routes |
| 8 | `src/northstar/models.py` | Add `Span.attach()` method |
| 9 | `src/northstar/client.py` | Add `_upload_attachment` |
| 10 | `dashboard/components/attachment-preview.tsx` (new) | Per-kind renderer |
| 11 | `dashboard/components/attachment-modal.tsx` (new) | Full-screen overlay |
| 12 | `dashboard/components/trace-detail-timeline.tsx` | Detect attachment refs and embed `<AttachmentPreview>` |
| 13 | `dashboard/lib/supabase/types.ts` | Add `DashboardAttachment` interface |

### D.8 — Risks

1. **Quota enforcement is racy.** Two parallel uploads both check `sum(bytes_used) < 1GB` before inserting; both pass; quota is now 2× over. **Mitigation:** use `pg_advisory_xact_lock(hashtext(project_id))`.
2. **Path traversal in `storage_path`.** **Mitigation:** generate `storage_path` server-side as `crypto.randomUUID()`.
3. **Memory blow-up on large files.** **Mitigation:** stream the upload via `httpx` `stream` parameter, or use `tus` resumable uploads in v1.5.
4. **Wrong FK target.** As noted in D.2, `trace_id` vs `run_id` is a confusion waiting to happen. **Mitigation:** column is `run_id` in the DB; the public view renames to `trace_id`.
5. **PII / image content moderation.** A user uploads a screenshot containing a credit card number. **Mitigation:** v1 is "user is responsible." v1.5 add a `metadata.redacted: bool` field and a "redact" button.
6. **Cost.** 1GB/day per project at the Pro tier of Supabase Storage = ~$0.021/GB/mo. Not a real risk at SOTA scale.

---

## Cross-cutting notes

- **Build order across the four sections.** All four sections are independent. Suggested order: **C (live tail) → A (OTel) → D (attachments) → B (alerts)**. C unblocks the "live" feel and is the smallest SQL change. A is the biggest ingest change but isolated to one new Edge Function. D is a self-contained feature. B is the largest because of the cron + Edge Function + UI surface and benefits from C being live.
- **One shared auth concern.** All four sections assume the API key (`migrations/006_ingest_rpc.sql:162-173`) is the project-resolution primitive. The middleware bypass in `dashboard/middleware.ts:33-46` is a separate P0 (gap #2) — out of scope here.
- **Privacy across sections.** OTel (A) brings in `service.name` and possibly PII. Webhooks (B) leak the rule + trace_ids to third-party URLs. Attachments (D) are user-uploaded. The settings page (currently a stub at `settings-page.tsx:584-603`) has no "data retention" controls; recommend adding a Retention tab to settings as a follow-up.
- **No migration of existing data.** All four sections are additive.

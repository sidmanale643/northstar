Performance & Over-Engineering

  High-impact:

  - _json_safe double-serializes every payload (api.py:75-76) — full json.dumps → json.loads round-trip per record. Just redact; Pydantic handles JSON-safety.
  - _pending_count() is O(n) per call (api.py:299-302) and runs on every log_event/start_span/etc. → O(n²) on a 50-message capture. Track a single counter.
  - HTTP I/O happens inside _lock in _flush_now (api.py:333-348) — a 30s backend stall freezes the agent app despite the "no-op stubs" README claim.
  - httpx.Client is created per flush (client.py:204-237) — new TCP+TLS handshake per flush_interval. Reuse one.
  - litellm.token_counter is uncached — re-tokenizes identical message lists on every LLM call. Add an LRU keyed on (model, frozenset(messages)).
  - Queue-full drops data silently with only a print (api.py:306-311) — needs a counter on state and a real warning, not "no-op".

  Over-engineering: init vs init_logger are the same function (#13); sync/async wrappers in instrumentation/common.py duplicate ~80% of the body (#14); the 800-line
  graders.py has 13+ classes all hand-building GradeResult (#15).

  Trivial: pricing.format_cost has two identical branches (< 0.01 and < 1 both return .4f) — pricing.py:81-92.

  ───
  Security

  Critical / High:

  - PythonCodeGrader runs untrusted user code (graders.py:458-516) via subprocess.run(["uv", "run", "python", ...]) with the dashboard's full env. Anyone with
  dataset-create rights on the dashboard gets RCE on the server. Run in a locked container with network=none, empty cwd, dropped env.
  - Dev-mode auth bypass (dashboard/lib/api/project-access.ts:50-52 and dashboard/lib/supabase/server.ts:10): NODE_ENV !== "production" → returns true; x-api-key ===
  DASHBOARD_API_KEY → service-role client. Preview deployments are wide open. Use an explicit ALLOW_UNAUTHENTICATED_DASHBOARD=1 flag, never default to open.
  - SSRF in webhook creation (dashboard/app/api/projects/[projectId]/webhooks/route.ts:47-66): only validates https://. Reject 169.254.169.254, 127.0.0.1, 10.0.0.0/8,
  metadata.google.internal, etc.
  - Webhook test-fire logs the full body to stdout (dashboard/app/api/projects/[projectId]/webhooks/[webhookId]/route.ts:30-50) — unbounded size, PII leakage to log
  streams, and a 5GB JSON body will be fully serialized. Cap body size.
  - CORS * on ingest edge function (supabase/functions/ingest-traces/index.ts:11-13) — combined with the per-project API key, any origin can submit batches; if a customer
  embeds their key in a public site, the response is readable cross-origin. Echo Origin from an allowlist.
  - Redact set is missing bearer and x-api-key (api.py defaults) — Anthropic-style x-api-key headers would not be redacted if they ever appear in payloads.

  Medium: request.headers.get('x-api-key') === dashboardApiKey is timing-unsafe — use crypto.timingSafeEqual. default=repr in _json_safe can leak __repr__ of objects
  containing secrets. Auth callback next param (dashboard/app/auth/callback/route.ts:6) — currently safe-by-concat but should be validated (startsWith('/') &&
  !startsWith('//')).

  Low / polish: No X-Content-Type-Options: nosniff or CSP headers; no body-size cap on most Next.js JSON routes (eval dataset has 10MB but others don't); .env doesn't
  appear to be in .gitignore.

  ───
  Logical Bugs & Edge Cases

  High:

  - _pending_count ignores _pending_scores and _pending_prompt_links (api.py:299-310). score() appends to _pending_scores without going through _has_capacity — score-heavy
   workloads can blow past max_queue_size unbounded.
  - start_trace reserves 2 records, but a real trace can produce dozens — combined with the above, the queue-full guard is essentially decorative.
  - _pending_scores are lost on re-init (api.py:766-770): old_state.shutdown() flushes, but on failed flush, retained scores die with the old worker. Silent data loss in
  the observability system.
  - capture_inputs=False / capture_outputs=False don't suppress LLM final_response events in the instrumentation path (instrumentation/common.py) — only auto-captured
  content respects flags; record_output_message always emits. README's contract is broken.
  - record_output_message recomputes cost against the last input_tokens, not the cumulative total (models.py:608-635). A 4-turn tool-use agent under-reports cost by ~4×.
  - Streaming LLMService.stream doesn't finalize the model span if the chunk loop raises (llm.py:101-181) — record_output_message is skipped, span stuck in "running" until
   next flush.
  - _validate_response raises ValueError on bad JSON, but ValueError is not in the retry set (client.py:339-353) — a 200-OK with a proxy's HTML error page will retry
  forever.

  Medium:

  - init_logger silently drops enabled and debug (api.py:772-793) — kwargs accepted, never forwarded. init() doesn't validate the resolved enabled type either.
  - start_trace swallows all exceptions → returns _NoopTrace() for unserialisable inputs instead of raising. The user gets silent drops in debug mode.
  - _active_spans pop fallback (models.py:264-279) does an O(n) linear-search remove if the popped span isn't the top — silently allows out-of-order exits instead of
  raising. Combined with a child span that outlives its parent, all subsequent run.span() calls inherit the wrong parent.
  - Redaction misses bytes/bytearray/memoryview — bytes(b"password=hunter2") is shipped verbatim. Also default=repr leaks Path and datetime objects that contain secrets in
   __repr__.
  - Re-init ships in-flight runs to the old client with no warning (api.py:766-770). The test test_trace_finishes_on_originating_client_after_reinitialization locks this
  in as intentional, but it's surprising to users.
  - Three enqueues per run finish (record_error → Run.__exit__ → _finish_trace) — capacity check only in record_run_output, so latency_ms can be lost on a near-full queue.
  - request_id uses or instead of is not None (instrumentation/common.py:78-82) — _request_id="" or 0 falls through to the wrong field.

  Polish:

  - log_metric rejects np.bool_ (numpy bool is a bool subclass) but accepts np.int64 — inconsistent.
  - _TraceFactory and LLMService expose different "no-op" failure modes — same call inside vs. outside an active trace has different exception behaviour.
  - value_at(response, "_request_id") or value_at(response, "request_id") — should be explicit.

  ───
  Top triage priority (largest blast radius, smallest fix):

  1. _pending_count excludes scores/prompt-links (correctness)
  2. capture_outputs=False doesn't actually suppress LLM events (broken contract)
  3. _validate_response ValueError poison-pill (queue stuck forever)
  4. Queue-full silent data loss needs a visible counter
  5. Un-shipped scores lost on re-init
  6. Dev-mode auth bypass → explicit flag
  7. Webhook SSRF protection
  8. Sandbox the code graders
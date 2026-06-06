# NorthStar — Roadmap to SOTA

**Synthesized from `SOTA.md` (the gap analysis) and six parallel design subagent runs.** Each workstream below has a detailed design doc in `docs/roadmap/`.

---

## TL;DR — score and the path

| | SOTA score | After this roadmap |
|---|---|---|
| Langfuse / Braintrust / LangSmith | 49–50 / 50 | — |
| **NorthStar today** | **14 / 50** | — |
| **After Quick Wins (~2 dev-days)** | 14 + 5 partials closed = ~19 / 50 | First demoable improvements, no schema risk |
| **After Phase 1 workstreams (~3–4 weeks)** | ~33 / 50 | Shippable to a small team; closes P0 security |
| **After Phase 2 workstreams (~6–8 weeks)** | ~46 / 50 | SOTA parity; only multi-tenant SSO + dataset A/B remain as gaps |

**Two non-negotiables first** (from SOTA §"Non-negotiables"):
1. **Auth + multi-tenancy** (gap #2) — anonymous browsers can read all projects; not shippable to any team today.
2. **Scores + prompts + feedback loop** (gaps #3, #4) — the single biggest reason a team would pick Langfuse at parity.

Everything else is sequenced behind these two.

---

## Quick wins (7 items, ~2 dev-days total)

Detail: `docs/roadmap/01-quick-wins.md`

| # | Fix | Effort | PR order |
|---|---|---|---|
| QW1 | Re-enable middleware auth (`middleware.ts:33-46` is commented out — P0) | 1–2 hr | **PR1** |
| QW3 | Show error banner on trace view when `runs.error` is non-null (field already exposed by mig 015) | 2 hr | **PR2** |
| QW6 | "Errored" filter chip + wire the hardcoded `errored=0` at `sessions/page.tsx:153` to real data | 1–2 hr | **PR3** |
| QW7 | Render tool calls in the session timeline (`trace-timeline.tsx:21-28` is LLM-only) | 2 hr | **PR4** |
| QW5 | Per-run CSV export button on trace detail | 2 hr | **PR5** |
| QW2 | Debounced text search + "no server search yet" CTA above tables | ½ day | **PR6** |
| QW4 | Wire the alerts settings tab to a real form with "log to console" webhook | 1 day | **PR7** |

**Recommended execution order** in the table above. QW1 ships first because every other change is a UI/data tweak you don't want to ship in a publicly-readable state. QW3/6/7 produce data that makes QW5/2/4 demonstrable.

---

## Phase 1 workstreams (3–4 weeks, ships a beta to a small team)

### A. Auth + multi-tenancy + RBAC — **P0 security + shipability blocker**

Detail: `docs/roadmap/02-auth-rbac.md`. Closes SOTA gaps #2 and #10.

**Migration `023_auth_rbac.sql` adds:** `orgs`, `org_members`, `project_members`, `org_invites`, `audit_logs`. Extends `api_keys` to support org-scoped keys alongside legacy project keys. All RLS rewritten to be membership-based (`user_has_org_role()`, `user_has_project_role()`).

**Smallest shippable increment (1 dev-day):** QW1 + migration + trigger-based user mirror + bootstrap-new-user Edge Function + server-side project resolution (replace `localStorage` in `project-provider.tsx`). After this step: signup → login → see only your projects → SDK ingest still works.

**Bigger scope (additional 1 week):** Team tab invites, top-nav org switcher + user menu, billing tab wiring, audit log viewer, dev-bypass env flag, `lib/supabase/server.ts:8-22` cleanup (currently a production-time backdoor).

**Critical sequencing note:** the dashboard's `createAdminClient()` calls in `lib/supabase/dashboard.ts:9` bypass RLS by design. RLS work is decorative until the dashboard reads via user-scoped clients (Step 4 of the design doc). Don't ship the migration without flipping this — it's a false sense of security.

### B. Search / filter / saved views / tags / bulk export

Detail: `docs/roadmap/03-search-tags.md`. Closes SOTA gaps #1 and the tag/saved-filter parts of #10. "Single largest UX gap" per SOTA §5.

**Migration `026_search_tags.sql` adds:** `tags`, `run_tags`, `span_tags`, `saved_filters`; `pg_trgm` + GIN `tsvector` indexes on `events.content` and `spans.attributes`; extends `dashboard_list_sessions` with `error_count` + `tag_ids`; introduces `dashboard_search_{traces,sessions,runs,spans}` RPCs with cursor pagination and `ts_rank` + recency-boost ordering.

**3 phases:**
- **Phase 1 (≤ 1 week):** real error count, "Errored" chip, tag CRUD as data plumbing. Ships without server-side search.
- **Phase 2 (≤ 1 week):** saved filters, filter chip DSL, bulk action bar, CSV/JSONL streaming export.
- **Phase 3 (≤ 2 weeks):** full-text search RPCs, server-mode `useSearch` hook beyond 500 rows, shared team views in sidebar.

**Calibration finding** (from design subagent): the `runs` table has **no `input`/`output` columns** — actual prompt/completion text lives in `private.events.content`. FTS must target events + spans.attributes, not runs. Don't make the obvious mistake.

### C. Online scores + annotation queues + human feedback

Detail: `docs/roadmap/04-scores-feedback.md`. Closes SOTA gap #4 (5 of 5 rows in §7 scorecard).

**Migration `024_scores_feedback.sql` adds:** `scores`, `scorers`, `annotation_queues`, `annotation_queue_items`, `comments`, `score_aggregations` (materialized view). Unifies the offline/online halves by promoting `eval_runs.result` grades into `scores` with `source='auto'`.

**Auto-scorer rules engine** (SOTA §7.4): `LISTEN/NOTIFY` on `spans` insert → Supabase Edge Function worker → applies `filter` + `sample_rate` → calls `private.run_scorer_rule(rule_id, span_id)`. **Not** a synchronous Postgres trigger on the write path (would block ingest on LLM latency).

**6 phases, smallest first:** schema → manual scores + SDK `client.score(...)` + `ScorePanel` in trace inspector → eval unification backfill → comments → annotation queues + Cohen's κ → auto-scorer rules + worker.

**MVP demo (after phase 1):** user installs SDK, calls `client.score(trace_id, "correctness", 0.8, comment="looks fine")`, opens the trace, sees the score chip + comment.

---

## Phase 2 workstreams (3–4 weeks, SOTA parity)

### D. Prompt management

Detail: `docs/roadmap/05-prompts.md`. Closes SOTA gap #3 (5 of 5 rows in §6 scorecard).

**Migration `025_prompts.sql` adds:** `prompts` (with `labels JSONB`), `prompt_versions` (immutable content + config snapshots), `prompt_label_history` (append-only audit), `prompt_trace_links` (span ↔ version, captured at SDK ingest time).

**Key design decisions:**
- Labels are `JSONB` on `prompts` (read model) + `prompt_label_history` (event log) — not a separate `prompt_deployments` table. Hot path is one indexed SELECT.
- `change_note` is **required** when promoting to `prod` (enforced server-side in RPC).
- Trace linking is captured at SDK ingest via `pull_prompt(name).bind(variables={...})` context manager — no fuzzy post-processing.

**4 phases:** registry + version CRUD + SDK pull (MVP) → trace linking → playground + save-to-dataset → diff view + promote-to-label with required change notes.

### E. OTel / OpenInference ingest

Detail: `docs/roadmap/06-otel-alerts-live-multimodal.md` §A. Closes SOTA gap #5.

**New Edge Function** `supabase/functions/otel-ingest/index.ts` accepts OTLP/HTTP (protobuf + JSON, gzip) on `POST /v1/traces`. Reuses the existing `private.resolve_api_key` and `private.ingest_batch` RPCs — **zero schema change**. Maps OTel fields to `private.spans`/`private.events` (see translation table A.2 in the design doc). UUIDv5 derives `spans.id` and `run_id` from OTel IDs so retries upsert cleanly. `service.name` and a custom `northstar.project_id` resource attribute resolve the project.

**OpenInference legacy key shim** (`openinference.span.kind` ∈ {LLM, TOOL, AGENT, CHAIN, RETRIEVER, EMBEDDING, RERANKER, GUARDRAIL, EVALUATOR}) maps to NorthStar's `kind` enum via the precedence in §A.3.

**gRPC deferred** to v1.5 — Edge Functions don't yet expose a public gRPC listener. OTLP/HTTP covers 90% of OTel SDKs.

### F. Alerts / webhooks / rules

Detail: `docs/roadmap/06-otel-alerts-live-multimodal.md` §B. Closes SOTA gap #6.

**Migration `027_alerts_webhooks.sql` adds:** `alert_rules`, `webhook_endpoints`, `alert_events` (queue), `alert_subscriptions`, `webhook_dead_letters`. **Recommends pg_cron + plpgsql** for evaluation (not a synchronous trigger, not an Edge Function cron). Worker is a Supabase Edge Function `alert-dispatcher` triggered by pg_cron every 30s. HMAC-SHA256 signed webhooks with exponential-backoff retry (30s, 60s, 2m, 4m, 8m, 16m → dead-letter).

**v1 integrations:** generic HMAC webhook + Slack (Block Kit). PagerDuty v1.5.

### G. Real-time live tail

Detail: `docs/roadmap/06-otel-alerts-live-multimodal.md` §C. Closes SOTA gap #7.

**Supabase Realtime** (Postgres CDC) is the recommended transport — already wired in `real-time-indicator.tsx:10-20` for healthcheck; just switch the channel. **Cannot** subscribe directly to `private.spans` (RLS revoked from `anon`/`authenticated` per `migrations/006_ingest_rpc.sql:227-231`). Solution: a `public.spans_live` projection view populated by an `AFTER INSERT` trigger on `private.spans`, pruned to 200 rows per project by a pg_cron job. Realtime subscription uses `filter: project_id=eq.<id>`.

### H. Multi-modal session replay (attachments)

Detail: `docs/roadmap/06-otel-alerts-live-multimodal.md` §D. Closes SOTA gap #9.

**Migration `028_attachments.sql` adds:** `private.attachments` + storage RLS + daily quota table. New Supabase Storage bucket `trace-attachments` (50 MB per file, 1 GB per project per day). Two-call upload pattern: SDK gets a signed upload URL from `POST /functions/v1/attachments/sign`, PUTs the file directly to Supabase Storage, then `POST .../attachments/commit` writes the row. Renders inline in `trace-detail-timeline.tsx` (image / audio with waveform / PDF iframe / generic file).

---

## Cross-cutting notes

- **All migrations additive.** No `ALTER` on existing `private.sessions/runs/spans/events` in any of the workstreams. Existing data and the Python SDK stay intact.
- **Auth coupling.** Many workstreams (search/filter, scores, prompts, alerts) take `p_user_id` as a nullable argument today and backfill to FKs once users land. Don't block on auth — ship with the optional param.
- **Service-role blast radius.** Today every dashboard read uses `createAdminClient()` in `dashboard.ts:9` and bypasses RLS. Workstream A (auth) MUST flip the dashboard to user-scoped clients for read paths, or the entire RBAC migration is decorative.
- **Settings page cleanup.** Multiple workstreams touch `settings-page.tsx` (alerts, webhooks, team, billing, rules, provider keys). The `DisabledButton` component at `settings-page.tsx:694-700` becomes dead code and can be deleted in QW4.
- **Trace inspector rework.** SOTA §1 calls out 5 missing sections (Scores, Tags, Human review, error banner, replay). QW3 closes "error banner." Workstream C closes Scores + Comments. Search/tags workstream closes Tags. Replay wiring is best done after workstream A (org switcher in nav) to avoid rework.

---

## Recommended 8-week schedule

| Week | Focus | Outcome |
|---|---|---|
| 1 | QW1–QW7 (7 PRs), prepare `023_auth_rbac.sql` | 7 quick wins shipped; auth migration designed |
| 2 | Auth workstream steps 1–6 (ship the increment) | Signup/login live; teams can collaborate |
| 3 | Auth workstream steps 7–13 (team/billing/audit) | Production-ready multi-tenant |
| 4 | Search/filter Phase 1 + 2 + scores Phase 1 (MVP) | Find anything; manual scores in trace view |
| 5 | Search/filter Phase 3 (server FTS) + scores Phase 2 (eval unification) + Phase 3 (comments) | Full search; historical evals as scores |
| 6 | Prompts Phase 0 + 1 (registry + trace linking) | Prompts centralized + linked to traces |
| 7 | Prompts Phase 2 + 3 (playground + diff) + OTel ingest | Playground live; any framework can ingest |
| 8 | Alerts + live tail + attachments + scores Phase 4–5 (queues + auto-scorers) | SOTA parity on all of §1–§9 scorecards |

**Stretch (week 9+):** dataset versioning + A/B compare (SOTA §5 scorecard); PagerDuty integration; multi-modal playground; SSO/SCIM (SOTA §10.2); session-level text/status filter (SOTA §3 scorecard last 2 rows).

---

## What's not in this roadmap (yet)

These items in SOTA §3 and §5 scorecards need follow-up after Phase 2:
- **Session-level text/status/model filter** (SOTA §3 scorecard row 2). Easy add once search/tags land.
- **Multi-modal session replay** is in scope (workstream H). But **full-text search across multi-modal attachments** (OCR) is out — defer to a v1.5 with vector search.
- **Sampling (head + tail rules)** at ingest time (SOTA §1 scorecard row 5). Worth a workstream of its own after the ingest path stabilizes.
- **Diff two traces side-by-side** (SOTA §2 scorecard row 3) and **dataset A/B compare** (SOTA §5 row 5). UX work; spec in §5/§2 of SOTA.md; design TBD.
- **CSV/JSONL import wizard for datasets** (SOTA §5 row 4) — currently YAML editor only. Small UX work.
- **SSO/SCIM** (SOTA §10.2). Schema fields are in the auth migration; implementation deferred to v2.

---

## File index

- `SOTA.md` — the source gap analysis
- `docs/roadmap/01-quick-wins.md` — 7 quick wins, PR-by-PR plan with acceptance criteria
- `docs/roadmap/02-auth-rbac.md` — auth + multi-tenancy + RBAC design
- `docs/roadmap/03-search-tags.md` — search / filter / saved views / tags / bulk export
- `docs/roadmap/04-scores-feedback.md` — scores + annotation queues + human feedback
- `docs/roadmap/05-prompts.md` — prompt management
- `docs/roadmap/06-otel-alerts-live-multimodal.md` — OTel ingest, alerts/webhooks, real-time live tail, attachments

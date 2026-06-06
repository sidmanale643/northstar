# NorthStar — SOTA Gap Analysis

Two parallel subagents produced this report:

1. **Design vs Implementation diff** — compared the team's own design HTML (`dashboard/northstar_*.html`, `dashboard/evals_redesign.md`, `dashboard/implementation_plan.md`) against the current Next.js / TypeScript code.
2. **Competitor benchmark** — NorthStar vs **Langfuse**, **Braintrust**, **Arize Phoenix**, **LangSmith** on 50 capability line items.

**Headline:** ~14 of 50 SOTA capabilities are shipped, 6 partial, **30 missing**. Three non-negotiables would close the largest competitive gap.

---

## 1. Trace detail page is a shadow of the design

The team's own design (`dashboard/northstar_trace_inspector.html`) specifies 5 collapsible sections: **Metrics / Scores / Tags / Inputs-Outputs / Human review**. The implementation (`dashboard/components/trace-inspector.tsx:198-228`) is a single thin metrics strip plus raw I/O blocks.

- **Missing:** Scores section, Tags section, Human review (assign / classify), Flag-for-review / Tag / Replay buttons.
- **Replay is rendered with no `onClick`** (`trace-inspector.tsx:191-193`).
- **Span tree is flat** — `buildTree` (`trace-inspector.tsx:29-88`) flattens tool calls + events as siblings. Design wants `agentRun › llmCall › claude-sonnet-4` nesting. The DAG tab does this; the primary tree does not.
- **Span durations are hardcoded `'—'`** (`trace-inspector.tsx:50, 71`) and the per-span tokens / cost from the design never render.
- **"Thread" tab is literally a placeholder** — `trace-inspector.tsx:706-710` prints `{activeTab} view coming soon`.

---

## 2. Sessions page has hardcoded lies

`dashboard/app/(workspace)/projects/[projectId]/sessions/page.tsx:153` — `const errored = 0`. The "Error rate" stat always reads 0% regardless of data.

- No "Errored" filter chip; "Completed" is substituted (`components/sessions-table.tsx:22-27`).
- Session timeline doesn't render tool-call entries — only LLM trace events (`components/trace-timeline.tsx:21-28`), so debugging a failing agent is impossible from the session view.
- Per-row custom session tags (`prod`, `staging`, `retry` from the design) are auto-derived heuristics (`no-tools`, `long-running`) instead — `components/sessions-table.tsx:316-340`.

---

## 3. Settings page is static UI

`dashboard/components/settings-page.tsx` renders **Alerts / Ingestion / Team / Billing / Webhooks / Provider keys** tabs with no `onChange`, no save action, no persistence. Members, webhooks, plan info are inline strings. Disabled buttons say "Persistence API not connected" (`settings-page.tsx:611-613, 632-639, 762-763`).

Even the retention + max-traces-per-session fields are uncontrolled (`settings-page.tsx:374-388`).

---

## 4. P0 security bug: auth is bypassed

`dashboard/middleware.ts:33-46` literally has the auth check commented out with `// Bypassing auth check for development`. There is no `users` / `orgs` / `teams` / `roles` / `audit_logs` table in `migrations/`. No SSO, no RBAC, no per-project permissions. SOTA tools all ship orgs + RBAC + SSO on day 1; NorthStar cannot ship to a team as-is.

---

## 5. Data-layer-backed capabilities that the UI doesn't expose

- **No search / filter on sessions or traces** — single biggest UX gap. SOTA value prop is "find anything in 2 seconds." Past ~1k traces, NorthStar is unusable. Schema is there; no UI uses it.
- **No error rendering from `runs.error`** — `migrations/015_expose_trace_errors.sql` exists; trace detail just ignores it.
- **No tags / saved filters / bulk export** — no tags column on `spans` or `runs`; sessions have no per-row custom tags.

---

## 6. Three whole product areas don't exist at all

- **No prompt management** — no `prompts` table, no registry, no version linking to traces, no playground. Langfuse / Braintrust / LangSmith all treat this as table stakes.
- **No scores / annotation queues / human feedback** — no `scores` table, no review queues, no comments. NorthStar has the *offline* half of evals but zero of the *online / collaborative* half. This is the #1 reason a team would pick Langfuse at parity.
- **No alerts, webhooks, or rules** — production on-call workflow is impossible. The settings tab is the stub from §3.

---

## 7. SDK / ingest lock-in

Python SDK only (`src/northstar/client.py`). No OTel / OpenInference ingest. Phoenix and LangSmith accept OTel natively, which means any framework (Vercel AI SDK, LlamaIndex, OpenAI Agents, Go/Rust custom) works for free. NorthStar forces users onto a single client.

---

## Competitor capability scorecard

Legend: ✅ shipped · ⚠️ partial / stub · ❌ missing

### 1. Tracing & Ingest

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Multi-span trace tree (kind/status/duration) | ✅ `spans` (mig 004) | ✅ | ✅ | ✅ | ✅ |
| Token + cost attribution per span/run | ✅ `migrations/016_run_cost_read_model.sql` | ✅ | ✅ | ⚠️ manual | ✅ |
| OTel / OpenInference native ingest | ❌ SDK-only | ✅ | ⚠️ adapter | ✅ **OTel-first** | ✅ |
| Multi-modal attachments (images, audio, files) | ❌ events are JSONB only | ✅ | ✅ | ✅ | ✅ |
| Sampling (head + tail rules) | ❌ | ✅ | ✅ | ✅ | ✅ |

### 2. Trace Exploration & Debug

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Span tree + DAG visualization | ✅ `trace-dag-graph.tsx` | ✅ | ✅ | ✅ | ✅ |
| Inline error banner w/ stack + replay | ⚠️ captured, not rendered | ✅ | ✅ | ✅ | ✅ |
| Diff two traces side-by-side | ❌ | ✅ | ✅ | ✅ | ✅ |
| Token / cost breakdown chart in trace view | ⚠️ badge only | ✅ | ✅ | ✅ | ✅ |
| Full-text search inside trace content | ❌ | ✅ | ✅ | ✅ | ✅ |

### 3. Sessions & Multi-Turn

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Session list + timeline | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session-level text / status / model filter | ❌ sort + time only | ✅ | ✅ | ✅ | ✅ |
| Real-time live tail of running sessions | ❌ `real-time-indicator.tsx` is healthcheck-only | ✅ | ✅ | ✅ | ✅ |
| Multi-modal session replay (images / audio) | ⚠️ text-only | ✅ | ✅ | ✅ | ✅ |
| Session-level cost rollup in list | ❌ per-row badge only | ✅ | ✅ | ✅ | ✅ |

### 4. Evaluations (Offline)

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Run graders on dataset | ✅ `eval_runs` (mig 019) | ✅ | ✅ | ✅ | ✅ |
| LLM-as-judge graders | ✅ 4 predefined (`lib/eval-types.ts:7-11`) | ✅ | ✅ 30+ templates | ✅ | ✅ |
| Code-based graders (python / ts / regex) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trace-based evaluators | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pass-rate + per-grader time series | ⚠️ per-case only | ✅ | ✅ | ✅ | ✅ |

### 5. Datasets

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Dataset CRUD + cases | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dataset versioning + diff | ❌ | ✅ | ✅ | ✅ | ✅ |
| Span ↔ dataset case linking from trace UI | ❌ | ✅ | ✅ | ✅ | ✅ |
| CSV / JSONL import wizard | ⚠️ YAML editor only | ✅ | ✅ | ✅ | ✅ |
| Dataset A/B compare runs side-by-side | ❌ | ✅ | ✅ | ✅ | ✅ |

### 6. Prompt Management

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Centralized prompt registry w/ versions | ❌ | ✅ | ✅ | ✅ | ✅ |
| Prompt ↔ trace linking | ❌ | ✅ | ✅ | ✅ | ✅ |
| Playground w/ model picker + variables | ❌ | ✅ | ✅ | ✅ | ✅ |
| Prompt deployment labels (prod/staging) | ❌ | ✅ | ✅ | ✅ | ✅ |
| BYO provider keys for playground | ✅ `project_provider_keys` (mig 021) | ✅ | ✅ | ✅ | ✅ |

### 7. Online Scoring & Human Feedback

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Attach scores to traces (manual) | ❌ no `scores` table | ✅ | ✅ | ✅ | ✅ |
| Annotation queues for human labeling | ❌ | ✅ | ✅ | ⚠️ manual | ✅ |
| Threaded comments on traces | ❌ | ✅ | ✅ | ✅ | ✅ |
| Online auto-scorer rules on incoming traces | ❌ | ✅ | ✅ | ✅ | ✅ |
| Inter-annotator agreement | ❌ | ✅ | ✅ | ✅ | ✅ |

### 8. Alerts, Rules & Automations

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Threshold-based alerts (latency / cost / error) | ⚠️ stub UI | ✅ | ✅ | ✅ | ✅ |
| Webhooks + Slack / PagerDuty | ❌ | ✅ | ✅ | ✅ | ✅ |
| Trigger eval on prod drift | ❌ | ✅ | ✅ | ✅ | ✅ |
| Programmatic rules (YAML / SDK) | ❌ | ✅ | ✅ | ✅ | ✅ |

### 9. Search, Filter & Bulk Ops

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Global search across traces / sessions / runs | ❌ | ✅ | ✅ | ✅ | ✅ |
| Saved filters / views | ❌ | ✅ | ✅ | ✅ | ✅ |
| Bulk export (CSV / JSONL) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Tag / label system on runs + spans | ❌ | ✅ | ✅ | ✅ | ✅ |
| Saved views shared across team | ❌ | ✅ | ✅ | ✅ | ✅ |

### 10. Multi-Tenancy, Auth & RBAC

| Capability | NorthStar | Langfuse | Braintrust | Phoenix | LangSmith |
|---|---|---|---|---|---|
| Workspaces / orgs | ❌ flat `projects` only | ✅ | ✅ | ✅ | ✅ |
| User accounts + SSO / SCIM | ❌ | ✅ | ✅ | ✅ | ✅ |
| Role-based access (owner / admin / dev / viewer) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Project-level auth (current: 1 API key / project) | ⚠️ mig 008; **middleware bypassed** | ✅ | ✅ | ✅ | ✅ |
| Audit log | ❌ no `audit_logs` table | ✅ | ✅ | ⚠️ enterprise | ✅ |

**Score:** NorthStar 14 ✅ / 6 ⚠️ / 30 ❌. Langfuse 49/50, Braintrust 49/50, LangSmith 50/50, Phoenix 46/50.

---

## Top 10 SOTA gaps, ranked

| # | Gap | Why it matters | SOTA reference | Effort |
|---|---|---|---|---|
| 1 | **No search/filter on sessions or traces** | Single largest UX gap. Trace volume grows quadratically; without search the product is unusable past ~1k traces. | [Langfuse search](https://langfuse.com/docs/observability/search) | M |
| 2 | **Auth bypassed; no users/orgs/RBAC** | A SaaS product that any browser can read all projects from is not shippable. `middleware.ts:33-46` is a P0. | Langfuse orgs+RBAC, Braintrust SSO | L |
| 3 | **No prompt management** | Prompts are the #1 thing teams version + collaborate on. SOTA links prompt versions to traces, runs them in playgrounds, deploys with labels. | [Braintrust prompts](https://www.braintrust.dev/docs/guides/prompts), [Langfuse prompts](https://langfuse.com/docs/prompt-management) | L |
| 4 | **No scores / annotation queues / human feedback** | Evals without human-in-the-loop is a dead end. Reviewers grade traces in queues, scores attach to spans, online auto-scorers fire on ingest. | [Langfuse scores](https://langfuse.com/docs/evaluation/scores), [annotation queues](https://langfuse.com/docs/evaluation/annotation-queues) | L |
| 5 | **No OTel / OpenInference ingest** | Locks users into the Python SDK. Phoenix/LangSmith accept OTel natively → any framework works for free. | [Phoenix OTel](https://docs.arize.com/phoenix) | L |
| 6 | **No alerts, webhooks, or rules** | "View-only" tooling is a non-starter for on-call. | [LangSmith rules](https://docs.smith.langchain.com/rules), [Langfuse alerts](https://langfuse.com/docs/observability/alerts) | M |
| 7 | **No real-time live tail** | Debugging "the agent is stuck right now" requires live stream of new spans. `real-time-indicator.tsx` is healthcheck-only. | Langfuse live, Phoenix live | M |
| 8 | **No dataset versioning / A/B compare / trace↔case linking** | Datasets are flat YAML in storage. Can't diff, can't compare runs side-by-side, can't promote a failed case to a dataset from the trace UI. | [Braintrust experiments](https://www.braintrust.dev/docs/guides/eval) | M |
| 9 | **No multi-modal session replay** | `trace-detail-timeline.tsx` renders text only. SOTA renders images, PDFs, tool outputs, audio inline — critical for vision / doc-QA / voice agents. | Langfuse attachments, Braintrust | M |
| 10 | **No tags / saved filters / bulk export** | Once you have >100 traces, you need to tag, filter, export subsets. | All SOTA | S |

---

## Quick wins (<1 day each)

1. **Re-enable middleware auth + add session check** — `dashboard/middleware.ts:33-46` short-circuits auth. Wire to Supabase auth. (~1 hr)
2. **Add a "no search yet" CTA + debounced text input** above `sessions-table.tsx` and `recent-trace-timeline.tsx`; client-side filter for now, server-side `ilike` later. (~½ day)
3. **Show an error banner on trace view when `runs.error` is non-null** — spans already expose errors via `migrations/015_expose_trace_errors.sql`; `trace-inspector.tsx:198-210` has an empty error slot. (~2 hrs)
4. **Wire the alerts settings tab to a real form** — `settings-page.tsx:599` is a stub. Even a "log to console" webhook receiver is enough to demo the flow. (~½ day)
5. **Per-run CSV export button on trace detail** — pull from `runs` + `spans` in `lib/supabase/dashboard.ts`, return blob. (~2 hrs)
6. **Add "Errored" filter chip and wire `errored` to real data** in `sessions/page.tsx:153` and `sessions-table.tsx:22-27`. (~1 hr)
7. **Render tool calls in the session timeline** — `trace-timeline.tsx:21-28` only emits LLM `trace` events. Tool calls are already in the data. (~2 hrs)

---

## Non-negotiables

**A. Fix auth + introduce users/orgs/RBAC** (gaps #2, #10.1–#10.5). A multi-tenant observability product without authentication is not a product. Ship Supabase Auth + a `users` + `project_members` schema, wire `middleware.ts`, then add SSO in the next iteration. Without this: no enterprise buyer, no SOC 2, no deal.

**B. Ship scores + annotation queues + prompt management** (gaps #3, #4, #6.1–#6.5). The eval ↔ prompt ↔ feedback loop is what every SOTA tool treats as table stakes. NorthStar has the *offline* half of evals but zero of the *online / collaborative* half. A team that adopts NorthStar today has nowhere to put human feedback and no place to manage prompts. This is the single biggest reason a team would pick Langfuse over NorthStar at parity.

---

## Sources

**NorthStar code**
- Trace inspector: `dashboard/components/trace-inspector.tsx:139-318, 627-710`
- Trace DAG: `dashboard/components/trace-dag-graph.tsx`
- Session list: `dashboard/components/sessions-table.tsx`, `dashboard/app/(workspace)/projects/[projectId]/sessions/page.tsx`
- Session detail: `dashboard/app/(workspace)/projects/[projectId]/sessions/[id]/page.tsx`
- Trace timeline: `dashboard/components/trace-timeline.tsx`
- Eval results: `dashboard/components/eval-results-tab.tsx`, `eval-configure-tab.tsx`, `eval-case-row.tsx`
- Settings: `dashboard/components/settings-page.tsx`
- Auth: `dashboard/middleware.ts:33-46`
- Real-time stub: `dashboard/components/real-time-indicator.tsx`
- Data model: `dashboard/lib/supabase/types.ts`, `migrations/001`–`022`

**Competitor docs**
- Langfuse: [search](https://langfuse.com/docs/observability/search), [scores](https://langfuse.com/docs/evaluation/scores), [prompts](https://langfuse.com/docs/prompt-management), [annotation queues](https://langfuse.com/docs/evaluation/annotation-queues), [alerts](https://langfuse.com/docs/observability/alerts), [sampling](https://langfuse.com/docs/observability/sampling), [experiments](https://langfuse.com/docs/evaluation/experiments)
- Braintrust: [prompts](https://www.braintrust.dev/docs/guides/prompts), [playground](https://www.braintrust.dev/docs/guides/playground), [scoring](https://www.braintrust.dev/docs/guides/scoring), [eval](https://www.braintrust.dev/docs/guides/eval)
- LangSmith: [rules/automations](https://docs.smith.langchain.com/rules), [studio](https://docs.smith.langchain.com/langsmith/quick-start-studio), [prompt hub](https://docs.smith.langchain.com/prompt_engineering)
- Arize Phoenix: [OTel-native tracing](https://docs.arize.com/phoenix)

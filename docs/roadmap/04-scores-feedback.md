# NorthStar — Online Scores, Annotation Queues & Human Feedback Design

**Workstream:** Close SOTA gap #4 — NorthStar's online / collaborative scoring half.

---

## 0. Why this matters

`SOTA.md:184` ranks online scoring & human feedback as the **#4** competitive gap. The team's own `dashboard/northstar_trace_inspector.html` design specifies five collapsible sections in the trace inspector — **Metrics / Scores / Tags / Inputs-Outputs / Human review** — and `dashboard/components/trace-inspector.tsx:198-228` ships only the metrics strip plus raw I/O. `SOTA.md:59` calls this out directly: "NorthStar has the *offline* half of evals but zero of the *online / collaborative* half."

Concretely, this workstream:
1. Adds the **Scores** section in the trace inspector that the design already wants.
2. Closes six of the eight `§7` row in the scorecard (`SOTA.md:134-142`).
3. Unifies the offline/online halves by promoting `eval_runs.result` grades into a shared `scores` table.

---

## 1. Schema — `migrations/024_scores_feedback.sql`

All tables live in `private` and follow the same RLS posture as `migrations/017_eval_datasets.sql:26-33` and `migrations/019_eval_runs.sql:27-33` (RLS on, `service_role` only, `anon`/`authenticated` revoked). All dashboard read paths go through `public.dashboard_*` SQL functions following the pattern in `migrations/019_eval_runs.sql:133-175`.

### 1.1 `private.scores`

```sql
CREATE TYPE private.score_data_type AS ENUM ('numeric', 'categorical', 'boolean');
CREATE TYPE private.score_source     AS ENUM ('human', 'api', 'auto');

CREATE TABLE private.scores (
    id           UUID PRIMARY KEY,
    project_id   UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    trace_id     UUID NOT NULL REFERENCES private.runs(id)     ON DELETE CASCADE,
    span_id      UUID          REFERENCES private.spans(id)     ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (btrim(name) <> ''),
    value        DOUBLE PRECISION NOT NULL,
    data_type    private.score_data_type NOT NULL DEFAULT 'numeric',
    string_value TEXT,
    source       private.score_source NOT NULL,
    scorer_id    UUID          REFERENCES private.scorers(id) ON DELETE SET NULL,
    comment      TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (data_type <> 'categorical' AND string_value IS NULL)
        OR (data_type  = 'categorical' AND string_value IS NOT NULL)
    ),
    CHECK (source <> 'auto' OR scorer_id IS NOT NULL)
);

CREATE INDEX idx_scores_trace_created
    ON private.scores (project_id, trace_id, created_at DESC);
CREATE INDEX idx_scores_name_value
    ON private.scores (project_id, name, created_at DESC)
    INCLUDE (value, data_type);
CREATE INDEX idx_scores_span
    ON private.scores (span_id) WHERE span_id IS NOT NULL;

ALTER TABLE private.scores ENABLE ROW LEVEL SECURITY;
```

Notes:
- `trace_id REFERENCES private.runs(id)` (not `sessions`) — a score is always a per-trace judgment in this design.
- `span_id NULLABLE` so a score can attach to a whole trace or a specific span.
- `value DOUBLE PRECISION NOT NULL` plus a discriminator (`data_type`) mirrors Langfuse's pattern.
- `created_by TEXT` because there's no `users` table yet (gap #2).

### 1.2 `private.scorers`

```sql
CREATE TYPE private.scorer_kind AS ENUM ('llm_judge', 'code', 'pii', 'regex');

CREATE TABLE private.scorers (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (btrim(name) <> ''),
    kind        private.scorer_kind NOT NULL,
    config      JSONB NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name, version)
);

CREATE INDEX idx_scorers_project ON private.scorers (project_id, name);
ALTER TABLE private.scorers ENABLE ROW LEVEL SECURITY;
```

**Why a `kind` enum narrower than `eval-types.ts`:** the `EvalGraderKind` union has five members, but two pairs collapse for online scoring:
- `rubric` and `llm_judge` are the same thing; the `predefinedLlmGraders` array in `dashboard/lib/eval-types.ts:187-256` is already a `kind: 'rubric'`. We use `llm_judge` as the public-facing name and `config.predefined_id` carries the Langfuse-style enum (`correctness | faithfulness | helpfulness | safety_refusal_quality` from `eval-types.ts:7-11`).
- `python` and `typescript` code graders don't fit the "online score" mental model (running a 5-second Python sandbox in a hot ingest path is operationally expensive). We surface them as `code` in the online context but keep the language in `config.language`.
- `pii` is its own kind because it has a distinct UX.
- `regex` is the generic catch-all for keyword/pattern scorers.
- `trace` graders in `eval-types.ts:90-107` are offline-only and **do not** become an online scorer kind.

**`config` shape by `kind`:**

| `kind` | `config` shape |
|---|---|
| `llm_judge` | `{ model, rubric, scoring: { mode: 'binary' \| 'numeric', min, max, passing_score }, predefined_id?, temperature }` — mirrors `RubricJudgeRunConfig` at `eval-types.ts:59-66` |
| `code`     | `{ language: 'python' \| 'typescript', source, timeout_ms }` |
| `pii`      | `{ entities: ('email' \| 'phone' \| 'ssn' \| 'credit_card' \| 'ip')[], action: 'flag' \| 'redact' }` |
| `regex`    | `{ pattern, target: 'input' \| 'output' \| 'final_response', flags, mode: 'present' \| 'absent' \| 'count' }` |

### 1.3 `private.annotation_queues`

```sql
CREATE TABLE private.annotation_queues (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (btrim(name) <> ''),
    description TEXT,
    filter      JSONB NOT NULL DEFAULT '{}'::jsonb,
    sla_hours   INTEGER CHECK (sla_hours IS NULL OR sla_hours > 0),
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

ALTER TABLE private.annotation_queues ENABLE ROW LEVEL SECURITY;
```

**`filter` shape:** a JSON object that the rule engine (§2) already understands, so a queue and an auto-scorer rule can share the same filter language. v1 supports a flat conjunction list:

```json
{
  "all": [
    { "field": "trace.status", "op": "eq", "value": "error" },
    { "field": "trace.metadata.environment", "op": "eq", "value": "prod" },
    { "field": "trace.cost_usd", "op": "gt", "value": 0.05 },
    { "field": "trace.has_tool", "op": "eq", "value": true }
  ]
}
```

Operators: `eq | neq | gt | gte | lt | lte | in | contains | exists`.

### 1.4 `private.annotation_queue_items`

```sql
CREATE TYPE private.annotation_item_status AS ENUM ('pending', 'in_progress', 'done', 'skipped');

CREATE TABLE private.annotation_queue_items (
    queue_id     UUID NOT NULL REFERENCES private.annotation_queues(id) ON DELETE CASCADE,
    trace_id     UUID NOT NULL REFERENCES private.runs(id) ON DELETE CASCADE,
    assigned_to  TEXT,
    status       private.annotation_item_status NOT NULL DEFAULT 'pending',
    priority     SMALLINT NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
    due_at       TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    completed_by TEXT,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (queue_id, trace_id)
);

CREATE INDEX idx_queue_items_status
    ON private.annotation_queue_items (queue_id, status, priority DESC, created_at);
CREATE INDEX idx_queue_items_assignee
    ON private.annotation_queue_items (assigned_to, status)
    WHERE assigned_to IS NOT NULL;

ALTER TABLE private.annotation_queue_items ENABLE ROW LEVEL SECURITY;
```

### 1.5 `private.comments`

```sql
CREATE TABLE private.comments (
    id                  UUID PRIMARY KEY,
    project_id          UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    trace_id            UUID NOT NULL REFERENCES private.runs(id)  ON DELETE CASCADE,
    span_id             UUID          REFERENCES private.spans(id)  ON DELETE CASCADE,
    parent_comment_id   UUID          REFERENCES private.comments(id) ON DELETE CASCADE,
    body                TEXT NOT NULL CHECK (btrim(body) <> ''),
    author_id           TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_comments_trace
    ON private.comments (project_id, trace_id, created_at)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_parent
    ON private.comments (parent_comment_id)
    WHERE parent_comment_id IS NOT NULL;

ALTER TABLE private.comments ENABLE ROW LEVEL SECURITY;
```

Self-referential `parent_comment_id` for one-level threading. `deleted_at` preserves the thread skeleton.

### 1.6 `private.score_aggregations` (materialized view)

```sql
CREATE MATERIALIZED VIEW private.score_aggregations AS
SELECT
    project_id,
    trace_id,
    name,
    COUNT(*)                                       AS score_count,
    AVG(value)                                     AS avg_value,
    MIN(value)                                     AS min_value,
    MAX(value)                                     AS max_value,
    COUNT(*) FILTER (WHERE data_type = 'boolean' AND value = 1)::FLOAT
        / NULLIF(COUNT(*) FILTER (WHERE data_type = 'boolean'), 0) AS pass_rate,
    MAX(created_at)                                AS last_scored_at
FROM private.scores
GROUP BY project_id, trace_id, name;

CREATE UNIQUE INDEX idx_score_agg_pk
    ON private.score_aggregations (project_id, trace_id, name);
```

`pass_rate` is defined over `data_type = 'boolean'`. Refresh is handled by:
1. The `dashboard_create_score` / `dashboard_bulk_create_scores` RPCs (synchronous, after insert, debounced 5s per project).
2. A nightly cron: `pg_cron.schedule('refresh_score_agg', '0 * * * *', $$ REFRESH MATERIALIZED VIEW CONCURRENTLY private.score_aggregations $$)`.

### 1.7 RLS policy block

```sql
ALTER TABLE private.scorers                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.annotation_queues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.annotation_queue_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.comments                ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    private.scores,
    private.scorers,
    private.annotation_queues,
    private.annotation_queue_items,
    private.comments
TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM authenticated;
```

### 1.8 Dashboard read functions

```sql
public.dashboard_list_scores(p_project_id UUID, p_trace_id UUID)
public.dashboard_create_score(...)
public.dashboard_bulk_create_scores(p_project_id UUID, p_scores JSONB)
public.dashboard_list_comments(...)
public.dashboard_create_comment(...)
public.dashboard_list_queues(...)
public.dashboard_get_queue(...)
public.dashboard_list_queue_items(...)
public.dashboard_claim_queue_item(...)
public.dashboard_complete_queue_item(...)
```

---

## 2. Auto-scorer rules engine (SOTA §7.4)

### 2.1 `private.scorer_rules`

```sql
CREATE TABLE private.scorer_rules (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    scorer_id   UUID NOT NULL REFERENCES private.scorers(id)  ON DELETE CASCADE,
    name        TEXT NOT NULL,
    filter      JSONB NOT NULL DEFAULT '{}'::jsonb,
    sample_rate REAL  NOT NULL DEFAULT 1.0
                CHECK (sample_rate > 0 AND sample_rate <= 1),
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scorer_rules_project_enabled
    ON private.scorer_rules (project_id) WHERE enabled;

ALTER TABLE private.scorer_rules ENABLE ROW LEVEL SECURITY;
```

### 2.2 Trigger strategy: **NOT a Postgres trigger on `spans` insert. Use a queue worker.**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `AFTER INSERT ON spans` trigger synchronously invoking the scorer | Zero infra; transactional | Blocks ingest on LLM latency; no retry; can't backfill | **Reject** |
| Postgres `LISTEN/NOTIFY` + Edge Function worker | Decoupled; retryable; observable | New infra surface | **Accept for v1** |
| Queue-worker on a managed queue | Same as above, marginally lower latency | Custom infra | Defer to 025+ |

**Recommendation: `LISTEN/NOTIFY` + Supabase Edge Function worker.** Concretely:

```sql
CREATE FUNCTION private.notify_scorer_rules_on_span()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify(
        'northstar_scorer_rules',
        json_build_object(
            'project_id', NEW.project_id,
            'run_id',     NEW.run_id,
            'span_id',    NEW.id,
            'kind',       NEW.kind
        )::text
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_scorer_rules
AFTER INSERT ON private.spans
FOR EACH ROW
EXECUTE FUNCTION private.notify_scorer_rules_on_span();
```

A new Supabase Edge Function `supabase/functions/run-scorer-rules/index.ts` holds a long-lived `pg` connection listening on the channel, dispatches each payload to a `private.run_scorer_rule(rule_id, span_id)` SQL function, and inserts into `private.scores` with `source = 'auto'`.

**Why not all-in-SQL:** `llm_judge` and `code` scorers need network and sandboxing, neither of which Postgres does well.

### 2.3 Settings → Rules tab

Append a new tab to the `tabs` array in `dashboard/components/settings-page.tsx:53-61`:

```
{ id: 'rules', label: 'Auto-scorer rules', icon: Sparkles }
```

---

## 3. API surface

### 3.1 REST (for SDK ingest + external integrations)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/projects/[projectId]/scores` | Attach a score to a trace or span |
| `POST` | `/api/projects/[projectId]/scores/bulk` | Batch insert. Cap: 500 per call |
| `GET`  | `/api/projects/[projectId]/traces/[traceId]/scores` | Read all scores for a trace |
| `GET`  | `/api/projects/[projectId]/traces/[traceId]/comments` | Read comment thread |
| `POST` | `/api/projects/[projectId]/traces/[traceId]/comments` | Post a comment |
| `GET`  | `/api/projects/[projectId]/queues` | List queues |
| `GET`  | `/api/projects/[projectId]/queues/[queueId]/items` | List items (paginated) |

Edge function additions:
- None for the MVP score ingest path. `functions/v1/ingest-traces` accepts `scores` in schema version `2` and writes traces plus scores in one transaction.

### 3.2 Server actions (dashboard-only)

| Action | File | Signature |
|---|---|---|
| `saveScorer` | `dashboard/app/(workspace)/projects/[projectId]/settings/_actions.ts` | `(projectId, scorer) => Promise<Scorer>` |
| `deleteScorer` | same | `(projectId, scorerId) => Promise<void>` |
| `saveScorerRule` | same | `(projectId, rule) => Promise<ScorerRule>` |
| `deleteScorerRule` | same | `(projectId, ruleId) => Promise<void>` |
| `createAnnotationQueue` | `dashboard/app/(workspace)/projects/[projectId]/queues/_actions.ts` | `(projectId, input) => Promise<Queue>` |
| `assignQueueItem` | same | `(projectId, queueId, traceId, assignee) => Promise<QueueItem>` |
| `completeQueueItem` | same | `(projectId, queueId, traceId, notes?) => Promise<QueueItem>` |

`assignQueueItem` is `FOR UPDATE`-locked in the SQL function to prevent two labelers claiming the same trace.

### 3.3 SDK ingest path: `client.score(...)`

In `src/northstar/client.py`, add a score buffer alongside `_pending_sessions / _pending_runs / _pending_spans / _pending_events`:

```python
def score(
    self,
    trace_id: str | UUID,
    name: str,
    value: float | bool | str,
    *,
    span_id: str | UUID | None = None,
    data_type: Literal["numeric", "categorical", "boolean"] | None = None,
    comment: str | None = None,
) -> None
```

Behavior:
- Coerce `value`: `bool` → `data_type='boolean'` with `value = 1.0 | 0.0`; `str` → `data_type='categorical'`; `int | float` → `data_type='numeric'`.
- Append to `self._pending_scores: list[Score]`.
- `flush()` adds a `scores: [...]` key to the ingest payload.
- Schema version on the wire bumped to `2`: `ingest-traces` accepts both `spans` and `scores` in one payload and persists them together.

A `models.py` companion type is also added (`Score` pydantic model) following the same `extra="forbid"` pattern.

---

## 4. UI components

All paths under `dashboard/components/scores/`. New directory. Reuses existing `cn` util, Lucide icons, and the `EvalGraderRunConfig` types.

### 4.1 `dashboard/components/scores/score-panel.tsx`
Renders the **Scores** section missing from `dashboard/components/trace-inspector.tsx:198-228`. Slot into `DetailPanel` as a fourth IOBlock-style section.

Renders:
- A summary chip row: per-score `name`, `value`, colored dot for `source` (gray=api, violet=auto, green=human), relative-time stamp.
- A "Pass rate" chip for any score named in the project's `private.scorer_rules`.
- An "+ Add score" button that opens `ScoreForm`.

### 4.2 `dashboard/components/scores/score-form.tsx`
Manual scoring input. Fields: `name` (autocomplete), `value` (input whose control switches on `data_type`), `comment` (textarea, optional).

### 4.3 `dashboard/components/scores/annotation-queue-list.tsx`
Project-level view. New route: `dashboard/app/(workspace)/projects/[projectId]/queues/page.tsx`.

### 4.4 `dashboard/components/scores/annotation-queue-page.tsx`
The labeler cockpit. New route: `dashboard/app/(workspace)/projects/[projectId]/queues/[queueId]/page.tsx`. Auto-claims the next pending item on mount; uses optimistic UI.

Keyboard: `J` next, `K` skip, `1-5` apply numeric score, `P` pass, `F` fail.

### 4.5 `dashboard/components/scores/comments-thread.tsx`
Renders in `DetailPanel` next to `ScorePanel`.

### 4.6 `dashboard/components/scores/scorer-rule-editor.tsx`
Settings tab editor per §2.3. Filter editor is a structured key/value list (not free-form JSON).

### 4.7 `dashboard/components/scores/inter-annotator-agreement.tsx`
Cohen's κ view. Computed in a new RPC:

```sql
public.dashboard_inter_annotator_agreement(
  p_project_id UUID, p_trace_id UUID, p_name TEXT
) -> (author_a TEXT, author_b TEXT, n_both_rated BIGINT, agreement DOUBLE PRECISION, kappa DOUBLE PRECISION)
```

---

## 5. Migration of existing offline evals

`migrations/019_eval_runs.sql:3-22` stores `result JSONB` containing `caseResults[].grades[]` of shape `GradePayload` from `dashboard/lib/eval-types.ts:13-24`.

**Recommendation: YES — promote each `(eval_run, case, grade)` tuple into `private.scores` with `source = 'auto'`, `data_type` derived from the grader config.** Concrete plan:

1. **Backfill migration** in `024_scores_feedback.sql`:
   ```sql
   INSERT INTO private.scores (
       id, project_id, trace_id, name, value, data_type,
       string_value, source, scorer_id, comment, created_at
   )
   SELECT
       gen_random_uuid(),
       r.project_id,
       r.id,
       grade->>'name',
       COALESCE((grade->>'score')::double precision, 0),
       CASE
           WHEN grade->>'label' IS NOT NULL THEN 'categorical'::private.score_data_type
           WHEN (grade->>'score')::double precision IN (0, 1) THEN 'boolean'::private.score_data_type
           ELSE 'numeric'::private.score_data_type
       END,
       grade->>'label',
       'auto'::private.score_source,
       NULL,
       grade->>'reason',
       r.created_at
   FROM private.eval_runs r
   CROSS JOIN LATERAL jsonb_array_elements(
       jsonb_path_query_array(r.result, '$.caseResults[*].grades[*]')
   ) AS grade
   WHERE r.result IS NOT NULL
     AND NOT EXISTS (
         SELECT 1 FROM private.scores s
         WHERE s.project_id = r.project_id
           AND s.trace_id = r.id
           AND s.name = grade->>'name'
     );
   ```

2. **`scorer_id` backfill**: for each grade, look up a `private.scorers` row whose `config @> '{"predefined_id": "<name>"}'` and `kind = 'llm_judge'`, inserting one synthetic scorer per `(project_id, name)` if none exists.

3. **Going forward**, the eval runner writes to both tables in the same RPC — modify `dashboard_create_eval_run` in `migrations/019_eval_runs.sql:35-131` to also insert into `private.scores` after the eval run row.

4. **Do NOT drop `eval_runs.result`**. The structured per-case detail is still needed by `dashboard/components/eval-results-tab.tsx:50-67`.

---

## 6. Sequencing — smallest shippable increments

| Phase | Days | Shipped | Unblocks |
|---|---|---|---|
| **0 — Schema (024)** | 1 | All tables, RPCs, RLS, types regenerated | Everything below |
| **1 — MVP** | 2 | `ScorePanel` in `DetailPanel`. `ScoreForm` posting to `/api/projects/[projectId]/scores`. `client.score(...)`. `ingest-traces` schema v2 score ingest. SDK can attach scores to traces from Python | User can demo "human review a trace, leave a score, see it in the UI" |
| **2 — Eval unification** | 1 | Backfill from `eval_runs.result`. Eval runner writes to both tables going forward | Closes the offline/online gap |
| **3 — Comments** | 1 | `CommentsThread` in `DetailPanel`. SDK stub | Closes SOTA.md:140 "Threaded comments" |
| **4 — Annotation queues** | 3 | `annotation-queue-list.tsx`, `annotation-queue-page.tsx`, server actions, labeler keyboard shortcuts, Cohen's κ view | Closes SOTA.md:139 and SOTA.md:142 |
| **5 — Auto-scorer rules** | 3 | `scorers` CRUD UI, `scorer-rule-editor.tsx` in settings, `LISTEN/NOTIFY` migration, `supabase/functions/run-scorer-rules/index.ts` worker, the four built-in scorers | Closes SOTA.md:141 |
| **6 — Aggregations + perf** | 1 | `pg_cron` for refresh, scoring rollup chips in session list, index review | Closes SOTA.md:112 extension |

**MVP demo script (after phase 1):** user installs SDK, calls `client.score(trace_id, "correctness", 0.8, comment="looks fine")`, opens the trace in the dashboard, sees the score chip, clicks it, sees the comment.

---

## 7. Risks & open questions

1. **Auth-shaped holes.** `scores.created_by`, `comments.author_id`, `annotation_queue_items.assigned_to` are `TEXT` because there's no `users` table. Add a follow-up `025_users_and_auth.sql` that backfills.
2. **Filter language scope.** The §1.3.b filter subset is intentionally flat. v2 can add OR clauses.
3. **Worker reliability.** `LISTEN/NOTIFY`-driven scorer worker has at-least-once semantics. For `pii` and `regex` (cheap, idempotent) this is fine; for `llm_judge` we need idempotency keys. Add a `private.score_jobs` table (out of scope for 024) tracking `(span_id, scorer_id) → status`.
4. **Postgres trigger overhead.** The `AFTER INSERT ON spans` trigger is a hot path. ~10-30 µs per notify. Drop the trigger if `enabled` rules count is zero for the project.
5. **`materialized view` refresh latency.** Synchronous refresh inside `dashboard_bulk_create_scores` is fine at low write rate; under heavy load the refresh will dominate. Mitigate with debounced refreshes per project.
6. **Cohen's κ with N>2 labelers per item.** Pairwise only in v1. Fleiss' κ requires all labelers to have rated the same items.
7. **Privacy of `pii` scorer output.** Storing "this trace contains an email" as a `score` with `comment` reveals a PII finding. Consider `auto_redact` action.
8. **Phase 5 scope explosion.** Consider splitting: 5a ships `pii` and `regex` rules only (no LLM); 5b adds `llm_judge`.
9. **Cross-migration ordering.** `024` is purely additive; can ship behind any in-flight work.
10. **`score_aggregations` materialized vs regular view.** §1.6 picks materialized; revisit if eventual consistency becomes a complaint.

---

## 8. Acceptance criteria

When this workstream lands, the `§7 Online Scoring & Human Feedback` row of `SOTA.md:134-142` should read:

| Capability | Status |
|---|---|
| Attach scores to traces (manual) | ✅ via `ScorePanel` + `client.score(...)` |
| Annotation queues for human labeling | ✅ via `AnnotationQueuePage` |
| Threaded comments on traces | ✅ via `CommentsThread` |
| Online auto-scorer rules on incoming traces | ✅ via `scorer_rules` + `run-scorer-rules` worker |
| Inter-annotator agreement | ✅ via `dashboard_inter_annotator_agreement` + Cohen's κ |

i.e. the entire `§7` block goes from 0/5 ✅ to 5/5 ✅.

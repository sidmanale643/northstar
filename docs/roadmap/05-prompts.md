# NorthStar — Prompt Management Design Doc

**Workstream:** Close SOTA gap #3 — Centralized Prompt Registry, Versioning, Playground, Deployment Labels.

---

## 0. Goals & non-goals

**Goals**
1. Single source of truth for prompts per project. Teams can register, version, label, and roll back without redeploying code.
2. SDK can fetch a compiled prompt by name + label, locally, with offline-friendly caching.
3. Every LLM span can be linked to a specific `prompt_version_id` deterministically (no fuzzy matching required).
4. Playground that re-uses the existing `project_provider_keys` BYO-key plumbing.
5. One-click save of playground outputs back into `eval_datasets`.

**Non-goals (this workstream)**
- Multi-modal (image / audio / PDF) prompt content. Out — see §8.
- Prompt A/B routing in production (e.g. shadow traffic). Out.
- Cross-project prompt sharing / a public prompt library. Out.
- OTel-native prompt context propagation. Out — tracked under SOTA gap #5.
- SSO / RBAC for prompt editing. Out — gated on SOTA gap #2.

---

## 1. Schema — `migrations/025_prompts.sql`

### 1.1 Recommendation: labels as JSONB **plus** an audit table

**Decision:** fold `prompt_deployments` into a `labels JSONB` column on `prompts`, **and** keep a write-only `prompt_label_history` table for audit + time-travel. Rationale:

- **Hot path is single-row read.** `client.pull_prompt(name="summarizer", label="prod")` is one indexed `SELECT` against `prompts`, then one `JSONB` lookup. A separate `prompt_deployments` table would force a join on every SDK call (every LLM call in production) — this is the Braintrust failure mode that makes their SDK slow on cold paths.
- **Labels are tightly scoped to a prompt.** They have no independent identity outside `(prompt_id, label_name)`.
- **Audit + deployment metadata are different concerns.** Who deployed what when is a write-heavy, read-rare workload; it deserves its own table indexed by `(prompt_id, deployed_at DESC)`.
- **JSONB gives atomic "swap prod from v3 → v7"** in one UPDATE statement.

Net: `prompts.labels` is the **read** model; `prompt_label_history` is the **event log**.

### 1.2 Tables

```sql
-- prompts: the logical "prompt" (e.g. "summarizer", "router-system-prompt")
CREATE TABLE private.prompts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    slug                 TEXT NOT NULL,
    description          TEXT,
    current_version_id   UUID,
    labels               JSONB NOT NULL DEFAULT '{}'::jsonb
                         -- shape: {"prod": "<version_uuid>", "staging": "<version_uuid>",
                         --         "experiment-2025-06": "<version_uuid>"}
    created_by           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT prompts_slug_per_project UNIQUE (project_id, slug),
    CONSTRAINT prompts_labels_is_object CHECK (jsonb_typeof(labels) = 'object')
);

CREATE INDEX idx_prompts_project_name
    ON private.prompts (project_id, lower(name));

-- prompt_versions: immutable content + config snapshots
CREATE TABLE private.prompt_versions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id           UUID NOT NULL REFERENCES private.prompts(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    version_number      INTEGER NOT NULL,
    content             TEXT NOT NULL,
    model               TEXT,
    temperature         NUMERIC(4,3),
    max_tokens          INTEGER,
    variables           JSONB NOT NULL DEFAULT '[]'::jsonb,
    parent_version_id   UUID REFERENCES private.prompt_versions(id) ON DELETE SET NULL,
    change_note         TEXT,
    content_hash        TEXT NOT NULL,
    created_by          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT prompt_versions_unique_number UNIQUE (prompt_id, version_number),
    CONSTRAINT prompt_versions_temperature_range CHECK (
        temperature IS NULL OR (temperature >= 0 AND temperature <= 2)
    ),
    CONSTRAINT prompt_versions_max_tokens_positive CHECK (
        max_tokens IS NULL OR max_tokens > 0
    ),
    CONSTRAINT prompt_versions_variables_is_array CHECK (jsonb_typeof(variables) = 'array')
);

CREATE INDEX idx_prompt_versions_prompt_created
    ON private.prompt_versions (prompt_id, created_at DESC);

ALTER TABLE private.prompts
    ADD CONSTRAINT prompts_current_version_fk
    FOREIGN KEY (current_version_id)
    REFERENCES private.prompt_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_prompts_current_version
    ON private.prompts (current_version_id)
    WHERE current_version_id IS NOT NULL;

-- prompt_label_history: append-only audit of label promotions
CREATE TABLE private.prompt_label_history (
    id              BIGSERIAL PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    prompt_id       UUID NOT NULL REFERENCES private.prompts(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    version_id      UUID NOT NULL REFERENCES private.prompt_versions(id) ON DELETE RESTRICT,
    deployed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deployed_by     TEXT,
    change_note     TEXT,
    CONSTRAINT prompt_label_history_label_nonempty CHECK (length(label) > 0)
);

CREATE INDEX idx_prompt_label_history_prompt_time
    ON private.prompt_label_history (prompt_id, deployed_at DESC);

-- prompt_trace_links: span ↔ prompt_version association
CREATE TABLE private.prompt_trace_links (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    trace_id            UUID NOT NULL,
    span_id             UUID NOT NULL,
    prompt_version_id   UUID NOT NULL REFERENCES private.prompt_versions(id) ON DELETE CASCADE,
    variable_values     JSONB NOT NULL DEFAULT '{}'::jsonb,
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT prompt_trace_links_unique UNIQUE (span_id, prompt_version_id)
);

CREATE INDEX idx_prompt_trace_links_trace
    ON private.prompt_trace_links (trace_id);

CREATE INDEX idx_prompt_trace_links_version
    ON private.prompt_trace_links (prompt_version_id);

-- Grants + RLS
ALTER TABLE private.prompts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.prompt_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.prompt_label_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.prompt_trace_links     ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON private.prompts,
       private.prompt_versions,
       private.prompt_label_history,
       private.prompt_trace_links
    TO service_role;

REVOKE ALL ON private.prompts                FROM anon, authenticated;
REVOKE ALL ON private.prompt_versions        FROM anon, authenticated;
REVOKE ALL ON private.prompt_label_history   FROM anon, authenticated;
REVOKE ALL ON private.prompt_trace_links     FROM anon, authenticated;
```

### 1.3 RPC surface (read model)

```sql
public.dashboard_list_prompts(p_project_id UUID) RETURNS TABLE (...)
public.dashboard_get_prompt(p_project_id UUID, p_prompt_id UUID) RETURNS TABLE (...)
public.dashboard_resolve_prompt_label(
    p_project_id UUID, p_slug TEXT, p_label TEXT
) RETURNS TABLE (
    prompt_id, prompt_version_id, version_number, content, model, temperature,
    max_tokens, variables, content_hash
);
public.dashboard_list_trace_prompt_links(p_project_id UUID, p_trace_id UUID) RETURNS TABLE (...)
```

### 1.4 Write RPCs

```sql
public.dashboard_create_prompt(p_project_id, p_name, p_slug, p_description, p_created_by) RETURNS private.prompts;
public.dashboard_create_prompt_version(p_project_id, p_prompt_id, p_content, p_model, p_temperature, p_max_tokens, p_variables, p_parent_version_id, p_change_note, p_created_by) RETURNS private.prompt_versions;
public.dashboard_set_prompt_label(p_project_id, p_prompt_id, p_label, p_version_id, p_change_note, p_deployed_by) RETURNS private.prompts;
public.dashboard_link_span_to_prompt(p_project_id, p_trace_id, p_span_id, p_prompt_version_id, p_variable_values) RETURNS VOID;
```

### 1.5 RLS note

All four tables live in `private.*` and follow the existing pattern in `migrations/021_project_provider_keys.sql:28-34`: enable RLS, grant to `service_role`, revoke from `anon`/`authenticated`.

---

## 2. SDK — Python

### 2.1 Module layout

```
src/northstar/
├── client.py            # extend with: pull_prompt, compile, prompt context manager
├── prompts.py           # NEW: Prompt, CompiledPrompt, PromptRegistry
└── _prompt_template.py  # NEW: variable extraction
```

### 2.2 Public surface

```python
class Prompt(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    slug: str
    current_version_id: UUID | None
    labels: dict[str, UUID]
    description: str | None


class PromptVersion(BaseModel):
    id: UUID
    prompt_id: UUID
    version_number: int
    content: str
    model: str | None
    temperature: float | None
    max_tokens: int | None
    variables: list[dict[str, Any]]
    parent_version_id: UUID | None
    change_note: str | None
    content_hash: str


class CompiledPrompt(BaseModel):
    prompt_id: UUID
    prompt_version_id: UUID
    content: str
    raw_content: str
    variables: dict[str, Any]
    model: str | None
    temperature: float | None
    max_tokens: int | None
    content_hash: str


class Northstar:
    def pull_prompt(
        self,
        name: str,
        *,
        label: str = "prod",
        version: int | None = None,
        use_cache: bool = True,
    ) -> CompiledPrompt: ...


def compile(
    prompt_version: PromptVersion,
    variables: Mapping[str, Any],
) -> CompiledPrompt: ...


class PromptRegistry(Protocol):
    def resolve(self, slug: str, label: str) -> PromptVersion: ...
    def put(self, version: PromptVersion) -> None: ...
```

### 2.3 `client.pull_prompt` behavior

- `name` matched against `slug` (preferred) or `name` (fallback) within the caller's project.
- `version=` short-circuits the label lookup and returns that exact `version_number`.
- Pulls the resolved `PromptVersion` via `POST /api/prompts/resolve` (uses the same auth header as the ingest endpoint).
- Caches `(slug, label) -> PromptVersion` in-process for the lifetime of the client (LRU, 256 entries) keyed by `content_hash`.
- Network errors fall back to the last cached copy and emit a `warnings.warn` — never raise on transient fetch failure in production.

### 2.4 `client.compile` — also a context manager

```python
with client.pull_prompt("summarizer").bind(
    variables={"doc": doc, "max_words": 200},
) as compiled:
    response = openai.chat.completions.create(
        model=compiled.model,
        messages=[{"role": "user", "content": compiled.content}],
        temperature=compiled.temperature,
        max_tokens=compiled.max_tokens,
    )
# On exit: enqueue a prompt_trace_link row keyed by the active span id
```

`bind()` is a sync/async context manager. On `__enter__` it stores the compiled prompt on the active span's `_pending_prompt_link` private attribute; on `__exit__` it appends a `(prompt_version_id, variable_values)` pair to `client._pending_prompt_links`.

### 2.5 Variable extraction heuristic (template → variables schema)

Implemented in `src/northstar/_prompt_template.py`:

1. Try Jinja-style: `{{ var_name }}` and `{% if ... %}` (lightweight parse).
2. Fall back to Python f-string: `{var_name}` (regex `\{([a-zA-Z_][a-zA-Z0-9_]*)\}`).
3. Fall back to Mustache: `{{var_name}}` already covered by (1).
4. Auto-populate `variables` field on a new version with `[{name, type: "string", required: true, default: null}]`.

This is the same heuristic Langfuse uses.

### 2.6 Ingest payload extension

Extend the `payload` dict in `client.py:97-106` with a new key:

```python
"prompt_links": [
    {
        "span_id": str(span_id),
        "prompt_version_id": str(pvid),
        "variable_values": {...},
    }
    for link in self._pending_prompt_links
]
```

---

## 3. Playground UI

### 3.1 Route

`dashboard/app/(workspace)/projects/[projectId]/playground/page.tsx`

### 3.2 Components (new, under `dashboard/components/playground/`)

| File | Responsibility |
|---|---|
| `playground-page.tsx` | Page shell, two-column layout |
| `prompt-picker.tsx` | Sidebar list of prompts in project, version + label selector |
| `model-picker.tsx` | Model dropdown. Reuses `requiredProviderForModel` from `provider-key-config.ts:55-72` |
| `variable-form.tsx` | Auto-generated input form from `prompt_version.variables` |
| `run-button.tsx` | Streams response from server-side proxy via SSE |
| `diff-pane.tsx` | Side-by-side text + JSON diff between two selected versions |
| `save-to-dataset-button.tsx` | One-click save to `eval_datasets` |
| `version-history-drawer.tsx` | Right-side drawer showing all versions |

### 3.3 Layout

```
+---------------------------------------------------------------+
|  [Prompt picker]   [v3 ▼]  [prod ▼]      [Compare with: v1 ▼] |
+-------------------+----------------------+--------------------+
|                   |                      |                    |
|  Variables        |  Run (left pane)     |  Diff (right pane) |
|  - doc [____]     |  ┌────────────────┐  |  + Added: "max_…"  |
|  - max_words [200]|  │ streaming...   │  |  ~ Changed: model  |
|                   |  └────────────────┘  |                    |
|  Model: claude…   |  Tokens: 142         |                    |
|  Temp:    0.3     |  Cost:  $0.0021      |                    |
|  Max:    1024     |  Latency: 1.4s       |                    |
|                   |                      |                    |
|  [Save to dataset]|                      |                    |
+-------------------+----------------------+--------------------+
```

### 3.4 Backend proxy

`dashboard/app/api/projects/[projectId]/playground/route.ts` — server route that:
1. Receives `{prompt_version_id, variables, model, temperature, max_tokens}`.
2. Resolves the project's API key for the chosen model via `dashboard_get_provider_key` (mig 021, `:113-125`).
3. Calls the upstream provider SDK server-side (OpenAI / Anthropic SDK), streaming chunks back over SSE.
4. On stream complete, logs a synthetic run to `private.runs` + `private.spans` with `kind='model'` and a `prompt_trace_link` row.

### 3.5 Provider-key integration

The `model-picker.tsx` calls `GET /api/projects/[projectId]/provider-keys` (already exists). If no key is configured, the Run button is disabled with a tooltip "Add your {provider} API key in Settings → Provider keys".

---

## 4. Versioning UX

### 4.1 Versions list (prompt detail page)

`dashboard/app/(workspace)/projects/[projectId]/prompts/[promptId]/page.tsx`

### 4.2 Diff view

`dashboard/components/playground/diff-pane.tsx` is the canonical diff component, reused here. Two sub-views:
- **Content diff:** `diff` (Myers) over `prompt_version.content`.
- **Config diff:** `jsondiffpatch` over the union of `{model, temperature, max_tokens, variables}`.

### 4.3 Promote-to-label flow

`dashboard/components/prompts/promote-label-dialog.tsx`

States:
1. User clicks "Promote to prod" button.
2. Dialog shows: target label, current version at that label, the new version, a `change_note` textarea.
3. **`change_note` is required when `label='prod'`** — enforced client-side (disable submit) **and** server-side in the RPC.
4. On submit, the RPC does (in one transaction):
   - `UPDATE private.prompts SET labels = jsonb_set(labels, ARRAY[label], to_jsonb(version_id)), updated_at=now() WHERE id=prompt_id`
   - `INSERT INTO private.prompt_label_history (...)`
5. Optimistic UI: labels pill updates immediately, snackbar with "Undeployed in 5s" undo.

### 4.4 Change notes

- Free-text, no markdown for MVP.
- Required server-side for `prod` only.

---

## 5. Trace linking

### 5.1 Capture path (SDK-driven, deterministic)

The SDK is the source of truth. Inside `client.compile(...)` / `pull_prompt().bind(...)`:

1. On `__enter__` the active span gets `attributes["prompt.compile.requested"] = {prompt_version_id, content_hash}`.
2. On `__exit__` the SDK enqueues a `prompt_link` row.
3. At `flush()` time the ingest payload carries these links in the new `prompt_links` array. The Edge Function calls `dashboard_link_span_to_prompt` for each.

**Why not post-process / fuzzy match on the dashboard side?** It's O(spans × prompt_versions) and the false-positive rate is non-trivial. Langfuse solves this by having the SDK stamp the trace server-side. We're doing the equivalent in `client.py`.

### 5.2 Ingest post-processing (read model)

`dashboard.ts` gains two new exported functions:

```ts
export async function linkSpanToPrompt(input: {
  projectId, traceId, spanId, promptVersionId, variableValues
}): Promise<void>

export async function listTracePromptLinks(input: {
  projectId, traceId
}): Promise<DashboardTracePromptLink[]>
```

`DashboardTracePromptLink` joins `prompt_versions` + `prompts`.

### 5.3 Trace inspector badge

Extend `dashboard/components/trace-inspector.tsx:198-228`:

- After the existing `Cost` / `Tokens` / `Duration` badges, render one `<PromptVersionBadge>` per distinct `prompt_version_id` linked to spans in the trace.
- The badge shows: prompt name + "v{n}" + a small label-pill if any label points at this version.
- Click → opens a side panel with: content (read-only), config, variable values used in this trace, "Open in Playground", "Diff with prod".

---

## 6. API surface

### 6.1 REST routes (Next.js, under `dashboard/app/api/projects/[projectId]/`)

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/prompts` | List prompts |
| `POST`   | `/prompts` | Create prompt |
| `GET`    | `/prompts/[id]` | Get prompt + versions + label history |
| `PATCH`  | `/prompts/[id]` | Rename / update description |
| `DELETE` | `/prompts/[id]` | Soft delete |
| `GET`    | `/prompts/[id]/versions` | List versions |
| `POST`   | `/prompts/[id]/versions` | Create a new version |
| `GET`    | `/prompts/[id]/versions/[versionId]` | Get one version |
| `GET`    | `/prompts/[id]/versions/diff?left=&right=` | Returns `{content_diff, config_diff}` |
| `PUT`    | `/prompts/[id]/labels/[label]` | Set label (400 if `label='prod'` and no `change_note`) |
| `DELETE` | `/prompts/[id]/labels/[label]` | Unset a label |
| `POST`   | `/prompts/resolve` | Body `{slug, label}` → version content+config (SDK's `pull_prompt` hot path) |
| `POST`   | `/playground` | SSE stream |
| `GET`    | `/traces/[traceId]/prompt-links` | Calls `dashboard_list_trace_prompt_links` |

### 6.2 SDK surface (recap)

- `client.pull_prompt(name, label="prod", version=None)` → `CompiledPrompt`
- `compiled.compile(variables={...})` → `CompiledPrompt`
- `compiled.bind(variables={...})` → context manager, auto-links on `__exit__`
- `compile(version, variables)` → module-level helper

---

## 7. Sequencing — smallest shippable increments

### Phase 0 — Registry + version CRUD + SDK pull (~5–7 days)
- Migration `025_prompts.sql` (this doc §1).
- RPCs: `dashboard_list_prompts`, `dashboard_get_prompt`, `dashboard_create_prompt`, `dashboard_create_prompt_version`, `dashboard_set_prompt_label`, `dashboard_resolve_prompt_label`.
- REST: `GET/POST /prompts`, `GET/POST /prompts/[id]/versions`, `PUT /prompts/[id]/labels/[label]`, `POST /prompts/resolve`.
- Dashboard: list page (`/prompts`), detail page (`/prompts/[id]`), version list + change_note input.
- SDK: `pull_prompt`, `compile`, in-memory LRU cache.
- **Demo:** user can create a prompt in the dashboard, add v1, label it `prod`, pull it from Python, render it.

### Phase 1 — Trace linking (~2–3 days)
- SDK: `compiled.bind(...)` context manager; ingest payload gains `prompt_links[]`; Edge Function calls link RPC.
- Dashboard: `PromptVersionBadge` in `trace-inspector.tsx:198-228`; trace → prompt version click-through.

### Phase 2 — Playground + save-to-dataset (~4–5 days)
- Route `/playground`.
- `model-picker.tsx`, `variable-form.tsx`, `run-button.tsx`, `save-to-dataset-button.tsx`.
- Backend SSE proxy at `/api/projects/[projectId]/playground`.

### Phase 3 — Diff view + A/B compare (~2–3 days)
- `diff-pane.tsx` with text + config diff.
- Promote-to-label dialog with required change_note for `prod`.
- "Diff with prod" button on the trace-inspector badge.

**Critical-path dependency:** Phase 0 is blocked on SOTA gap #2 (auth bypass) only for multi-tenant deployments. For a single-project dev demo, Phase 0 ships without it.

---

## 8. Risks & open questions

| # | Risk / question | Mitigation |
|---|---|---|
| 1 | **Variable extraction heuristic is fragile.** Templates with literal `{` / `}` cause false positives | Prefer Jinja `{{ }}` syntax in docs. On version creation, the dashboard UI shows an auto-detected variables list and lets users edit it before save. |
| 2 | **Prompt content size limits.** Long system prompts (50KB+) blow up the dashboard | Cap `content TEXT` at 64KB; reject larger with a 400. |
| 3 | **Multi-modal prompts.** Image / audio / PDF inputs | Out of scope. The schema allows `content TEXT` only. For MVP, the user pastes a URL reference into the content. |
| 4 | **Cache staleness in SDK.** A user promotes v3 → prod while v3 is cached | Cache key includes `content_hash`; on `cache miss` (404 or different hash), re-fetch. Manual `client.invalidate_prompt_cache(slug)`. |
| 5 | **Concurrent label updates.** Two operators both click "Promote v3 → prod" at the same time | The `dashboard_set_prompt_label` RPC is wrapped in a single `UPDATE` + `INSERT` statement — Postgres serializes the row update on `prompts.id`. |
| 6 | **Soft vs hard delete.** GDPR + "I changed my mind" cases | MVP: hard delete via `ON DELETE CASCADE`. Spans pointing at deleted versions are orphaned in `prompt_trace_links`. |
| 7 | **Who can edit prompts?** | No RBAC until SOTA gap #2 ships. Anyone with the project API key can write. |
| 8 | **Template rendering on the server.** SDK does it client-side, dashboard playground does it server-side. Will they diverge? | Yes, this is a real risk. Mitigation: both use the same `variables` JSON schema and a tiny shared syntax. |
| 9 | **Versioning of model+config vs content.** If only `temperature` changes, do we create v(n+1) or in-place edit v(n)? | New version, always. |
| 10 | **"What was prod yesterday?"** Answering this requires reading `prompt_label_history` joined with the time range. | The `idx_prompt_label_history_prompt_time` index handles this. We expose a `GET /prompts/[id]/labels/[label]/history?at=...` for time-travel queries. |

---

## 9. Out of scope (explicitly)

- OTel/OpenInference prompt context propagation (SOTA gap #5).
- Prompt A/B routing in production (labels are static, not weighted).
- Cross-project prompt sharing / marketplace.
- Prompt cost forecasting (compare cost of v3 vs v5 over a dataset).
- Auto-suggested prompt improvements (LLM-rewriter).
- Audit log beyond `prompt_label_history` (full audit log ships with SOTA gap #2's `audit_logs` table).

---

## 10. File index (new + modified, design only)

**New migrations**
- `migrations/025_prompts.sql`

**New Python SDK**
- `src/northstar/prompts.py`
- `src/northstar/_prompt_template.py`
- `tests/test_prompts.py`

**SDK modifications**
- `src/northstar/client.py:26-179` — add `pull_prompt`, `compile`, `_pending_prompt_links` buffer, extend `_build_payload` (`:97-106`)

**New dashboard routes**
- `dashboard/app/(workspace)/projects/[projectId]/prompts/page.tsx`
- `dashboard/app/(workspace)/projects/[projectId]/prompts/[promptId]/page.tsx`
- `dashboard/app/(workspace)/projects/[projectId]/playground/page.tsx`
- `dashboard/app/api/projects/[projectId]/prompts/route.ts`
- `dashboard/app/api/projects/[projectId]/prompts/[id]/route.ts`
- `dashboard/app/api/projects/[projectId]/prompts/[id]/versions/route.ts`
- `dashboard/app/api/projects/[projectId]/prompts/[id]/labels/[label]/route.ts`
- `dashboard/app/api/projects/[projectId]/prompts/resolve/route.ts`
- `dashboard/app/api/projects/[projectId]/playground/route.ts`
- `dashboard/app/api/projects/[projectId]/traces/[traceId]/prompt-links/route.ts`

**New dashboard components**
- `dashboard/components/playground/*.tsx` (8 files, see §3.2)
- `dashboard/components/prompts/prompt-list-table.tsx`
- `dashboard/components/prompts/version-row.tsx`
- `dashboard/components/prompts/promote-label-dialog.tsx`
- `dashboard/components/prompts/prompt-version-badge.tsx` (also used in trace-inspector)

**Dashboard modifications**
- `dashboard/components/trace-inspector.tsx:198-228` — add `PromptVersionBadge` to the metrics strip
- `dashboard/lib/supabase/dashboard.ts:1-29`
- `dashboard/lib/supabase/types.ts:224-388`
- `dashboard/components/eval-configure-tab.tsx`
- `dashboard/components/global-shell.tsx`

**Ingest**
- `supabase/functions/ingest-traces/index.ts` — accept new `prompt_links[]` array in payload, call `dashboard_link_span_to_prompt` for each

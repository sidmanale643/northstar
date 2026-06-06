# NorthStar — Search / Filter / Saved Views / Tags / Bulk Export Design

Closes SOTA gaps **#1 (search/filter is the single largest UX gap)** and **#10 (no tags / saved filters / bulk export)** described in `SOTA.md:177-190`. Targets the "find anything in 2 seconds" bar that `SOTA.md:50` calls the SOTA value prop.

---

## 0. Calibration: what the current code actually looks like

Three facts that constrain the design and override two assumptions in the brief:

1. **`runs` has no `input` / `output` columns.** `migrations/003_runs.sql:3-13` shows `runs(id, session_id, project_id, name, started_at, ended_at, status, error, metadata)`. The actual prompt / completion / tool args / tool result text lives in `private.events.content` (`migrations/005_events.sql:3-16`) keyed by `event.type ∈ {user_input, system_message, assistant_message, reasoning, tool_arguments, tool_result, final_response, custom}`. Full-text search **must target `private.events.content` plus `private.spans.attributes` and `private.spans.name`**, not `runs.input/output`.
2. **All dashboard reads go through `service_role` RPCs in `public`.** Tables live in `private` (`migrations/002`–`005`), and `dashboard.ts:101-183` calls `createAdminClient().rpc('dashboard_*')`. There is no client-direct table access. "RLS policies" therefore translates to: keep new tables in `private`, expose only via `SECURITY INVOKER` RPCs that take `p_project_id` and filter on it, `REVOKE` from `PUBLIC/anon/authenticated`, `GRANT EXECUTE` to `service_role`. Add a `p_user_id UUID` parameter now (unused until auth lands) so the RPC signature is stable when `dashboard/middleware.ts:33-46` is re-enabled.
3. **There is no pagination today.** `listDashboardSessions` (`dashboard/lib/supabase/dashboard.ts:101-108`) returns every session for the project in one shot; `SessionsTable` then filters client-side (`dashboard/components/sessions-table.tsx:60-74`). Beyond ~1k rows this is the actual reason the product becomes unusable, not just search absence. Cursor pagination is a hard requirement of this workstream, not optional.

The route convention in this codebase is **project-scoped**: `/api/projects/[projectId]/...` (`dashboard/app/api/projects/[projectId]/...`). The brief proposes `/api/search/traces?...`. We will keep the existing convention: `/api/projects/[projectId]/search/traces?...`.

---

## 1. Schema additions — `migrations/026_search_tags.sql`

All new tables live in `private`. No `RLS` on private tables (matches `migrations/002`–`005`); access mediated by RPCs in `public`.

### 1.1 Tags

```sql
CREATE TYPE private.tag_kind AS ENUM ('user', 'system');

CREATE TABLE private.tags (
    id           UUID PRIMARY KEY,
    project_id   UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    color        TEXT NOT NULL DEFAULT 'gray',  -- token, not hex
    kind         private.tag_kind NOT NULL DEFAULT 'user',
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tags_name_per_project_unique UNIQUE (project_id, name)
);

CREATE INDEX idx_tags_project_id ON private.tags(project_id);
CREATE INDEX idx_tags_name_trgm  ON private.tags USING gin (name gin_trgm_ops);
```

`kind = 'system'` is reserved for auto-derived tags (`errored`, `slow`, `no-tools`).

### 1.2 Junctions

```sql
CREATE TABLE private.run_tags (
    run_id     UUID NOT NULL REFERENCES private.runs(id) ON DELETE CASCADE,
    tag_id     UUID NOT NULL REFERENCES private.tags(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    applied_by UUID,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, tag_id)
);
CREATE INDEX idx_run_tags_tag_id     ON private.run_tags(tag_id);
CREATE INDEX idx_run_tags_project_id ON private.run_tags(project_id);

CREATE TABLE private.span_tags (
    span_id    UUID NOT NULL REFERENCES private.spans(id) ON DELETE CASCADE,
    tag_id     UUID NOT NULL REFERENCES private.tags(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    applied_by UUID,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (span_id, tag_id)
);
CREATE INDEX idx_span_tags_tag_id     ON private.span_tags(tag_id);
CREATE INDEX idx_span_tags_project_id ON private.span_tags(project_id);
```

**Session tags** are intentionally **not** a third junction. Sessions get tags transitively from their runs.

### 1.3 Saved filters / views

```sql
CREATE TYPE private.saved_filter_resource AS ENUM ('traces', 'sessions', 'runs', 'spans');

CREATE TABLE private.saved_filters (
    id                 UUID PRIMARY KEY,
    project_id         UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    resource           private.saved_filter_resource NOT NULL,
    filter             JSONB NOT NULL,
    query_text         TEXT,
    created_by         UUID,
    shared_with_team   BOOLEAN NOT NULL DEFAULT false,
    starred_by         UUID[] NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_filters_project_id        ON private.saved_filters(project_id);
CREATE INDEX idx_saved_filters_project_resource  ON private.saved_filters(project_id, resource);
CREATE INDEX idx_saved_filters_shared            ON private.saved_filters(project_id) WHERE shared_with_team;
```

### 1.4 Full-text + trigram indexes

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

**Strategy:** two index families per searchable column, picked by intent:

| Use case | Index | Lookup |
|---|---|---|
| Free-text inside trace I/O | `tsvector` GIN | `ts_query @@ ts_vector` |
| Substring / prefix on names, models, tool names | `pg_trgm` GIN | `ilike '%web%'` |
| Tag presence | btree | `tag_id =` + `EXISTS` |

Indexes:

```sql
-- 1) Trigram on short, structured strings
CREATE INDEX idx_runs_name_trgm     ON private.runs   USING gin (name gin_trgm_ops);
CREATE INDEX idx_spans_name_trgm    ON private.spans  USING gin (name gin_trgm_ops);
CREATE INDEX idx_spans_model_trgm   ON private.spans  USING gin ((attributes->>'model') gin_trgm_ops);

-- 2) tsvector on long-form content
ALTER TABLE private.events
    ADD COLUMN content_tsv tsvector
    GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(content::text, ''))
    ) STORED;
CREATE INDEX idx_events_content_tsv ON private.events USING gin (content_tsv);

-- 3) tsvector on span attributes
ALTER TABLE private.spans
    ADD COLUMN attributes_tsv tsvector
    GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(attributes::text, ''))
    ) STORED;
CREATE INDEX idx_spans_attributes_tsv ON private.spans USING gin (attributes_tsv);

-- 4) Composite covering indexes for the common "by project, recent" shape
CREATE INDEX idx_runs_project_started_desc
    ON private.runs (project_id, started_at DESC, id DESC);
CREATE INDEX idx_spans_project_started_desc
    ON private.spans (project_id, started_at DESC, id DESC);

-- 5) Errored-runs partial index
CREATE INDEX idx_runs_project_errored
    ON private.runs (project_id, started_at DESC)
    WHERE error IS NOT NULL;

-- 6) Slow-runs expression index
CREATE INDEX idx_runs_duration_ms
    ON private.runs (project_id, ((extract(epoch from (ended_at - started_at))*1000)::bigint))
    WHERE ended_at IS NOT NULL;
```

`simple` dictionary (not `english`) is intentional: prompts and tool outputs contain code, JSON keys, model names, UUIDs — stemming destroys recall.

### 1.5 Sessions read model fix

Extend `dashboard_list_sessions` to return `error_count BIGINT, tag_ids UUID[]`.

### 1.6 RPCs introduced by `026`

All `LANGUAGE sql/plpgsql STABLE SET search_path = ''`, REVOKE'd from PUBLIC/anon/authenticated, GRANTed to `service_role`:

- `public.dashboard_search_traces(p_project_id, p_q, p_filter JSONB, p_cursor JSONB, p_limit) → TABLE (..., rank REAL, total_count BIGINT)`
- `public.dashboard_search_sessions(...)`
- `public.dashboard_search_runs(...)`
- `public.dashboard_search_spans(...)`
- `public.dashboard_list_tags(p_project_id, p_q)`
- `public.dashboard_create_tag(...)`
- `public.dashboard_delete_tag(...)`
- `public.dashboard_apply_run_tags(...)` / `public.dashboard_remove_run_tags(...)`
- `public.dashboard_apply_span_tags(...)` / `public.dashboard_remove_span_tags(...)`
- `public.dashboard_list_saved_filters(...)`
- `public.dashboard_upsert_saved_filter(...)`
- `public.dashboard_delete_saved_filter(...)`
- `public.dashboard_star_saved_filter(...)`
- `public.dashboard_export_runs(...)`

---

## 2. Search API

### 2.1 Routes

All under `dashboard/app/api/projects/[projectId]/`:

| Verb | Path |
|---|---|
| GET | `/search/traces` |
| GET | `/search/sessions` |
| GET | `/search/runs` |
| GET | `/search/spans` |
| GET | `/tags` |
| POST | `/tags` |
| DELETE | `/tags/[tagId]` |
| POST | `/tags/apply` |
| POST | `/tags/remove` |
| GET | `/saved-filters?resource=traces` |
| POST | `/saved-filters` |
| PATCH | `/saved-filters/[id]` |
| DELETE | `/saved-filters/[id]` |
| POST | `/saved-filters/[id]/star` |
| GET | `/export/traces?ids=...&format=csv\|jsonl` |
| GET | `/export/runs?...` |
| GET | `/export/spans?...` |

### 2.2 Request shape (URLSearchParams)

```
GET /api/projects/<projectId>/search/traces
    ?q=refund+timeout
    &f=status:errored
    &f=model:gpt-4o
    &f=tag:prod
    &f=duration_gt:5000
    &f=created_after:2026-05-01T00:00:00Z
    &cursor=eyJ0Ijo...   (opaque base64-encoded {started_at,id})
    &limit=50
```

Multiple `f=` params, joined with **AND** by default.

### 2.3 Filter grammar (`f=` and `saved_filters.filter` shape)

```jsonc
{
  "op": "AND",
  "clauses": [
    { "key": "status",         "op": "eq",  "value": "errored" },
    { "key": "model",          "op": "eq",  "value": "gpt-4o" },
    { "key": "tag",            "op": "in",  "value": ["prod","retry"] },
    { "key": "duration_ms",    "op": "gt",  "value": 5000 },
    { "key": "created_at",     "op": "gte", "value": "2026-05-01T00:00:00Z" },
    { "key": "cost_usd",       "op": "lte", "value": 0.50 }
  ]
}
```

Supported keys per resource: status, model, tag, duration_ms, cost_usd, input_tokens, output_tokens, created_at, name, session_id. Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `exists`, `not_exists`.

Helpers (TS, no code — locations):
- `dashboard/lib/search/filter-grammar.ts`
- `dashboard/lib/search/cursor.ts`
- `dashboard/lib/search/url-state.ts`

### 2.4 Ranking

```sql
ORDER BY
    (ts_rank(events_tsv.content_tsv, plainto_tsquery('simple', p_q)) * 1.0
     + recency_boost(r.started_at)) DESC,
    r.started_at DESC,
    r.id DESC
```

`recency_boost(t) = exp(-extract(epoch from (now() - t)) / 86400.0 / 7.0)` — half-life ~5 days. Tunable via `SET northstar.recency_half_life_days = 7`.

When `p_q IS NULL`, skip the `ts_rank` term and order purely by `started_at DESC`.

### 2.5 Pagination

Cursor = `{started_at, id}` keyset, stable under inserts. **Never offset-based**.

When `p_q IS NOT NULL`, cursor includes the previous `rank` value too: `{rank, started_at, id}` with `WHERE (rank, started_at, id) < (cursor.rank, cursor.started_at, cursor.id)`.

### 2.6 Client switch-over rule

Existing `SessionsTable` does pure client-side filter. Keep it for projects with `sessions.length ≤ 500`. Above 500 OR a free-text query is present, swap to server-side.

---

## 3. UI components

All under `dashboard/components/search/`:

### 3.1 `search-bar.tsx`
- Debounced 150ms, `useDeferredValue` for the dropdown filter
- Dropdown sections: Recent (localStorage), Saved & starred, Suggestions
- ⌘K opens; ↑/↓ to navigate; ↵ to apply; ⎋ to dismiss
- Request cancellation: `AbortController` per keystroke

### 3.2 `filter-chips.tsx`
- Default palette (sessions): Errored, Active, Completed, Last 24h, Slow > 5s, Model =, Tag, Cost > $0.10
- Chips render as the existing pill style
- ⌫ on focused chip removes it; "+ Filter" trailing button opens the chip palette

### 3.3 `saved-filters-menu.tsx`
- Starred, then personal, then "Shared with team" group
- Each row: name + chip preview + star toggle + overflow menu
- Footer: "Save current view…"

### 3.4 `tag-picker.tsx`
- Multi-select combobox with create-on-the-fly
- Color picker: 6-token palette (gray/green/amber/red/blue/violet)

### 3.5 `tag-badges.tsx`
- Pure presentation, max 3 + "+N"
- Click to filter by that tag

### 3.6 `bulk-action-bar.tsx`
- Sticky bar at bottom-of-table when `selectedIds.length > 0`
- Actions: Tag…, Untag…, Export ▾ (CSV/JSONL), Delete
- "Export all matching (N rows)" surfaced when total > selected

### 3.7 `use-search.ts`
- Uses SWR or React Query (whichever is in `dashboard/package.json`)
- Key = `[projectId, resource, q, serializeFilter(filter)]`
- Cancellation via `AbortController` on key change

---

## 4. Wire-in plan

### 4.1 Fix the hardcoded errored=0
`dashboard/app/(workspace)/projects/[projectId]/sessions/page.tsx:153` — read from the new `error_count` column.

### 4.2 Add "Errored" filter chip + migrate FILTERS to DSL
`sessions-table.tsx:22-27` — extend FILTERS with `{ value: 'errored', label: 'Errored' }`.

### 4.3 Search bar above tables
- **Sessions:** replace the inline input at `sessions-table.tsx:110-119` with `<SearchBar>`.
- **Recent traces:** insert `<SearchBar resource="traces" ... />` above the SORT_OPTIONS row at `recent-trace-timeline.tsx:52-86`.

### 4.4 Tag column + bulk-action-bar
**Sessions table:**
- Replace `Tags` subcomponent at `sessions-table.tsx:316-340` with `<TagBadges>`.
- Add a leading checkbox column.
- Add per-row hover affordance: a tiny "+ tag" pill.
- Render `<BulkActionBar>` outside the table.

**Recent trace timeline:**
- Add a `tag_ids: string[]` field. Render `<TagBadges>` between the model chip and the cost badge.

### 4.5 Per-row tag affordance
"+ tag" pill on hover in the Tags cell. Clicking opens `<TagPicker>` as a popover.

### 4.6 URL state
`lib/search/url-state.ts` with `readSearchState(searchParams)` and `buildSearchHref`.

---

## 5. Bulk export (CSV / JSONL)

### 5.1 Streaming path

`GET /api/projects/[projectId]/export/<resource>?ids=<csv|all>&format=<csv|jsonl>&q=...&f=...`

Implementation: a Next.js Route Handler returning a `Response` whose body is a `ReadableStream`:
1. Validate `projectId`, validate `ids` if present (else replay the search using `q`/`f`)
2. Open a Supabase cursor via `createAdminClient().rpc('dashboard_export_runs', { p_project_id, p_run_ids })` — paginate cursors of 1,000
3. Transform to CSV (papaparse or hand-rolled) or JSONL
4. Response headers: `Content-Type`, `Content-Disposition: attachment;`, `Cache-Control: no-store`, `X-Total-Rows`

### 5.2 Export RPC

```sql
public.dashboard_export_runs(
    p_project_id UUID,
    p_run_ids    UUID[],
    p_filter     JSONB DEFAULT NULL,
    p_after      JSONB DEFAULT NULL,
    p_limit      INT   DEFAULT 1000
) RETURNS SETOF jsonb
```

### 5.3 UI flow
1. User selects rows in the table.
2. `BulkActionBar` "Export ▾" menu opens.
3. Pick CSV or JSONL.
4. Browser hits the endpoint; download begins as the first chunk arrives.

### 5.4 Single-trace shortcut
Per-row "Export" item in the row's overflow menu (`⋯`) — covers SOTA.md:200 quick-win #5.

---

## 6. Saved views (shared across team)

### 6.1 Visibility model
- `shared_with_team = false`: visible only to `created_by`.
- `shared_with_team = true`: visible to every member of the project. Today there is no `project_members` table. For v1, "shared" means "visible to anyone hitting this project's dashboard". When auth lands, `dashboard_list_saved_filters` gains a JOIN against `project_members`.

### 6.2 Starring
`saved_filters.starred_by UUID[]` — `dashboard_star_saved_filter` does atomic append/remove.

### 6.3 Sidebar shared-views panel
Adds a collapsible "Team views" group to `dashboard/components/app-shell.tsx`'s left nav. Out of scope for Phase 1; Phase 3.

---

## 7. Sequencing

### Phase 1 — "find the error in 30 seconds" (≤ 1 week)
- Migration `026_search_tags.sql` (tags, run_tags, span_tags, saved_filters table only, all indexes, sessions read-model patch, tag CRUD + apply/remove RPCs)
- API routes for tags
- `tag-picker.tsx`, `tag-badges.tsx`
- Wire `sessions-table.tsx`: add "Errored" chip; replace heuristic Tags with `<TagBadges>`; per-row "+ tag"
- Wire `sessions/page.tsx:153` to real `error_count`
- Debounced search input above `recent-trace-timeline.tsx` (client-side `ilike` for now)

### Phase 2 — "I can save my view and export it" (≤ 1 week)
- Saved-filters list/upsert/delete/star RPCs + handlers
- `saved-filters-menu.tsx`, `search-bar.tsx` (URL state, client-side apply)
- `filter-chips.tsx` — migrate sessions-table FILTERS
- `bulk-action-bar.tsx` + selection
- Export routes
- Per-row export in trace detail

### Phase 3 — "search the haystack" (≤ 2 weeks)
- `dashboard_search_*` RPCs
- `useSearch` hook
- Swap `SessionsTable` to server-mode beyond 500 rows
- Shared team views in `app-shell.tsx` sidebar
- ⌘K global palette (stretch)
- Backfill: nightly cron / one-shot SQL to convert old heuristics into system tag rows

---

## 8. Performance considerations

### 8.1 Index sizing
Estimated at 10M `events` rows:
- `idx_events_content_tsv` (GIN over tsvector): ~3-5 GB
- `idx_spans_attributes_tsv`: ~500 MB
- Trigram on `runs.name`, `spans.name`, `spans.model`: <500 MB combined
- Partial `idx_runs_project_errored`: tiny

### 8.2 Query patterns to verify with EXPLAIN
- Cursor walks: must use `idx_runs_project_started_desc` as index-only scan
- FTS with filter: BitmapAnd the GIN tsvector index with the status filter
- Errored chip: hits `idx_runs_project_errored` directly

### 8.3 Pagination
Cursor-based throughout. Confirmed **not currently used**. Add a "Load more" button (or `IntersectionObserver` infinite scroll) below the table. Show `total_count` in the "12 of 4,892 shown" label.

### 8.4 Client-side
- Debounce 150ms on text, 0ms on chip add/remove
- Request cancellation: `AbortController` reset on every key change
- Optimistic UI: tag apply/remove writes to the local cache, fires the mutation, rolls back on error
- Streaming downloads: never buffer >10k rows in memory

### 8.5 Telemetry
Every search RPC logs `(project_id, q_length, num_clauses, took_ms, total_count)` to a `private.search_queries` table.

---

## 9. Risks & open questions

1. **Auth is bypassed.** `shared_with_team` and per-user `starred_by` make limited sense without a `users` table. v1 ships with nullable UUIDs in every RPC; auth migration backfills FKs.
2. **`runs.metadata` vs first-class columns.** Add functional indexes for `cost_usd`, `total_input_tokens`, `total_output_tokens`.
3. **`tsvector` over `content::text` of a JSONB.** Loses key/value structure. v2 can decompose into per-event-type tsvectors with weights.
4. **No OR / grouping in the filter grammar.** Punt explicitly; saved views often span "errored OR slow".
5. **System tag backfill cost.** Re-tag every run as `errored` / `slow` / `no-tools` against 10M runs is a one-shot batch. Run during maintenance.
6. **Bulk export auth & abuse.** Log exports to `audit_logs`; rate-limit on `(project_id, user_id)` at 1 export every 30s, max 10/day.
7. **`pg_trgm` + `tsvector` together** can blow query planner. Verify with EXPLAIN.
8. **Cross-resource search.** v1 ships per-resource only; the ⌘K palette in Phase 3 is the natural home for federated search.
9. **Tag deletion cascade.** Store both `tag_id` and `tag_name` in `saved_filters.filter` JSONB.
10. **Sort stability under FTS.** When a row's tsvector changes, the cursor can skip / duplicate rows. Tolerable for human search UX; document.

---

## Appendix A — file map (new + touched)

**New:**
- `migrations/026_search_tags.sql`
- `dashboard/app/api/projects/[projectId]/search/{traces,sessions,runs,spans}/route.ts`
- `dashboard/app/api/projects/[projectId]/tags/route.ts` + `tags/[tagId]/route.ts` + `tags/{apply,remove}/route.ts`
- `dashboard/app/api/projects/[projectId]/saved-filters/route.ts` + `[id]/route.ts` + `[id]/star/route.ts`
- `dashboard/app/api/projects/[projectId]/export/{traces,sessions,runs}/route.ts`
- `dashboard/components/search/{search-bar,filter-chips,saved-filters-menu,tag-picker,tag-badges,bulk-action-bar}.tsx`
- `dashboard/lib/search/{filter-grammar,cursor,url-state,use-search}.ts`
- `dashboard/lib/export/csv.ts`
- `dashboard/lib/supabase/search.ts`

**Touched:**
- `dashboard/lib/supabase/types.ts`
- `dashboard/lib/supabase/dashboard.ts:101-108`
- `dashboard/app/(workspace)/projects/[projectId]/sessions/page.tsx:153`
- `dashboard/components/sessions-table.tsx:22-27, 60-74, 110-119, 316-340`
- `dashboard/components/recent-trace-timeline.tsx:52-86, 155-164`
- `dashboard/components/app-shell.tsx`

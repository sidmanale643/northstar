# Dashboard UI for Prompt Management — Plan

**Reference doc:** `docs/roadmap/05-prompts.md` (source of truth for surfaces, components, REST contract).
**Current state:** API contract is fully wired (`/api/projects/[id]/prompts/**`, `/traces/[id]/prompt-links`). RPCs, Supabase wrappers, and types are exported. No UI surface exists.

## Goals
1. Expose Phase 0 (registry CRUD + version + labels) so the SDK hot-path is exercisable from the dashboard.
2. Expose Phase 1 (trace → prompt badge + side panel) so users see deterministic linking in the trace view.
3. Expose Phase 2 (playground + save-to-dataset) so users can iterate without writing Python.
4. Expose Phase 3 (text/config diff + required change_note for prod promotions).

## Shared design (applies to all phases)
- All pages are `'use client'` components that hit the existing API routes via `fetch`, mirroring `dashboard/app/(workspace)/projects/[projectId]/datasets/page.tsx:43-77` (search/load pattern), the `eval-datasets/[id]/cases` POST pattern, and the `eval-configure-tab` UI conventions.
- Reuse existing design tokens (`ns-button`, `ns-input`, `ns-label`, lucide-react, `DashboardPrompt*` types from `dashboard/lib/supabase/types.ts:467-539`, `requireDashboardBackendProject` middleware pattern).
- Reuse `ActiveProjectBreadcrumb` for every new page.
- Add nav entry: `dashboard/components/app-shell.tsx:21-31` — insert `{ label: 'Prompts', href: projectHref(project.id, 'prompts'), icon: BookText }` and `{ label: 'Playground', href: projectHref(project.id, 'playground'), icon: FlaskConical }`. Extend `projectHref` section union + `projectSwitchHref` regex in `dashboard/lib/projects.ts:38-59`.
- New directory: `dashboard/components/prompts/` and `dashboard/components/playground/`.
- New workspace routes: `dashboard/app/(workspace)/projects/[projectId]/prompts/{page.tsx,[id]/page.tsx}` and `…/playground/page.tsx`.

---

## Phase 0 — Registry + version CRUD + label management

### Routes
- `dashboard/app/(workspace)/projects/[projectId]/prompts/page.tsx` — list.
- `dashboard/app/(workspace)/projects/[projectId]/prompts/[promptId]/page.tsx` — detail with versions + labels.

### Components
- `dashboard/components/prompts/prompt-list-table.tsx` — rows for `DashboardPrompt[]` (name, slug, current version pill, label pills derived from `prompt.labels` JSON, updated date, link to detail). Search by name/slug/description (mirror `datasets/page.tsx:79-87`).
- `dashboard/components/prompts/new-prompt-dialog.tsx` — Radix `Dialog` (Radix deps already in `package.json`) with name + slug (auto-derived from name) + description. Calls `POST /api/projects/[id]/prompts` (uses `route.ts:29-77`); on success `router.push` to the new detail page.
- `dashboard/components/prompts/prompt-version-form.tsx` — `content` textarea, `model`, `temperature`, `max_tokens`, `change_note` (required). Auto-extracts variables client-side (mirror `_prompt_template.py` heuristic — `{{ var }}` and `{var}` regex) and renders the inferred `variables` list editable before submit. Validates content size ≤ 64KB (matches `versions/route.ts:67-69`).
- `dashboard/components/prompts/version-row.tsx` — version card: v{n} badge, content preview (first 8 lines), model + temp + max_tokens chips, created_at, parent_version_id link, "Open in playground" link, "Promote to..." menu (hooked up in Phase 3).
- `dashboard/components/prompts/label-manager.tsx` — list current labels from `prompt.labels` (a `Record<label, versionId>`), each label shows which version it points to, with a "Remove label" button (`DELETE /api/projects/[id]/prompts/[promptId]/labels/[label]`). Below: a "Promote version to label" control (hooked up in Phase 3 dialog).
- `dashboard/components/prompts/label-history-table.tsx` — read-only table from `DashboardPromptDetail.label_history` (`types.ts:497-510`).

### Detail page wiring
- Server: `getDashboardPrompt(backendProjectId, promptId)` for the initial render (RSC + `'force-dynamic'`, mirroring `traces/[id]/page.tsx:8-23`).
- Client: `useEffect` to re-fetch on focus, and after create-version / set-label / delete actions for optimistic updates (call the GET API directly, no separate server refetch).
- States: loading, 404, 500 with the same red banner pattern as `datasets/page.tsx:255-262`.

### Empty/loading states
- Mirror the dataset empty state at `datasets/page.tsx:271-309` (centered icon + headline + CTA).

### Acceptance
- Create prompt → land on detail page → add v1 → see it in the list → promote v1 to `prod` (POST/PUT will be wired here; the actual dialog UI is Phase 3 but the `label-manager` action is the same code path) → `client.pull_prompt("name", label="prod")` returns v1 from the SDK.

---

## Phase 1 — Trace → prompt badge

### New component
- `dashboard/components/prompts/prompt-version-badge.tsx` — pill rendered after the metrics strip in `trace-inspector.tsx:253-265` only when `node.type === 'agent'`. Format: `name v{n}` + colored `prod`/`staging` pill if a label points at this version. Click opens a `PromptVersionSidePanel` (per roadmap §5.3).

### Side panel
- New component `dashboard/components/prompts/prompt-version-side-panel.tsx`: right-side sliding panel showing the version's `content` (read-only monospace), config chips (model/temp/max_tokens), `variable_values` from the link, and two action buttons:
  - "Open in Playground" → `router.push(/projects/[id]/playground?promptId=&versionId=)`.
  - "Diff with prod" (Phase 3) — placeholder disabled button with a "Coming soon" tooltip until Phase 3 lands.
- Reuses the right-side panel pattern from the trace-inspector (`trace-inspector.tsx:188-285`).

### Trace inspector wiring
- Add `promptLinks: DashboardTracePromptLink[]` to `TraceInspector` props (`trace-inspector.tsx:643-655`).
- Fetch in `traces/[id]/page.tsx:17-22` via `listTracePromptLinks({projectId: backendProjectId, traceId: params.id})` (already exported, `dashboard.ts:485-495`) and pass down.
- Dedupe links by `prompt_version_id` in the badge render.

### Acceptance
- A trace with `prompt_links` rows in the DB shows one badge per distinct version on the trace root, with the linked label name. Clicking opens the side panel with the version content.

---

## Phase 2 — Playground + save-to-dataset

### Routes
- `dashboard/app/(workspace)/projects/[projectId]/playground/page.tsx` — shell.
- `dashboard/app/api/projects/[projectId]/playground/route.ts` — server-side SSE proxy.

### Components (in `dashboard/components/playground/`)
- `playground-page.tsx` — three-column shell: sidebar (prompt picker) + center (variable form, run button, streaming output, metrics) + right (diff pane, version-history drawer, save-to-dataset button).
- `prompt-picker.tsx` — `GET /api/projects/[id]/prompts` + selected prompt's `versions` (`GET /api/projects/[id]/prompts/[promptId]/versions`); version + label selector.
- `model-picker.tsx` — uses `requiredProviderForModel` from `provider-key-config.ts:55-72`. Calls `GET /api/projects/[id]/provider-keys`; if no key, disable run button with tooltip "Add your {provider} API key in Settings → Provider keys".
- `variable-form.tsx` — auto-generates inputs from the selected `prompt_version.variables` (strings, numbers, booleans inferred from `type`).
- `run-button.tsx` — POSTs to `/api/projects/[id]/playground` with `EventSource` (or `fetch` + reader for `text/event-stream`); updates streaming buffer. Disable when no provider key.
- `diff-pane.tsx` — Phase 3; placeholder disabled panel in Phase 2.
- `save-to-dataset-button.tsx` — reuses the `AddToDatasetButton` pattern from `trace-inspector.tsx:411-627` (POSTs to `/api/projects/[id]/eval-datasets/[datasetId]/cases`), with `input` = last user message and `expected` = last assistant response from the playground session.
- `version-history-drawer.tsx` — right drawer showing the prompt's versions, click to switch the active version.

### Backend SSE proxy
- `dashboard/app/api/projects/[projectId]/playground/route.ts`:
  1. Auth via `requireDashboardBackendProject`.
  2. Resolve prompt version (`GET` against `dashboard_get_prompt` or the resolve RPC).
  3. Resolve the provider key (already shipped — `dashboard_get_provider_key` is exposed via `provider-key-store.ts:30-36`).
  4. Call the upstream provider **HTTP streaming** endpoint (OpenAI `/v1/chat/completions`, Anthropic `/v1/messages` with `stream: true`).
  5. Relay each `data:` chunk as an SSE frame to the client.
  6. On stream complete, write a `done` frame with `tokens`, `cost`, `latency`.
  7. Optional: write a `prompt_trace_link` row via `dashboard_link_span_to_prompt` for a synthetic run.

### Open question (decision needed)
Playground upstream transport: fetch-based SSE (no new deps) or install `openai` + `@anthropic-ai/sdk`? The current package.json has neither. Both providers expose clean SSE over `fetch` + `ReadableStream`, which keeps bundle small and edge-friendly. Recommendation: **fetch-based** for OpenAI + Anthropic; ship a thin adapter per provider keyed by `requiredProviderForModel`. Add to `dashboard/lib/providers/` (new dir).

### Acceptance
- Pick a prompt, set variables, hit Run → tokens stream in. Click Save to dataset → row added with input/expected. The synthetic run + `prompt_trace_link` show up in the trace detail page (this also feeds Phase 1 verification for new SDK emits).

---

## Phase 3 — Diff view + promote-to-label dialog

### Components
- `dashboard/components/playground/diff-pane.tsx` — two-mode: `text` and `config`. Text uses line-level diff (right-pane annotated `+ Added` / `~ Changed` markers). Config uses a unified `{model, temperature, max_tokens, variables}` JSON diff.
- `dashboard/components/prompts/promote-label-dialog.tsx` — Radix `Dialog`. Shows: target label (default `prod`), current version at that label, the new version (selected row from the version list), `change_note` textarea. **Client-enforced:** when `label === 'prod'`, submit disabled until `change_note.trim().length > 0`. Calls `PUT /api/projects/[id]/prompts/[promptId]/labels/[label]`. On 400 (server enforces same rule), surface the API error.
- `dashboard/components/prompts/diff-with-prod-button.tsx` — used in `prompt-version-side-panel.tsx` (Phase 1) and `version-row.tsx` (Phase 0). Opens the diff pane focused on the version vs the current `prod` label.

### Open question (decision needed)
Diff libs: install `diff` (Myers) and `jsondiffpatch` (config diff) per roadmap §4.2, or roll our own minimal implementation. The content diff is small enough to write by hand; the config diff is the only one with a real benefit from a library. Recommendation: install **`diff`** (small, ~10KB) and **inline a small recursive JSON diff** (no extra dep needed; the `variables` array is small).

### Acceptance
- Two versions side-by-side show the content diff with `+ Added`/`~ Changed`/`- Removed` annotations.
- Clicking "Promote to prod" on a version opens the dialog; `change_note` is required and the submit button is disabled without it. The 400 from the server is mirrored client-side for the same case.

---

## Cross-cutting changes
- `dashboard/components/app-shell.tsx:21-31` — add two nav entries (`Prompts`, `Playground`).
- `dashboard/lib/projects.ts:38-59` — extend `projectHref` section union to include `'prompts' | 'playground'`; update `projectSwitchHref` regex.
- `dashboard/lib/supabase/types.ts:467-539` — already exports the prompt types; no change.
- `dashboard/lib/supabase/dashboard.ts:394-495` — already exports prompt wrappers; no change.
- Optional: `tests/dashboard/prompts.test.ts` for the client-side variable-extraction heuristic (mirror the SDK's `_prompt_template.py` tests so the dashboard and SDK stay aligned — addresses roadmap §8 risk #8).

## Out of scope (this plan)
- Prompt A/B routing (roadmap §0 non-goal).
- Multi-modal content (roadmap §0).
- SSO/RBAC (roadmap §0, blocked on SOTA gap #2).
- Audit log beyond `prompt_label_history` (roadmap §9).

---

## Verification plan
- `pnpm --filter dashboard typecheck` (or `npm run typecheck`).
- `pnpm --filter dashboard lint`.
- Manual: create prompt → add v1 → set `prod` label → `client.pull_prompt("name", label="prod")` from the agent harness (matches Phase 0 demo in roadmap §7).
- Manual: ingest a trace with `prompt_links` populated → badge shows on trace detail → side panel renders content.
- Manual: open playground → run a prompt → save output to a dataset → confirm case row added.

---

## Open questions for you
1. **Scope:** ship all 4 phases in this PR, or land Phase 0 only first and re-evaluate?
2. **Playground upstream transport:** fetch-based SSE (no new deps) or install `openai` + `@anthropic-ai/sdk`? (Recommend fetch-based.)
3. **Diff libs:** install `diff` for content + roll a tiny JSON config diff, or install both `diff` + `jsondiffpatch` per roadmap verbatim? (Recommend `diff` + inline JSON diff.)
4. **Auto-create on trace:** when no prompt is linked but the trace has a `system_message` event, should the trace-inspector offer a "Save as new prompt" action? (Roadmap §5.3 implies not; keeping it out.)
5. **Provider key UX when running playground:** if the project has zero provider keys, should the playground page show a banner linking to settings, or just disable the Run button with a tooltip? (Roadmap §3.5 implies the latter; matching that.)

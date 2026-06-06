# Quick Wins — Implementation Plan

**Source of truth:** `SOTA.md:194-202` (7 quick wins, each <1 day)
**Audit date:** 2026-06-06

---

## Recommended execution order (and why)

| # | Quick Win | Effort | PR order | Why this position |
|---|---|---|---|---|
| 1 | QW1 — Re-enable auth | 1–2 hr | **PR1** | Ships first because every other change is a UI/data tweak that you don't want to ship in a publicly-readable state. Re-enabling auth forces you to also test auth-gated API routes for the subsequent QWs. |
| 2 | QW3 — Error banner on trace view | 2 hr | **PR2** | Smallest scope, no migration, no schema drift, no shared dependencies. Wires up an existing field from mig 015. |
| 3 | QW6 — "Errored" filter + wire real data | 1–2 hr | **PR3** | A migration + a UI chip. Do this *after* QW3 because the migration shape becomes obvious once you've already looked at `runs.error` in the trace view. |
| 4 | QW7 — Render tool calls in session timeline | 2 hr | **PR4** | Pure UI, zero migration, ~2 hrs. Demo impact: a viewer can *see* a tool call right below the parent trace, with error styling for failures. |
| 5 | QW5 — CSV export | 2 hr | **PR5** | New API route + button. Does not need QW1-4 to work but benefits from being able to demo with real data populated by QW6/7. |
| 6 | QW2 — Debounced search + "no search yet" CTA | ½ day | **PR6** | Now that errored runs are visible (QW6) and tool calls are visible (QW7), users will want to find them — search becomes the next obvious need. |
| 7 | QW4 — Alerts settings tab | 1 day | **PR7** | **Largest scope** (new tables, new routes, new form, new "log to console" fire path). Ship last because (a) you want to demo it with realistic data; (b) it has the most surface area for bugs. |

**Total budget:** ~1 dev-day of focused work (8-10 hrs), or ~2 dev-days with realistic padding for QW4 and QW6.

**Demo path after this sequence:** Login → Sessions page (header shows real error rate + filter chip) → Session detail (timeline shows interleaved LLM + tool events, errored tools in red) → Trace detail (error banner at the top, CSV download button) → Settings → Alerts tab (real form, "Test fire" prints to dev server console).

---

## QW1 — Re-enable middleware auth + add session check

**Files to modify**
- `dashboard/middleware.ts:33-46` (uncomment the auth check, but rework the matcher to allow anonymous internal routes and to add the `/auth/callback` route)
- `dashboard/app/login/page.tsx` — already exists at `dashboard/app/login/page.tsx:1-68` and uses `signInWithOtp` → confirm callback handler at `dashboard/app/auth/callback/route.ts` (or page) is wired. **Verify this exists before merging**; if not, create it.
- New: `dashboard/app/auth/callback/route.ts` (if missing) — `GET` handler that exchanges the Supabase auth code for a session cookie and redirects to `/projects`.
- New: `dashboard/app/auth/signout/route.ts` (or a `signOut` server action) — used by the eventual app-shell logout.

**Pseudocode / signature**

```ts
// dashboard/middleware.ts (rewritten)
export async function middleware(request: NextRequest) {
  // 1. Bypass for SDK ingestion (x-api-key path) — keep existing branch at lines 5-7.
  // 2. Bypass for static assets — already covered by `config.matcher`.
  // 3. Bypass for auth routes: /login, /auth/*, /api/auth/*, /_next/*, /favicon.ico
  // 4. Otherwise: createServerClient(URL, ANON, cookieHandlers) → getUser().
  // 5. If no user: redirect to /login?next=<originalPath>.
  // 6. If user and request.nextUrl.pathname === '/login': redirect to /projects.
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|auth|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

**Acceptance criteria**
- Hitting `/projects/demo` with no Supabase session cookie → 307 to `/login?next=%2Fprojects%2Fdemo`.
- After successful magic-link callback, user lands back at the `next=` path with a valid `sb-*-auth-token` cookie.
- `x-api-key` SDK ingest (existing line 5-7 branch) still bypasses auth.
- `/api/auth/*` and `/login` never redirect.
- An authenticated user visiting `/login` is redirected to `/projects`.
- `getUser()` (server-side, validates JWT) is used — NOT `getSession()` (client-trusted).

**Effort: 1 hr is realistic IF `/auth/callback` already exists. Push back to 2-3 hrs** because:
- The current middleware imports `CookieOptions` from `@supabase/ssr` and creates a new `NextResponse.next()` in every `set`/`remove` call (lines 19-28) — this is a known anti-pattern that loses cookies on redirects. Likely needs a refactor to the standard `request.cookies.set` → `response.cookies.set` pattern from the `@supabase/ssr` examples.
- Need to decide what to do about the existing `getDashboardBackendProjectId` cookie-based dev auth (`dashboard/lib/supabase/dashboard.ts:81-99` + `dashboard/components/project-provider.tsx:149-152`). This must still work in dev for non-supabase auth flows.

**Edge cases**
- `request.headers.get('x-api-key')` is set but invalid — currently the middleware just forwards it; the API route handler is where validation should happen (don't 401 in middleware for SDK paths).
- User session exists but `getDashboardBackendProjectId` returns null (e.g. demo project with no `NORTHSTAR_DEMO_BACKEND_PROJECT_ID`) — middleware should let it through and let the page handle the empty state, not bounce back to login.
- OAuth provider returns an error to `/auth/callback` — handler should redirect to `/login?error=<msg>` rather than looping.
- Stale JWT cookie after Supabase rotates signing keys — `getUser()` will throw; middleware should clear the cookie and redirect.
- Middleware runs on every request including image/route prefetch; the matcher exclusion list is the safety net.
- Auth state changes (sign-in / sign-out) require a page refresh in Next.js App Router unless we add a `revalidatePath` in the callback. Document this in the PR.

---

## QW2 — Search/filter CTA + debounced text input

**Files to modify**
- `dashboard/components/sessions-table.tsx:110-119` — existing text input is **not debounced** and has no "no server search yet" CTA. Add a 200ms debounce, surface a small hint, and expand the `useMemo` needle (lines 60-74) to also search `trace.name` and (once available) `model`.
- `dashboard/components/recent-trace-timeline.tsx:50-86` — no search input exists at all. Add a debounced search input to the right of the sort chips and filter on `trace.name`, `trace.model`, `trace.id`, `trace.session_id`.
- New shared hook: `dashboard/lib/use-debounced-value.ts` — `function useDebouncedValue<T>(value: T, delayMs?: number): T` (default 200ms). Pulled out so both components use the same implementation.

**Pseudocode / signature**

```ts
// dashboard/lib/use-debounced-value.ts
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}
```

```ts
// sessions-table.tsx — replace useState at line 54
const [query, setQuery] = useState('')
const debouncedQuery = useDebouncedValue(query, 200)
// then use debouncedQuery in the useMemo at line 60
```

```ts
// recent-trace-timeline.tsx — add inside RecentTraceTimeline, before the sort row
const [query, setQuery] = useState('')
const debouncedQuery = useDebouncedValue(query, 200)
const filtered = useMemo(() => {
  const needle = debouncedQuery.trim().toLowerCase()
  if (!needle) return traces
  return traces.filter((t) => {
    return (
      t.name.toLowerCase().includes(needle) ||
      (t.model ?? '').toLowerCase().includes(needle) ||
      t.id.toLowerCase().includes(needle) ||
      t.session_id.toLowerCase().includes(needle)
    )
  })
}, [traces, debouncedQuery])
const sorted = useMemo(() => sortTraces(filtered, sortSpec), [filtered, sortSpec])
```

Add a small inline pill next to the search input on both components:
> `<span class="font-mono text-[10px] text-muted-foreground">Client-side filter · server search coming</span>`

**Acceptance criteria**
- Typing in the sessions search debounces by 200ms (verifiable with React DevTools / `console.log` of when `useMemo` recomputes).
- Same debounce on the recent traces search.
- The "no search yet" pill is visible but unobtrusive.
- Clearing the input restores the full list with no flash of empty state.
- `sessions-table.tsx` search expands from `sess_${id}` to also match `trace.name` and `model` (most of the real signal).
- Server-side `ilike` is **explicitly deferred** — leave a `// TODO(server-search)` comment next to the input.

**Effort: ½ day is right.** Add ~30 min for the shared hook + tests, ~1.5 hrs per component, ~30 min for the pill UI.

**Edge cases**
- Empty session: input still shows; filter is a no-op.
- Special regex / Unicode characters in the query — `String.includes` is safe (no regex).
- Very fast typing: timeout cleanup must fire (the hook does).
- Currently in `sessions-table.tsx:68-71`, the `needle` only matches `sess_${session.id}`. If you have hundreds of sessions you can't find by `run_name` or `model`. Expand the haystack to include a derived `displayHaystack` that contains the session ID + joined trace names.
- `recent-trace-timeline.tsx:48` already wraps `sortTraces` in `useMemo` — make sure `filtered` is the upstream, not the other way around.
- The "Errored first" sort chip at `recent-trace-timeline.tsx:32` will conflict with the search pill in the toolbar layout — make sure it wraps cleanly (`flex-wrap` is already on at line 52, but the right-side legend at lines 81-85 will push the search input down on narrow viewports; consider moving the search above the sort row).

---

## QW3 — Show error banner on trace view when `runs.error` is non-null

**Files to modify**
- `dashboard/components/trace-inspector.tsx:198-210` — the "Compact Metrics Strip" sits in `DetailPanel`. Add a red error banner above the strip that renders only when `(node.data as DashboardTrace).error` is non-null AND `node.type === 'agent'`. Optionally show a smaller banner for tool-level errors on tool nodes.
- `dashboard/lib/supabase/types.ts:224-237` — `DashboardTrace.error: Json | null` already exists, and migration `migrations/015_expose_trace_errors.sql:30-31, 65-66` already returns it. **No type or migration changes required.**
- `dashboard/components/trace-inspector.tsx:14-27` (the `SpanNode` interface) — `data: DashboardTrace | DashboardToolCall | DashboardTraceEvent` already accommodates the field.

**Pseudocode / signature**

```tsx
// in DetailPanel, insert between line 195 and the closing of the header div
{isTrace && (node.data as DashboardTrace).error && (
  <ErrorBanner error={(node.data as DashboardTrace).error!} />
)}
{isTool && (node.data as DashboardToolCall).error && (
  <ErrorBanner error={(node.data as DashboardToolCall).error!} compact />
)}
```

```tsx
function ErrorBanner({ error, compact = false }: { error: Json; compact?: boolean }) {
  const message = extractErrorMessage(error)  // "Tool call failed: timeout" etc.
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-[#f09595] bg-[#fcebeb] px-3 py-2 text-[12px] text-[#a32d2d]',
        compact && 'py-1.5 text-[11px]'
      )}
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">Run failed</div>
        <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px]">
          {message}
        </pre>
      </div>
    </div>
  )
}

function extractErrorMessage(error: Json): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    return String(e.message ?? e.error ?? e.detail ?? JSON.stringify(error))
  }
  return 'Unknown error'
}
```

**Acceptance criteria**
- Trace detail page for a run with `runs.error = {"message": "Rate limit"}` shows a red banner with the message.
- Trace detail page for a successful run shows **no** banner.
- Tool nodes with `error` set show a compact banner.
- Banner is keyboard-accessible (`role="alert"`, `aria-live="assertive"`).
- JSON longer than ~5 lines is truncated behind a "Show full" disclosure (optional but recommended — error payloads can be huge).
- Visual contrast passes the existing palette tokens (`#f09595` / `#fcebeb` / `#a32d2d` already used at `recent-trace-timeline.tsx:135, 213`).

**Effort: 2 hrs is right.** No migration, no type changes. ~45 min implementation, ~30 min polish (long-error handling, accessibility), ~45 min manual test across errored/successful/mixed traces.

**Edge cases**
- `error` is an empty object `{}` — current migration returns the raw `r.error` JSONB so this is possible. Treat as "no error" (the `extractErrorMessage` should fall through to `'Unknown error'` but the banner condition is `error && extractErrorMessage(error) !== 'Unknown error'`, or simply guard `Object.keys(error as object).length > 0`).
- `error` is a stack trace string (multiline). The `<pre>` with `whitespace-pre-wrap` handles it; consider a `max-h-32 overflow-y-auto` for giant traces.
- Span-level errors (private.spans.error via `dashboard_list_trace_spans`) — Quick Win says "show error banner on trace view when `runs.error` is non-null", so **scope is the run error, not span errors**. Don't expand scope here.
- Non-agent nodes (LLM events, user_input, etc.) with no `error` field — don't render.
- Migration 015 only updated `dashboard_list_traces` and `dashboard_get_trace`. Verify the types match what Supabase returns — if the live RPC drift caused `error` to be missing at runtime, the banner simply won't render. Not a blocker.

---

## QW4 — Wire the alerts settings tab to a real form

**Files to modify**
- `dashboard/components/settings-page.tsx:584-603` — replace the `AlertSettings` stub. Convert the three `ToggleRow` calls (lines 588-590) into stateful form with persistence, and replace the `<DisabledButton primary>` at line 597 with a working "Add" button.
- New: `dashboard/app/api/projects/[projectId]/alert-rules/route.ts` — `GET` / `POST` / `PATCH` / `DELETE` for alert rule CRUD. Persists to a new `alert_rules` table.
- New: `dashboard/app/api/projects/[projectId]/webhooks/route.ts` — `GET` / `POST` / `DELETE` for webhook CRUD. Persists to a new `webhooks` table. Fires a "log to console" `POST` on alert trigger (sufficient for demo per SOTA spec).
- New migration: `migrations/017_alert_rules_and_webhooks.sql` — creates `alert_rules` (id, project_id, kind enum, threshold numeric, enabled bool) and `webhooks` (id, project_id, url, status, created_at). Both RLS-protected. Calls go through `pg_net` to a no-op endpoint or to a server action that does `console.log` (the SOTA doc says "log to console is enough to demo the flow").
- Update: `dashboard/lib/supabase/dashboard.ts` — add `listDashboardAlertRules`, `upsertDashboardAlertRule`, `deleteDashboardAlertRule`, `listDashboardWebhooks`, `createDashboardWebhook`, `deleteDashboardWebhook`.

**Pseudocode / signature**

```ts
// dashboard/components/settings-page.tsx — AlertSettings (rewrite)
function AlertSettings() {
  const project = useActiveProject()
  const [rules, setRules] = useState<AlertRule[]>([])
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { /* fetch /api/projects/${project.id}/alert-rules + webhooks */ }, [project.id])

  async function toggleRule(rule: AlertRule) {
    setSaving(true)
    const res = await fetch(`/api/projects/${project.id}/alert-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    if (res.ok) { const updated = await res.json(); setRules(rs => rs.map(r => r.id === updated.id ? updated : r)) }
    setSaving(false)
  }

  async function addWebhook() {
    if (!newUrl.startsWith('https://')) { setError('Webhook URL must be https://'); return }
    setSaving(true)
    const res = await fetch(`/api/projects/${project.id}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newUrl }),
    })
    if (res.ok) { setWebhooks(ws => [...ws, await res.json()]); setNewUrl(''); setMessage('Webhook added.') }
    else setError('Could not add webhook.')
    setSaving(false)
  }

  async function deleteWebhook(id: string) { /* ... */ }

  return (
    <>
      <SettingsSection title="Alert rules" icon={Bell}>
        {rules.length === 0 && <p className="ns-settings-help">No rules yet — defaults are off.</p>}
        {rules.map((rule) => (
          <ToggleRow
            key={rule.id}
            label={RULE_LABELS[rule.kind]}
            description={RULE_DESCRIPTIONS[rule.kind]}
            checked={rule.enabled}
            onChange={() => toggleRule(rule)}
          />
        ))}
      </SettingsSection>
      <SettingsSection title="Webhooks" icon={Webhook}>
        {webhooks.map((w) => (
          <WebhookRow key={w.id} status={w.status} url={w.url} onDelete={() => deleteWebhook(w.id)} />
        ))}
        <div className="mt-2.5 flex gap-2">
          <input className="ns-input" placeholder="https://..." value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
          <button className="ns-button ns-button-primary" disabled={saving || !newUrl} onClick={addWebhook}><Plus />Add</button>
        </div>
        {error && <p className="ns-settings-help text-red-700">{error}</p>}
        {message && <p className="ns-settings-help text-[var(--ns-green-dark)]">{message}</p>}
      </SettingsSection>
    </>
  )
}
```

```ts
// webhook "fire" — in dashboard/app/api/projects/[projectId]/webhooks/route.ts or a server-side cron
async function fireWebhook(webhook: Webhook, payload: AlertPayload) {
  // SOTA spec: "log to console is enough"
  console.log(`[NorthStar webhook ${webhook.id}] POST ${webhook.url}`, JSON.stringify(payload))
  // In production: fetch(webhook.url, { method: 'POST', body: JSON.stringify(payload) })
}
```

**Acceptance criteria**
- The three toggles from the stub (Error rate, Latency, Token budget) are persisted and survive a hard refresh.
- Adding a webhook URL persists it, shows in the list, and a test-fire (or save) triggers a `console.log` line in the dev server with the payload.
- Deleting a webhook works.
- Validation rejects non-`https://` URLs.
- The "Persistence API not connected" `DisabledButton` (line 696) is no longer used in this tab.

**Effort: ½ day is tight. Push back to 1 day.** Here's why:
- New SQL migration + RPCs = ~2 hrs
- Two new API route handlers with CRUD = ~1.5 hrs
- State management + form wiring = ~1.5 hrs
- Manually test: toggle persistence, webhook add/delete, error states, redirect-after-save = ~1 hr
- Polishing: the "log to console" requirement is easy, but you'll want a small "Test fire" button per webhook to demo it live; budget ~1 hr for that.

**Edge cases**
- Two users toggling the same rule simultaneously — last-write-wins is fine for now, but `updated_at` should be returned.
- Webhook URL with credentials (`https://user:pass@hooks.example.com/x`) — store as-is but log a warning if URL contains `@`.
- HTTPS-only enforcement: prod should require it; dev should allow `http://localhost:*`.
- The `WebhookRow` component at `settings-page.tsx:757-765` currently uses a `DisabledButton` for the trash icon. Replace with a real delete button.
- "Test fire" payload must match the shape the eventual alert engine emits (define a `AlertPayload` type in `lib/alerts.ts` and use it both in the test fire and in the eventual real fire).
- If Supabase doesn't have `pg_net` enabled, swap to a server-side cron via `vercel.json` or a Supabase Edge Function.

---

## QW5 — Per-run CSV export button on trace detail

**Files to modify**
- `dashboard/components/trace-inspector.tsx:152-194` (the header `DetailPanel`) — add a "Download CSV" icon button next to the existing `Copy` button (line 191). Visible only when `isTrace` (i.e. for the root node).
- New: `dashboard/app/api/projects/[projectId]/traces/[traceId]/export/route.ts` — `GET` handler. Pulls the run + spans + tool calls, formats as CSV, returns a `Response` with `Content-Type: text/csv` and `Content-Disposition: attachment; filename="trace_<id>.csv"`.
- `dashboard/lib/supabase/dashboard.ts` — add `exportDashboardTraceAsCsv(projectId, traceId): Promise<string>` that fetches the data via the existing `getDashboardTrace`, `listTraceSpans`, `listTraceToolCalls`, `listTraceEvents` functions and returns a CSV string. Keep the route thin.

**Pseudocode / signature**

```ts
// dashboard/lib/csv.ts (new shared util)
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n')
}
```

```ts
// dashboard/lib/supabase/dashboard.ts
export async function exportDashboardTraceAsCsv(
  projectId: BackendProjectId,
  traceId: string
): Promise<string> {
  const [trace, spans, toolCalls, events] = await Promise.all([
    getDashboardTrace(projectId, traceId),
    listTraceSpans(projectId, traceId),
    listTraceToolCalls(projectId, traceId),
    listTraceEvents(projectId, traceId),
  ])
  if (!trace) throw new Error('Trace not found')
  // One CSV file with sectioned blocks (spans, tool_calls, events) for downstream analysis.
  return [
    '# trace',
    toCsv([traceToRow(trace)]),
    '',
    '# spans',
    toCsv(spans.map(spanToRow)),
    '',
    '# tool_calls',
    toCsv(toolCalls.map(toolCallToRow)),
    '',
    '# events',
    toCsv(events.map(eventToRow)),
  ].join('\n')
}
```

```ts
// dashboard/app/api/projects/[projectId]/traces/[traceId]/export/route.ts
import { exportDashboardTraceAsCsv, getDashboardBackendProjectId } from '@/lib/supabase/dashboard'
import { parseProjectId } from '@/lib/projects'

export async function GET(_req: Request, ctx: { params: { projectId: string; traceId: string } }) {
  const projectId = parseProjectId(ctx.params.projectId)
  if (!projectId) return new Response('Not found', { status: 404 })
  const backendProjectId = getDashboardBackendProjectId(projectId)
  if (!backendProjectId) return new Response('Not found', { status: 404 })

  const csv = await exportDashboardTraceAsCsv(backendProjectId, ctx.params.traceId)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="trace_${ctx.params.traceId.slice(0, 8)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
```

```tsx
// in DetailPanel, near line 191 — add CSV button next to Replay
<button
  className="ns-button !border-transparent !shadow-none !h-7 !px-2.5 !text-[11px] !bg-transparent hover:!bg-white"
  onClick={() => downloadCsv(projectId, traceId)}
  title="Download run as CSV"
>
  <Download className="w-3 h-3" /> CSV
</button>
```

**Acceptance criteria**
- Clicking the CSV button on a trace detail page triggers a browser download named `trace_<short>.csv`.
- The CSV contains four sections: `# trace` (one row), `# spans`, `# tool_calls`, `# events` — each with a header row.
- JSON columns (e.g. `params`, `output`, `error`, `attributes`) are either inlined as JSON strings or stringified to one cell, and quoted/escaped.
- Special characters (commas, quotes, newlines) in any field are properly CSV-escaped.
- A trace with no tool calls or events still produces a valid file.
- The button is **only** enabled on the root agent node (`isTrace`), not on tool/event children (which would re-export the parent run).
- A 404 returns the proper HTTP status; an empty trace returns an empty file (no 500).

**Effort: 2 hrs is right.** Breakdown:
- CSV util + escaping tests = 30 min
- `exportDashboardTraceAsCsv` data layer = 20 min
- Route handler = 15 min
- Button + download wiring = 15 min
- Manual test with real trace data, special chars, empty fields = 30 min
- A separate test using `dashboard/lib/csv.test.ts` for the escape rules = 15 min

**Edge cases**
- Very large trace (1k+ spans, 10k+ events) — the CSV will be MBs. Add a `Content-Length` header and consider streaming for very large cases, but cap at e.g. 50k rows in v1.
- Bypass auth: this route goes through the same `x-api-key` middleware branch but does **not** check it. For an MVP it's fine; for production, gate behind a session OR a `?token=` API key.
- The `dashboard_list_trace_spans` RPC can fail with `PGRST202` (line 170 in `dashboard.ts`) and returns `[]` — the CSV section will be empty, which is the desired behavior.
- The new `DashboardTraceWithToolCalls` shape attaches tool calls, but the export path should use the raw `toolCalls` list (not attached per-trace) since there's only one trace. Be careful not to double-count.
- `error: Json | null` from migration 015 will now appear in the CSV — that's the point.
- BOM: prepend `\uFEFF` to the CSV string so Excel opens it correctly with non-ASCII content.
- The `Download` icon is from `lucide-react` and isn't currently imported in `trace-inspector.tsx:4-8` — add it to the import.

---

## QW6 — "Errored" filter chip + wire `errored` to real data

**Files to modify**
- `dashboard/app/(workspace)/projects/[projectId]/sessions/page.tsx:153` — replace `const errored = 0` with a real count. The cleanest path: a new SQL column on the session row (see migration below) OR compute it client-side from a per-session derived field. **Strongly recommend a migration** because the cost of computing it client-side is O(traces-per-session) RPC calls.
- `dashboard/app/(workspace)/projects/[projectId]/sessions/page.tsx:142-197` — update `computeStats` to use the new field.
- `dashboard/components/sessions-table.tsx:20-27` and `:60-74` — add a fifth filter chip `{ value: 'errored', label: 'Errored' }` and a filter branch in the `useMemo`. Color it amber/red to match the existing palette.
- New migration: `migrations/017_session_errored_count.sql` (or fold into 017 alongside alerts/webhooks) — extend `dashboard_list_sessions` to return an `errored_count BIGINT` derived from `COUNT(*) FILTER (WHERE r.status IN ('error', 'failed'))` over the runs for each session. Migration 016 already uses two CTEs (`run_summary`, `tool_summary`) — add a third or extend `run_summary` to also compute the errored count.
- `dashboard/lib/supabase/types.ts:382-383` — `DashboardSession` is derived from the RPC return type, so it will auto-update after `supabase gen types` runs. If you don't want to regen, add an explicit type override.

**Pseudocode / signature**

```sql
-- migrations/017_session_errored_count.sql
DROP FUNCTION IF EXISTS public.dashboard_list_sessions(UUID);

CREATE FUNCTION public.dashboard_list_sessions(p_project_id UUID)
RETURNS TABLE (
    id                  UUID,
    created_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    trace_count         BIGINT,
    tool_call_count     BIGINT,
    errored_count       BIGINT,        -- NEW
    total_cost_usd      NUMERIC,
    total_input_tokens  BIGINT,
    total_output_tokens BIGINT
)
LANGUAGE sql STABLE SET search_path = '' AS $$
    WITH run_summary AS (
        SELECT
            r.session_id,
            COUNT(*) AS trace_count,
            COUNT(*) FILTER (WHERE r.status IN ('error','failed')) AS errored_count,
            COALESCE(SUM((r.metadata->>'cost_usd')::numeric), 0) AS total_cost_usd,
            COALESCE(SUM((r.metadata->>'total_input_tokens')::bigint), 0)::bigint AS total_input_tokens,
            COALESCE(SUM((r.metadata->>'total_output_tokens')::bigint), 0)::bigint AS total_output_tokens
        FROM private.runs r
        WHERE r.project_id = p_project_id
        GROUP BY r.session_id
    ),
    tool_summary AS (
        SELECT r.session_id, COUNT(*) AS tool_call_count
        FROM private.spans tool_span
        JOIN private.runs r ON r.id = tool_span.run_id AND r.project_id = tool_span.project_id
        WHERE tool_span.project_id = p_project_id AND tool_span.kind = 'tool'
        GROUP BY r.session_id
    )
    SELECT
        s.id, s.created_at, s.ended_at,
        COALESCE(run_summary.trace_count, 0),
        COALESCE(tool_summary.tool_call_count, 0),
        COALESCE(run_summary.errored_count, 0),       -- NEW
        COALESCE(run_summary.total_cost_usd, 0),
        COALESCE(run_summary.total_input_tokens, 0),
        COALESCE(run_summary.total_output_tokens, 0)
    FROM private.sessions s
    LEFT JOIN run_summary  ON run_summary.session_id  = s.id
    LEFT JOIN tool_summary ON tool_summary.session_id = s.id
    WHERE s.project_id = p_project_id
    ORDER BY s.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.dashboard_list_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_list_sessions(UUID) TO service_role;
```

```ts
// sessions/page.tsx — replace line 153
const errored = sessions.reduce((acc, s) => acc + ((s as any).errored_count ?? 0), 0)
// or, after type regen:
const errored = sessions.reduce((acc, s) => acc + s.errored_count, 0)
```

```tsx
// sessions-table.tsx — extend FILTERS (line 22)
const FILTERS: { value: StatusFilter; label: string; tone?: 'default' | 'warn' }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'last24h', label: 'Last 24h' },
  { value: 'errored', label: 'Errored', tone: 'warn' },  // NEW
]

// in the useMemo at line 64, add:
if (filter === 'errored' && ((session as any).errored_count ?? 0) === 0) return false

// pass the tone into the chip className
```

**Acceptance criteria**
- Sessions page header stat "Error rate" + "X sessions errored" reflects real counts after the migration runs.
- Clicking the "Errored" filter chip in the sessions table filters to only sessions with `errored_count > 0`.
- The chip is visually distinct (amber/red border + background, matching `#fcebeb` / `#a32d2d` already in use at `recent-trace-timeline.tsx:135`).
- "Errored" combines correctly with the search input (QW2) — i.e. a session that has errors but doesn't match the search is excluded.
- Stats are consistent: the page header count and the table-filtered count can differ (the table may be paginated / filtered), but the header number is always the total across all sessions.

**Effort: 1 hr is tight; push back to 2 hrs.** Breakdown:
- Migration + regen types = 30 min
- Update `computeStats` + pass through = 15 min
- Add the chip + filter branch + tone prop = 30 min
- Verify the existing `recent-trace-timeline.tsx:32` "Errored first" sort and the new "Errored" filter play nicely = 15 min
- A regression in the existing `sessions-table.tsx` test (if any) = 15 min
- Manual test: empty state, sessions with no errors, sessions with mixed runs = 15 min

**Edge cases**
- Session has runs in multiple error states (`error`, `failed`, partial) — the migration uses `IN ('error','failed')` to match the client logic at `sessions/[id]/page.tsx:43-44`. If the upstream `runs.status` enum has other failure values (e.g. `timeout`), they won't be counted. Verify with a `SELECT DISTINCT status FROM private.runs` first.
- Session with errors but `ended_at IS NULL` (still active) — counts as errored. Probably correct behavior; flag for product review.
- TypeScript: `DashboardSession` is a derived type from `Database['public']['Functions']['dashboard_list_sessions']['Returns'][number]`. After the migration, `supabase gen types` will add `errored_count`; until then use `(s as any).errored_count ?? 0` and leave a `TODO(gen-types)`.
- The existing `recent-trace-timeline.tsx:32` "Errored first" sort uses `status` as the key — adding the filter chip might confuse users. Add a tooltip on the chip explaining "Sessions with at least one errored run".
- Migration 016 just shipped and is the current `dashboard_list_sessions` — QW6 changes the signature. The migration is `DROP FUNCTION IF EXISTS` + `CREATE FUNCTION`, so it's safe to re-run.

---

## QW7 — Render tool calls in the session timeline

**Files to modify**
- `dashboard/components/trace-timeline.tsx:8-28` — the `TimelineEvent` type currently only has `start` and `trace`. Add a third variant: `{ type: 'tool'; id; timestamp; toolCall: DashboardToolCall; traceId: string }`.
- `dashboard/components/trace-timeline.tsx:21-28` — extend the loop to also push a `tool` event for every `toolCall` on each trace. Important: deduplicate / sort by `created_at` (the loop already does `events.sort` at line 30, so just push).
- `dashboard/components/trace-timeline.tsx:158-161` — add a new `event.type === 'tool'` branch in `TimelineItem` rendering a wrench icon and a clickable link to the parent trace with the tool name + status.
- `dashboard/app/(workspace)/projects/[projectId]/sessions/[id]/page.tsx:27-32, 36` — the page already calls `listSessionToolCalls` and uses `attachToolCalls` (lines 36), which puts tool calls on each trace. Good — `TraceTimeline` already receives `DashboardTraceWithToolCalls[]` (line 14 of `trace-timeline.tsx`), so tool calls are available via `trace.tool_calls`.

**Pseudocode / signature**

```tsx
// trace-timeline.tsx — extend TimelineEvent (line 8)
type TimelineEvent =
  | { type: 'start'; id: 'start'; timestamp: number }
  | { type: 'trace'; id: string; timestamp: number; trace: DashboardTraceWithToolCalls }
  | { type: 'tool'; id: string; timestamp: number; toolCall: DashboardToolCall; parentTraceId: string }
```

```tsx
// trace-timeline.tsx — extend event construction (line 21)
const events: TimelineEvent[] = [
  { type: 'start', id: 'start', timestamp: sessionStartMs },
]

for (const trace of traces) {
  const traceMs = new Date(trace.created_at).getTime()
  events.push({ type: 'trace', id: trace.id, timestamp: traceMs, trace })
  for (const toolCall of trace.tool_calls) {
    const toolMs = new Date(toolCall.created_at).getTime()
    events.push({
      type: 'tool',
      id: `${trace.id}:${toolCall.id}`,
      timestamp: toolMs,
      toolCall,
      parentTraceId: trace.id,
    })
  }
}
```

```tsx
// trace-timeline.tsx — add new branch in TimelineItem, between 'start' and 'trace'
if (event.type === 'tool') {
  const { toolCall, parentTraceId } = event
  const isToolError = toolCall.error !== null
  const tone: 'tool' | 'tool-error' = isToolError ? 'tool-error' : 'tool'
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          tone === 'tool' && 'text-[#0c447c]',
          tone === 'tool-error' && 'text-[#a32d2d]'
        )}
        style={iconStyle(tone)}
      >
        {isToolError ? <AlertCircle className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
      </span>
      <Link
        href={traceHref(projectId, parentTraceId)}
        className="flex-1 rounded-md bg-[var(--ns-panel)] px-3 py-1.5 hover:underline"
      >
        <div className="flex items-center justify-between">
          <span className={cn('text-[12px] font-medium', isToolError && 'text-[#a32d2d]')}>
            {toolCall.name}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">+{offsetLabel}</span>
        </div>
        {isToolError && (
          <div className="mt-0.5 truncate text-[11px] text-[#a32d2d]">
            {stringifyError(toolCall.error)}
          </div>
        )}
      </Link>
    </div>
  )
}
```

```tsx
// trace-timeline.tsx — extend iconStyle (line 164) to handle new tones
function iconStyle(tone: 'llm' | 'error' | 'tool' | 'tool-error'): React.CSSProperties {
  switch (tone) {
    case 'error':      return { background: '#fcebeb', color: '#a32d2d' }
    case 'tool-error': return { background: '#fcebeb', color: '#a32d2d' }
    case 'tool':       return { background: '#e6f1fb', color: '#0c447c' }
    case 'llm':        return { background: '#eeedfe', color: '#534ab7' }
  }
}
```

The `Wrench` icon is already imported at `trace-inspector.tsx:7` but **NOT** at `trace-timeline.tsx:1` — add it. `AlertCircle` is already imported at line 1.

**Acceptance criteria**
- A session with 1 trace containing 3 tool calls shows: `[start] → [trace] → [tool] → [tool] → [tool]` (in timestamp order).
- A tool call with `error != null` renders with the red palette and shows the error message.
- A tool call without an error renders with the blue palette and the tool name only.
- Clicking a tool node navigates to the parent trace detail (not a tool-specific page, which doesn't exist).
- The trace row still shows the `N tool call(s)` summary line (line 145 of original) — but should probably be removed or relabeled ("2 of 3 shown below") to avoid duplication. Decision: keep the count summary for context but reduce visual weight.
- The events list correctly sorts by timestamp even when tool calls happen at the same millisecond as the parent trace (use `created_at` as tiebreaker).
- The "Waiting for the first trace" empty state at line 32-40 still works (no regression).

**Effort: 2 hrs is right.** Breakdown:
- Extend the type union and event-construction loop = 20 min
- New `TimelineItem` branch for `tool` + tone extension = 40 min
- Polish: indent, link, error preview = 20 min
- Manual test with: 0 tools, 1 tool, 10 tools, 1 errored tool, tool timestamp before/after parent = 20 min
- Update the "N tool calls" subline on trace rows so it doesn't feel redundant = 20 min

**Edge cases**
- Tool call `created_at` is before the parent trace's `created_at` (clock skew, batched ingest) — the `events.sort` at line 30 puts it before, which is the right answer visually. The existing model-call-row inside the trace card already handles this gracefully.
- Two tools with the same `id` across different traces (very rare) — the `id: ${trace.id}:${toolCall.id}` prefix at construction avoids React key collisions.
- A tool with `error` of 50KB — the `stringifyError` should truncate. Use the existing `truncate` helper at `trace-inspector.tsx:557-560` or extract a shared one.
- Tool calls that aren't attached to a `trace` (orphans) — `attachToolCalls` at `dashboard.ts:344-360` groups by `toolCall.trace_id`; an orphan falls off. Existing behavior; not QW7's concern.
- `DashboardToolCall.created_at` is the span's `started_at` (per `dashboard_list_trace_tool_calls` SQL at `migrations/015_expose_trace_errors.sql:164`) — accurate enough for relative ordering, but a tool that started before its parent run was started would be weird. Not a real-world concern.
- The `trace` event label "LLM call · …" at line 127 says `LLM call` — that's a misnomer if a trace has no LLM step (it could be a pure tool workflow). QW7 doesn't fix this; flag it as a follow-up.

---

## Suggested PR split (for reviewability)

1. **PR1:** QW1 (auth)
2. **PR2:** QW3 (error banner)
3. **PR3:** QW6 (errored filter + migration)
4. **PR4:** QW7 (tool timeline)
5. **PR5:** QW5 (CSV export)
6. **PR6:** QW2 (debounced search)
7. **PR7:** QW4 (alerts settings)

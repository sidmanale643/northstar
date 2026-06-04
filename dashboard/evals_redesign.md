# Evals Page Redesign

The current evals experience consists of two pages that are both cluttered, unintuitive, and lack clear user workflows. This plan covers a full redesign of both pages.

## Current Problems

### Evals Listing Page ([evals/page.tsx](file:///Users/sidmanale/Development/northstar/dashboard/app/(workspace)/projects/[projectId]/evals/page.tsx))

- **Just a table** - the entire page is a `<table>` listing datasets with Run/Edit buttons. No summary stats, no recent run results, no visual cues about which datasets have been evaluated or are failing.
- **Redundant with Datasets page** - shows the same columns (format, cases, size, created) as the Datasets page. The user sees the same data twice with no added eval-specific value.
- **No at-a-glance health** - you cannot tell from the listing which datasets are passing, failing, or have never been run.

### Eval Dataset Detail Page ([evals/[datasetId]/page.tsx](file:///Users/sidmanale/Development/northstar/dashboard/app/(workspace)/projects/[projectId]/evals/[datasetId]/page.tsx))

- **1313-line monolith** - everything (dataset metadata, run config, run history, results table, grade details, LLM judge config, model search) is jammed into a single file with no component extraction.
- **Fixed 2-column layout with a cramped 320px sidebar** - the right sidebar contains LLM judge config, run history, AND default graders list all stacked vertically. On smaller screens this is unusable.
- **Information overload in the sidebar** - three separate panels (LLM Judge, Run History, Default Graders) compete for vertical space in a 320px-wide strip.
- **Case results use `<details>` accordions** - expanding a case to see grade breakdowns requires clicking through a non-obvious `<details>` element. The collapsed state shows a tiny pill summary with no visual weight.
- **No run comparison** - you can view one run at a time but cannot compare two runs side-by-side.
- **6 stat tiles on the run summary row** - too many small tiles in a grid that is hard to scan.
- **Raw JSON dump** - a full raw JSON section is always visible at the bottom, taking up space.

---

## Proposed Changes

### Page 1: Evals Listing (evals/page.tsx)

Replace the plain table with a card-based layout that gives each dataset eval-specific context.

#### [MODIFY] [page.tsx](file:///Users/sidmanale/Development/northstar/dashboard/app/(workspace)/projects/[projectId]/evals/page.tsx)

**Header redesign:**
- Keep the current header structure (icon + title + subtitle + "Manage datasets" link)
- Add a summary stats bar below the header with 3 quick metrics:
  - `Datasets` count (mono, foreground)
  - `Last run` relative timestamp
  - `Avg pass rate` across latest runs (color-coded: `#085041` for > 80%, `#6C4B00` for 50-80%, `#791F1F` for < 50%)

**Dataset cards instead of table rows:**

Each dataset gets a card (`rounded-lg border bg-white p-4`) containing:

| Section | Content |
|---------|---------|
| **Left column** | FileJson icon + dataset name (linked, `text-sm font-medium`) + filename in mono below |
| **Center badges** | Format pill, case count pill (same style as Datasets page pills) |
| **Right side** | Latest run mini-result: pass rate as a colored badge (`#E1F5EE`/`#085041` for passing, `#FCEBEB`/`#791F1F` for failing, `secondary`/`muted` for never-run) + relative time |
| **Bottom row** | "Run eval" primary button + "Edit dataset" secondary button |

This means the API response needs to include the latest run summary for each dataset. 

> [!IMPORTANT]
> The current `GET /api/projects/[projectId]/eval-datasets` endpoint only returns dataset metadata, not latest run info. We need to either:
> 1. Extend the API to join the latest `eval_runs` row per dataset, or
> 2. Fire a separate client-side fetch per dataset (N+1 problem, not ideal)
>
> **Recommendation**: Option 1 - extend the API. This is a single SQL join.

**Empty state:**
- Keep the existing centered empty state but add more breathing room and a subtle illustration area (same pattern as the redesigned Datasets page).

---

### Page 2: Eval Dataset Detail (evals/[datasetId]/page.tsx)

This is the bigger rewrite. Break the monolith into focused components and restructure the layout.

#### New layout structure

```
+-------------------------------------------------------------+
| Breadcrumb: Evals > dataset_name                             |
| Title: dataset_name        [Edit dataset] [Run dataset btn]  |
| Subtitle: filename.jsonl                                      |
+-------------------------------------------------------------+
| Tab bar: [ Results ]  [ Configure ]  [ Run History ]         |
+-------------------------------------------------------------+
|                                                               |
|  (Tab content fills remaining space)                          |
|                                                               |
+-------------------------------------------------------------+
```

Replace the 2-column layout with a **tab-based** design. Three tabs:

1. **Results** (default) - shows the active run's results
2. **Configure** - LLM judge settings + deterministic grader reference
3. **Run History** - list of past runs with selection

This eliminates the cramped sidebar and gives each concern full width.

---

#### Tab 1: Results

**Run summary strip** (horizontal bar, not 6 tiles):

```
+-------------------------------------------------------------------+
| Run: Jun 3, 08:14   Status: [passed badge]   42/48 passed  87.5%  |
+-------------------------------------------------------------------+
```

- Single horizontal bar with inline stats, not a 4x or 6x grid of tiles
- Pass rate gets a large mono number with conditional color
- Status badge uses existing `StatusBadge` styles

**Case results table** (replaces accordion):

| Case ID | Status | Grades (inline pills) | Expand |
|---------|--------|----------------------|--------|

- Each row shows the case ID, overall status badge, and inline grade chips (the `GradeChip` component)
- Clicking a row expands an inline detail panel below the row (similar to current `exp-row` in the HTML mockup) - NOT a `<details>` element. Use controlled React state.
- The expanded panel shows:
  - Input / Output side-by-side (`grid-cols-2`) with monospace text in bordered boxes
  - Grade breakdown cards: each grade in a small bordered card with name, status chip, reason text, score metrics, and feedback

**Filter bar:**
- Three filter pills above the table: `All (N)`, `Passed (N)`, `Failed (N)`
- Search input to filter by case ID

**Raw JSON toggle:**
- Move raw JSON to a collapsible section at the very bottom, collapsed by default
- Small "Show raw JSON" button that reveals a `<pre>` block

---

#### Tab 2: Configure

Full-width configuration panel, no longer squeezed into 320px.

**LLM Judge section:**

```
+-------------------------------------------+-------------------------------------------+
| [ ] Enable RubricJudge                    |                                           |
|                                           |                                           |
| Model search:  [_________________]        | Rubric:                                   |
| +-------------------------------------+  | +---------------------------------------+ |
| | model-id-1         provider  $cost  |  | |                                       | |
| | model-id-2         provider  $cost  |  | | (textarea, min-height 120px)          | |
| | model-id-3         provider  $cost  |  | |                                       | |
| +-------------------------------------+  | +---------------------------------------+ |
|                                           |                                           |
| Scoring mode: [ 0-5 score | pass/fail ]  | Temperature: [___]                        |
| Min [__] Max [__] Pass [__]              |                                           |
+-------------------------------------------+-------------------------------------------+
```

- Two-column layout (`grid-cols-2 gap-6`) for model selection (left) and rubric + scoring (right)
- Model search dropdown gets more vertical space (max-height 280px instead of 180px)
- Each model card shows more detail: provider, context window, cost, function calling support

**Deterministic graders reference:**

Below the judge config, show a reference card for the auto-applied graders:

```
+--------------------------------------------------------------+
| Deterministic Graders (always applied)                        |
| +------------------+ +------------------+ +-----------------+ |
| | Tool Usage       | | Output           | | Limits          | |
| | max_tool_calls   | | contains         | | max_latency_ms  | |
| | required_tools   | | not_contains     | | max_cost_usd    | |
| | forbidden_tools  | | ground_truth     | |                 | |
| | tool_arguments   | |                  | |                 | |
| +------------------+ +------------------+ +-----------------+ |
+--------------------------------------------------------------+
```

- Three columns, one per grader category
- Each category card uses its existing color scheme (amber for tool, blue for output, green for limits)

---

#### Tab 3: Run History

Full-width list of past runs.

Each run is a card:

```
+--------------------------------------------------------------+
| [status badge]  Jun 3, 08:14                                 |
| 42/48 passed  -  87.5% pass rate  -  0 skipped grades        |
| [View results]                                                |
+--------------------------------------------------------------+
```

- Clicking "View results" or the card itself switches to the Results tab with that run loaded
- Active run has a green left border (`border-l-2 border-l-primary`)

---

### Component Extraction

#### [NEW] components/eval-results-tab.tsx
- `EvalResultsTab` component containing the run summary strip, filter bar, case results table, and raw JSON toggle
- Props: `activeRun: EvalRunDetail | null`, `isLoading: boolean`

#### [NEW] components/eval-configure-tab.tsx
- `EvalConfigureTab` component containing the LLM judge configuration and deterministic graders reference
- All judge state management (model, rubric, scoring mode, temperature) stays here
- Props: `judgeConfig` state + callbacks, `isRunning: boolean`

#### [NEW] components/eval-run-history.tsx
- `EvalRunHistory` component for the run history tab
- Props: `runs: EvalRunSummary[]`, `activeRunId: string | null`, `onSelectRun`, `loadingRunId`

#### [NEW] components/eval-case-row.tsx
- `EvalCaseRow` component for a single expandable case result row
- Extracts the `CaseResultBlock` + `GradeChip` + `GradeMetrics` logic
- Replaces `<details>` with controlled expand state

#### [MODIFY] [page.tsx](file:///Users/sidmanale/Development/northstar/dashboard/app/(workspace)/projects/[projectId]/evals/[datasetId]/page.tsx)
- Reduce from 1313 lines to ~200 lines
- Acts as the layout coordinator: fetches data, manages tab state, renders header + tab bar + active tab component

---

## Color Palette Reference

All colors are already defined in the codebase. No new colors introduced.

| Usage | Color | Variable/Hex |
|-------|-------|-------------|
| Primary green | `#1D9E75` | `--ns-green` |
| Primary green dark | `#0F6E56` | `--ns-green-dark` |
| Pass background | `#E1F5EE` | `--ns-green-pale` |
| Pass text | `#085041` | - |
| Fail background | `#FCEBEB` | - |
| Fail text | `#791F1F` | - |
| Warning background | `#FFF7DD` | - |
| Warning text | `#6C4B00` | - |
| Tool grader accent | `#FAEEDA` bg, `#633806` text | - |
| Output grader accent | `#E6F1FB` bg, `#0C447C` text | - |
| Limits grader accent | `#EAF3DE` bg, `#27500A` text | - |
| LLM judge accent | `#534AB7` | `--ns-purple` |
| Borders | `hsl(43, 13%, 84%)` | `--border` |
| Muted foreground | `hsl(45, 4%, 42%)` | `--muted-foreground` |

---

## Open Questions

> [!IMPORTANT]
> **API change for listing page**: Extending the `GET /api/projects/[projectId]/eval-datasets` response to include latest run data requires a Supabase query change. Should I also add a `latestPassRate` and `latestRunStatus` field to the `EvalDatasetSummary` type, or keep them in a separate nested object like `latestRun: { status, passRate, createdAt } | null`?

> [!IMPORTANT]
> **Run comparison**: The current design has no run comparison feature. Should I add a basic "compare two runs" toggle in the Run History tab for V1, or defer that to a later iteration? Adding it now would require a split-pane results view.

> [!IMPORTANT]
> **Case result filtering**: The current page has no search/filter for case results. Should the Results tab include a search box that filters by case ID, or is the Pass/Fail filter pill bar sufficient?

---

## Verification Plan

### Automated Tests
- `npm run build` to verify TypeScript compilation and no broken imports after component extraction
- Manual browser testing of all three tabs, run execution, and run history selection

### Manual Verification
- Verify the listing page shows correct pass rates per dataset
- Verify the tab navigation preserves state (switching from Results to Configure and back should not lose filter selection)
- Verify the case result expand/collapse behavior works smoothly
- Verify the LLM judge config form validation still works after extraction
- Test on viewport widths: 1280px, 1024px, 768px

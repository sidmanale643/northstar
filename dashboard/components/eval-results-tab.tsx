'use client'

import React, { useState } from 'react'
import { History, Search } from 'lucide-react'
import { JsonViewer } from '@/components/json-viewer'
import { EvalCaseRow } from '@/components/eval-case-row'
import type { EvalRunDetail, Json } from '@/lib/supabase/types'
import { parseEvalResult } from '@/lib/eval-parsers'

interface EvalResultsTabProps {
  activeRun: EvalRunDetail | null
  isLoading: boolean
}

type FilterMode = 'all' | 'passed' | 'failed'

export function EvalResultsTab({ activeRun, isLoading }: EvalResultsTabProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showRawJson, setShowRawJson] = useState(false)

  if (isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center gap-2 text-xs text-muted-foreground">
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading results
      </div>
    )
  }

  if (!activeRun) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-secondary text-muted-foreground">
          <History className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">No persisted runs</div>
          <div className="mt-1 max-w-[420px] text-xs leading-relaxed text-muted-foreground">
            Run this dataset to create a persisted EvalResult.
          </div>
        </div>
      </div>
    )
  }

  const parsedResult = activeRun.result ? parseEvalResult(activeRun.result) : null

  const filteredCases = parsedResult
    ? parsedResult.caseResults.filter((c) => {
        const matchesSearch = !searchQuery.trim() || c.caseId.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesFilter = filterMode === 'all' || c.status === filterMode
        return matchesSearch && matchesFilter
      })
    : []

  const allCount = parsedResult?.caseResults.length ?? 0
  const passedCount = parsedResult?.caseResults.filter((c) => c.status === 'passed').length ?? 0
  const failedCount = parsedResult?.caseResults.filter((c) => c.status === 'failed').length ?? 0

  const passRateColor =
    activeRun.passRate >= 0.8 ? 'text-[#085041]' :
    activeRun.passRate >= 0.5 ? 'text-[#6C4B00]' :
    'text-[#791F1F]'

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5">
        <span className="text-xs text-muted-foreground">
          Run: {formatDate(activeRun.createdAt)}
        </span>
        <span className="text-muted-foreground">·</span>
        <StatusBadge status={activeRun.status} />
        <span className="text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">
          {activeRun.passedCases}/{activeRun.evaluatedCases} passed
        </span>
        <span className={`text-xs font-mono font-semibold ${passRateColor}`}>
          {formatPercent(activeRun.passRate)}
        </span>
      </div>

      {activeRun.status === 'error' ? (
        <div className="rounded-md border border-[#F09595] bg-[#FCEBEB]">
          <div className="border-b border-[#F09595] px-3 py-2.5 text-xs font-medium text-[#791F1F]">
            Eval runner error
          </div>
          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap px-3 py-3 font-mono text-[11px] text-[#791F1F]">
            {formatJson(activeRun.error)}
          </pre>
        </div>
      ) : parsedResult ? (
        <>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 rounded-md border border-border bg-secondary p-1">
              <FilterPill
                active={filterMode === 'all'}
                onClick={() => setFilterMode('all')}
              >
                All ({allCount})
              </FilterPill>
              <FilterPill
                active={filterMode === 'passed'}
                onClick={() => setFilterMode('passed')}
              >
                Passed ({passedCount})
              </FilterPill>
              <FilterPill
                active={filterMode === 'failed'}
                onClick={() => setFilterMode('failed')}
              >
                Failed ({failedCount})
              </FilterPill>
            </div>

            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="ns-input h-8 w-52 pl-8 text-[11px]"
                placeholder="Filter by case ID"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            {filteredCases.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {searchQuery ? 'No cases match your search.' : 'No cases in this category.'}
              </div>
            ) : (
              filteredCases.map((caseResult) => (
                <EvalCaseRow key={caseResult.caseId} caseResult={caseResult} />
              ))
            )}
          </div>
        </>
      ) : (
        <div className="rounded-md border border-[#F0CE72] bg-[#FFF7DD] px-3 py-3 text-xs text-[#6C4B00]">
          The persisted EvalResult could not be rendered as case rows.
        </div>
      )}

      {activeRun.result && (
        <div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowRawJson((prev) => !prev)}
          >
            {showRawJson ? 'Hide raw JSON' : 'Show raw JSON'}
          </button>
          {showRawJson && (
            <div className="mt-2">
              <JsonViewer data={activeRun.result ?? activeRun.error} className="rounded-md bg-muted" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`h-7 rounded px-2.5 text-[11px] font-medium transition-colors ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function StatusBadge({ status }: { status: EvalRunDetail['status'] }) {
  const styles = statusStyles(status)

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${styles.className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

function statusStyles(status: EvalRunDetail['status']) {
  if (status === 'passed') {
    return { className: 'border-[#9AD6C4] bg-[#E1F5EE] text-[#085041]' }
  }
  if (status === 'failed' || status === 'error') {
    return { className: 'border-[#F09595] bg-[#FCEBEB] text-[#791F1F]' }
  }
  return { className: 'border-border bg-secondary text-muted-foreground' }
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatJson(value: Json | null) {
  return JSON.stringify(value, null, 2)
}

'use client'

import React, { useState } from 'react'
import { History, Search, CheckCircle2, XCircle, LayoutGrid, FileJson } from 'lucide-react'
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
      <div className="flex min-h-[420px] items-center justify-center gap-3 text-sm text-muted-foreground">
        <svg className="h-4 w-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading results...
      </div>
    )
  }

  if (!activeRun) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-secondary/30 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary text-muted-foreground shadow-sm">
          <History className="h-6 w-6" />
        </div>
        <div>
          <div className="text-base font-semibold text-foreground">No persisted runs</div>
          <div className="mt-1.5 max-w-[420px] text-sm leading-relaxed text-muted-foreground">
            Run this dataset to create a persisted EvalResult and view the analytics here.
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

  const isPassing = activeRun.passRate >= 0.8
  const isFailing = activeRun.passRate < 0.5
  
  const headerBgClass = isPassing 
    ? 'bg-gradient-to-br from-[#E1F5EE]/50 to-[#E1F5EE]/10 border-[#9AD6C4]/40' 
    : isFailing 
    ? 'bg-gradient-to-br from-[#FCEBEB]/50 to-[#FCEBEB]/10 border-[#F09595]/40'
    : 'bg-gradient-to-br from-[#FFF7DD]/50 to-[#FFF7DD]/10 border-[#F0CE72]/40'

  const headerTextColor = isPassing ? 'text-[#085041]' : isFailing ? 'text-[#791F1F]' : 'text-[#6C4B00]'
  const passRateColor = isPassing ? 'text-[#085041]' : isFailing ? 'text-[#791F1F]' : 'text-[#6C4B00]'

  return (
    <div className="space-y-6 px-5 py-6">
      {/* Hero Stats Header */}
      <div className={`relative overflow-hidden rounded-2xl border ${headerBgClass} p-6 shadow-sm`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <StatusBadge status={activeRun.status} />
              <span className="text-sm font-medium text-muted-foreground">
                Run • {formatDate(activeRun.createdAt)}
              </span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-foreground flex items-baseline gap-2 mt-2">
              <span className={passRateColor}>{formatPercent(activeRun.passRate)}</span>
              <span className="text-lg font-medium text-muted-foreground">Pass Rate</span>
            </div>
            <div className="text-sm font-medium text-muted-foreground mt-1">
              <strong className="text-foreground">{activeRun.passedCases}</strong> out of <strong className="text-foreground">{activeRun.evaluatedCases}</strong> cases passed
            </div>
          </div>
          
          <div className={`hidden md:flex h-20 w-20 items-center justify-center rounded-full bg-white/40 shadow-sm backdrop-blur-md border border-white/50 ${headerTextColor}`}>
             {isPassing ? <CheckCircle2 className="h-10 w-10" /> : isFailing ? <XCircle className="h-10 w-10" /> : <LayoutGrid className="h-10 w-10" />}
          </div>
          
        </div>
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/20 blur-3xl pointer-events-none" />
      </div>

      {activeRun.status === 'error' ? (
        <div className="rounded-xl border border-[#F09595] bg-[#FCEBEB] shadow-sm overflow-hidden">
          <div className="border-b border-[#F09595]/30 bg-white/40 px-4 py-3 text-sm font-semibold text-[#791F1F]">
            Eval runner error
          </div>
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-relaxed text-[#791F1F]">
            {formatJson(activeRun.error)}
          </pre>
        </div>
      ) : parsedResult ? (
        <div className="space-y-4">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border bg-background p-2 shadow-sm">
            {/* Segmented Control */}
            <div className="flex w-full sm:w-auto p-1 bg-secondary rounded-lg">
              <SegmentedButton
                active={filterMode === 'all'}
                onClick={() => setFilterMode('all')}
              >
                All <span className="ml-1.5 opacity-60 text-[10px] bg-background px-1.5 py-0.5 rounded-full">{allCount}</span>
              </SegmentedButton>
              <SegmentedButton
                active={filterMode === 'passed'}
                onClick={() => setFilterMode('passed')}
                className="text-[#085041] data-[state=active]:bg-[#E1F5EE]"
              >
                Passed <span className="ml-1.5 opacity-60 text-[10px] bg-white px-1.5 py-0.5 rounded-full text-[#085041]">{passedCount}</span>
              </SegmentedButton>
              <SegmentedButton
                active={filterMode === 'failed'}
                onClick={() => setFilterMode('failed')}
                className="text-[#791F1F] data-[state=active]:bg-[#FCEBEB]"
              >
                Failed <span className="ml-1.5 opacity-60 text-[10px] bg-white px-1.5 py-0.5 rounded-full text-[#791F1F]">{failedCount}</span>
              </SegmentedButton>
            </div>

            {/* Premium Search */}
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 pl-9 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all hover:bg-secondary/50 focus:bg-background"
                placeholder="Search by case ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            {filteredCases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-border bg-secondary/20">
                <LayoutGrid className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                <div className="text-sm font-medium text-foreground">
                  {searchQuery ? 'No cases found' : 'No cases in this category'}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {searchQuery ? 'Try adjusting your search query.' : 'Try selecting a different filter.'}
                </div>
              </div>
            ) : (
              filteredCases.map((caseResult) => (
                <EvalCaseRow key={caseResult.caseId} caseResult={caseResult} />
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[#F0CE72] bg-[#FFF7DD] px-4 py-4 text-sm font-medium text-[#6C4B00] shadow-sm">
          The persisted EvalResult could not be rendered as case rows.
        </div>
      )}

      {activeRun.result && (
        <div className="pt-8 border-t border-border mt-8">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary/80 transition-colors"
            onClick={() => setShowRawJson((prev) => !prev)}
          >
            <FileJson className="h-4 w-4" />
            {showRawJson ? 'Hide Raw JSON' : 'View Raw JSON Output'}
          </button>
          
          {showRawJson && (
            <div className="mt-4 animate-in slide-in-from-top-2 fade-in duration-200">
              <JsonViewer data={activeRun.result ?? activeRun.error} className="rounded-xl bg-muted p-4 border border-border shadow-inner" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SegmentedButton({
  active,
  onClick,
  children,
  className = '',
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      data-state={active ? 'active' : 'inactive'}
      className={`relative flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
        active 
          ? 'bg-background text-foreground shadow-sm' 
          : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function StatusBadge({ status }: { status: EvalRunDetail['status'] }) {
  const styles = statusStyles(status)

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${styles.className}`}>
      <span className="h-2 w-2 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
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


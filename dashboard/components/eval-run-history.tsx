'use client'

import React from 'react'
import { History, Loader2 } from 'lucide-react'
import type { EvalRunSummary } from '@/lib/supabase/types'

interface EvalRunHistoryProps {
  runs: EvalRunSummary[]
  activeRunId: string | null
  onSelectRun: (run: EvalRunSummary) => void
  loadingRunId: string | null
}

export function EvalRunHistory({ runs, activeRunId, onSelectRun, loadingRunId }: EvalRunHistoryProps) {
  if (runs.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-secondary text-muted-foreground">
          <History className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">No run history</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Runs will appear here after you execute evals.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 px-5 py-4">
      {runs.map((run) => {
        const isActive = activeRunId === run.id
        const isLoading = loadingRunId === run.id

        const passRateColor =
          run.passRate >= 0.8 ? 'text-[#085041]' :
          run.passRate >= 0.5 ? 'text-[#6C4B00]' :
          'text-[#791F1F]'

        return (
          <div
            key={run.id}
            className={`rounded-lg border bg-white p-4 transition-colors ${
              isActive ? 'border-l-2 border-l-[#1D9E75] border-[#9AD6C4] bg-[#E1F5EE]/30' : 'border-border hover:bg-secondary/50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={run.status} />
                <span className="text-xs font-medium text-foreground">
                  {formatDate(run.createdAt)}
                </span>
              </div>
              {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {run.passedCases}/{run.evaluatedCases} passed
              </span>
              <span>·</span>
              <span className={`font-mono font-semibold ${passRateColor}`}>
                {formatPercent(run.passRate)}
              </span>
              <span>·</span>
              <span>{run.skippedGrades} skipped grades</span>
            </div>
            <button
              type="button"
              className="mt-2 text-[11px] font-medium text-[#1D9E75] hover:text-[#0E7C5C]"
              onClick={() => onSelectRun(run)}
              disabled={isLoading}
            >
              View results
            </button>
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ status }: { status: EvalRunSummary['status'] }) {
  const styles = statusPillStyles(status)

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

function statusPillStyles(status: EvalRunSummary['status']) {
  if (status === 'passed') return 'border-[#9AD6C4] bg-[#E1F5EE] text-[#085041]'
  if (status === 'failed' || status === 'error') return 'border-[#F09595] bg-[#FCEBEB] text-[#791F1F]'
  return 'border-border bg-secondary text-muted-foreground'
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

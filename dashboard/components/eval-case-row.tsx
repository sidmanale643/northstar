'use client'

import React, { useState } from 'react'
import { ChevronDown, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { CasePayload, GradePayload } from '@/lib/eval-types'
import type { Json } from '@/lib/supabase/types'

interface EvalCaseRowProps {
  caseResult: CasePayload
}

export function EvalCaseRow({ caseResult }: EvalCaseRowProps) {
  const [expanded, setExpanded] = useState(false)
  
  const validGrades = caseResult.grades.filter(g => !g.reason?.includes('was not provided.'))
  
  const totalGrades = validGrades.length
  const passedGrades = validGrades.filter(g => g.status === 'passed').length
  const failedGrades = validGrades.filter(g => g.status === 'failed')
  const hasFailures = failedGrades.length > 0

  return (
    <div className={`overflow-hidden rounded-xl border bg-background shadow-sm transition-all duration-200 ${
      expanded ? 'border-primary/20 ring-4 ring-primary/5' : 'border-border hover:border-border/80 hover:shadow-md'
    }`}>
      <button
        type="button"
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-secondary/40 focus:outline-none"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform duration-300 ${
          expanded ? 'rotate-180 bg-secondary' : 'bg-secondary/50'
        }`}>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className="truncate font-mono text-sm font-bold text-foreground" title={caseResult.caseId}>
              {caseResult.caseId}
            </div>
            <CaseStatusPill status={caseResult.status} />
          </div>
          
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {hasFailures ? (
              <div className="flex items-center gap-2">
                <span className="font-medium text-[#791F1F] flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {failedGrades.length} failed
                </span>
                <span className="opacity-50">•</span>
                <span className="flex items-center gap-1.5 flex-wrap">
                  {failedGrades.slice(0, 3).map(g => (
                    <span key={g.name} className="font-mono text-[10px] bg-[#FCEBEB] text-[#791F1F] px-1.5 py-0.5 rounded">
                      {g.name}
                    </span>
                  ))}
                  {failedGrades.length > 3 && <span className="text-[10px]">+{failedGrades.length - 3} more</span>}
                </span>
              </div>
            ) : (
              <span className="flex items-center gap-1 text-[#085041] font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All {totalGrades} grades passed
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-[#F8FAFC]/50 px-4 py-5 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {validGrades.map((grade) => (
              <GradeCard key={`${caseResult.caseId}-${grade.name}`} grade={grade} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GradeCard({ grade }: { grade: GradePayload }) {
  const isPass = grade.status === 'passed'
  const isFail = grade.status === 'failed'
  
  const bgClass = isPass ? 'bg-white border-[#E1F5EE]' : isFail ? 'bg-white border-[#FCEBEB]' : 'bg-white border-border'
  const headerBgClass = isPass ? 'bg-[#F4FBF8]' : isFail ? 'bg-[#FEF6F6]' : 'bg-secondary/50'

  return (
    <div className={`flex flex-col rounded-xl border ${bgClass} shadow-sm overflow-hidden transition-all hover:shadow-md`}>
      <div className={`flex items-center justify-between gap-3 px-4 py-3 border-b border-border/50 ${headerBgClass}`}>
        <div className="flex items-center gap-2 min-w-0">
          <GradeChip grade={grade} />
        </div>
        <GradeMetrics grade={grade} />
      </div>
      
      <div className="flex-1 p-4 space-y-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Reasoning</div>
          <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
            {grade.reason || <span className="italic text-muted-foreground">No reasoning provided</span>}
          </div>
        </div>
        
        {grade.feedback && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Feedback</div>
            <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 text-sm leading-relaxed text-amber-900">
              {grade.feedback}
            </div>
          </div>
        )}
        
        {grade.evidence.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Evidence</div>
            <div className="space-y-2">
              {grade.evidence.map((item, index) => (
                <div
                  key={`${grade.name}-evidence-${index}`}
                  className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap break-all"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        <TraceMetadata grade={grade} />
      </div>
    </div>
  )
}

function TraceMetadata({ grade }: { grade: GradePayload }) {
  const entries = traceMetadataEntries(grade)
  if (entries.length === 0) return null

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Trace metadata</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((entry) => (
          <div key={entry.label} className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{entry.label}</div>
            <div className="mt-1 break-all font-mono text-[11px] leading-relaxed text-foreground">{entry.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CaseStatusPill({ status }: { status: CasePayload['status'] }) {
  const className = caseStatusPillClassName(status)

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
      {status}
    </span>
  )
}

export function GradeChip({ grade }: { grade: GradePayload }) {
  const styles = gradeChipStyles(grade.status)

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs font-medium ${styles.className}`}>
      <span aria-hidden="true" className={grade.status === 'passed' ? 'text-[#085041]' : grade.status === 'failed' ? 'text-[#791F1F]' : ''}>
        {styles.symbol}
      </span>
      {grade.name}
      {grade.label && <span className="text-[10px] opacity-70 ml-1 rounded-full bg-black/5 px-1.5 py-0.5"> {grade.label}</span>}
    </span>
  )
}

export function GradeMetrics({ grade }: { grade: GradePayload }) {
  const scoreText = scoreDisplay(grade)
  const confidenceText = grade.confidence === null ? null : `conf: ${formatDecimal(grade.confidence)}`
  const values = [scoreText, confidenceText].filter((value): value is string => value !== null)
  if (values.length === 0) return null

  return (
    <div className="flex shrink-0 gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex items-center rounded-md border border-border bg-white px-2 py-1 font-mono text-[10px] font-semibold text-muted-foreground shadow-sm"
        >
          {value}
        </span>
      ))}
    </div>
  )
}

function caseStatusPillClassName(status: CasePayload['status']) {
  if (status === 'passed') return 'border-[#9AD6C4] bg-[#E1F5EE] text-[#085041]'
  if (status === 'failed') return 'border-[#F09595] bg-[#FCEBEB] text-[#791F1F]'
  return 'border-border bg-secondary text-muted-foreground'
}

function gradeChipStyles(status: GradePayload['status']) {
  if (status === 'passed') {
    return {
      symbol: <CheckCircle2 className="h-3.5 w-3.5" />,
      className: 'border-[#9AD6C4] bg-[#E1F5EE]/50 text-[#085041]',
    }
  }
  if (status === 'failed') {
    return {
      symbol: <AlertCircle className="h-3.5 w-3.5" />,
      className: 'border-[#F09595] bg-[#FCEBEB]/50 text-[#791F1F]',
    }
  }
  return {
    symbol: '−',
    className: 'border-border bg-background text-muted-foreground',
  }
}

function traceMetadataEntries(grade: GradePayload): Array<{ label: string; value: string }> {
  const metadata = grade.metadata
  if (!isRecord(metadata)) return []

  const entries: Array<{ label: string; value: string }> = []
  addEntry(entries, 'failing spans', metadata.failing_span_ids)
  addEntry(entries, 'failing events', metadata.failing_event_ids)
  addEntry(entries, 'failed tools', metadata.failed_tools)
  addEntry(entries, 'failure origin', metadata.failure_origin_span)
  addEntry(entries, 'loop signatures', metadata.loop_signatures)
  addEntry(entries, 'retrieval', retrievalSummary(metadata))
  addEntry(entries, 'step costs', stepCostSummary(metadata))
  addEntry(entries, 'total cost', metadata.total_cost_usd)
  return entries
}

function addEntry(
  entries: Array<{ label: string; value: string }>,
  label: string,
  value: unknown
) {
  const text = metadataValueText(value)
  if (text) entries.push({ label, value: text })
}

function retrievalSummary(metadata: Record<string, unknown>): string | null {
  if (typeof metadata.precision !== 'number' && typeof metadata.recall !== 'number') return null
  return `precision ${metadata.precision ?? 'n/a'}, recall ${metadata.recall ?? 'n/a'}, tp ${metadata.true_positive_count ?? 0}/${metadata.relevant_count ?? 0}, retrieved ${metadata.retrieved_count ?? 0}`
}

function stepCostSummary(metadata: Record<string, unknown>): string | null {
  const costs = metadata.step_costs
  if (!Array.isArray(costs) || costs.length === 0) return null
  return `${costs.length} steps`
}

function metadataValueText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return value.map((item) => metadataValueText(item) ?? JSON.stringify(item)).join(', ')
  }
  if (isRecord(value)) {
    const id = value.id
    const name = value.name
    if (typeof id === 'string' && typeof name === 'string') return `${name} (${id})`
    return JSON.stringify(value)
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scoreDisplay(grade: GradePayload) {
  if (grade.score === null) return null

  const rawScore = rawScoreDisplay(grade.metadata)
  const threshold = grade.threshold === null ? null : `pass ${formatDecimal(grade.threshold)}`
  if (rawScore) {
    return threshold ? `score: ${rawScore} · ${threshold}` : `score: ${rawScore}`
  }

  const normalized = `score: ${formatDecimal(grade.score)}`
  return threshold ? `${normalized} · ${threshold}` : normalized
}

function rawScoreDisplay(metadata: Json) {
  if (!isRecord(metadata) || typeof metadata.raw_score !== 'number') return null
  const scale = readNumericScale(metadata.scale)
  if (!scale) return formatDecimal(metadata.raw_score)
  return `${formatDecimal(metadata.raw_score)}/${formatDecimal(scale.max)}`
}

function readNumericScale(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number'
  ) {
    return null
  }
  return { min: value[0], max: value[1] }
}

function formatDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

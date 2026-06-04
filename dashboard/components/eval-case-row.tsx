'use client'

import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { CasePayload, GradePayload } from '@/lib/eval-types'
import type { Json } from '@/lib/supabase/types'

interface EvalCaseRowProps {
  caseResult: CasePayload
}

export function EvalCaseRow({ caseResult }: EvalCaseRowProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
        <div className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-foreground" title={caseResult.caseId}>
          {caseResult.caseId}
        </div>
        <CaseStatusPill status={caseResult.status} />
      </button>

      <div className="flex flex-wrap gap-1.5 border-t border-border bg-secondary px-3 py-2">
        {caseResult.grades.map((grade) => (
          <GradeChip key={`${caseResult.caseId}-${grade.name}-chip`} grade={grade} />
        ))}
      </div>

      {expanded && (
        <div className="border-t border-border bg-secondary px-3 py-3">
          <div className="grid gap-3">
            {caseResult.grades.map((grade) => (
              <div
                key={`${caseResult.caseId}-${grade.name}`}
                className="rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-[11px] text-foreground">{grade.name}</div>
                  <GradeChip grade={grade} />
                </div>
                <GradeMetrics grade={grade} />
                <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{grade.reason}</div>
                {grade.feedback && (
                  <div className="mt-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {grade.feedback}
                  </div>
                )}
                {grade.evidence.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {grade.evidence.map((item, index) => (
                      <div
                        key={`${grade.name}-evidence-${index}`}
                        className="rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function CaseStatusPill({ status }: { status: CasePayload['status'] }) {
  const className = caseStatusPillClassName(status)

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

export function GradeChip({ grade }: { grade: GradePayload }) {
  const styles = gradeChipStyles(grade.status)

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium leading-5 ${styles.className}`}>
      <span aria-hidden="true">{styles.symbol}</span>
      {grade.name}
      {grade.label && <span className="text-[10px] opacity-80">· {grade.label}</span>}
    </span>
  )
}

export function GradeMetrics({ grade }: { grade: GradePayload }) {
  const scoreText = scoreDisplay(grade)
  const confidenceText = grade.confidence === null ? null : `confidence ${formatDecimal(grade.confidence)}`
  const values = [scoreText, confidenceText].filter((value): value is string => value !== null)
  if (values.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-md border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
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
      symbol: '✓',
      className: 'border-[#9AD6C4] bg-[#E1F5EE] text-[#085041]',
    }
  }
  if (status === 'failed') {
    return {
      symbol: '×',
      className: 'border-[#F09595] bg-[#FCEBEB] text-[#791F1F]',
    }
  }
  return {
    symbol: '−',
    className: 'border-border bg-background text-muted-foreground',
  }
}

function scoreDisplay(grade: GradePayload) {
  if (grade.score === null) return null

  const rawScore = rawScoreDisplay(grade.metadata)
  const threshold = grade.threshold === null ? null : `pass ${formatDecimal(grade.threshold)}`
  if (rawScore) {
    return threshold ? `score ${rawScore} · ${threshold}` : `score ${rawScore}`
  }

  const normalized = `score ${formatDecimal(grade.score)}`
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

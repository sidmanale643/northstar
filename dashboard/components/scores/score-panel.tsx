'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScoreForm } from '@/components/scores/score-form'
import type { DashboardScore } from '@/lib/supabase/types'

interface ScorePanelProps {
  projectId: string
  traceId: string
}

const sourceStyles: Record<DashboardScore['source'], string> = {
  human: 'bg-emerald-500',
  auto: 'bg-violet-500',
  api: 'bg-zinc-400',
}

export function ScorePanel({ projectId, traceId }: ScorePanelProps) {
  const [scores, setScores] = useState<DashboardScore[]>([])
  const [isOpen, setIsOpen] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true

    async function loadScores() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const response = await fetch(`/api/projects/${projectId}/traces/${traceId}/scores`, {
          cache: 'no-store',
        })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(readApiError(body) ?? 'Unable to load scores')
        }
        if (!isCurrent) return
        setScores(readScores(body))
      } catch (error) {
        if (isCurrent) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load scores')
        }
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    loadScores()
    return () => {
      isCurrent = false
    }
  }, [projectId, traceId])

  const knownNames = useMemo(
    () => Array.from(new Set(scores.map((score) => score.name))).sort(),
    [scores]
  )

  function handleCreated(score: DashboardScore) {
    setScores((current) => [score, ...current.filter((item) => item.id !== score.id)])
    setIsAdding(false)
    setIsOpen(true)
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
      <div className="flex min-h-10 items-center border-b border-border/60 bg-secondary/40 px-3">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={isOpen}
        >
          {isOpen
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-[11px] font-semibold text-foreground">Scores</span>
          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {scores.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setIsOpen(true)
            setIsAdding((adding) => !adding)
          }}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label="Add score"
        >
          <Plus className="h-3 w-3" />
          Add score
        </button>
      </div>

      {isOpen && (
        <>
          <div className="divide-y divide-border/50">
            {isLoading && (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">Loading scores...</p>
            )}
            {!isLoading && loadError && (
              <p role="alert" className="px-3 py-3 text-[11px] text-destructive">{loadError}</p>
            )}
            {!isLoading && !loadError && scores.length === 0 && (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">No scores on this trace.</p>
            )}
            {!isLoading && scores.map((score) => (
              <ScoreRow key={score.id} score={score} />
            ))}
          </div>

          {isAdding && (
            <ScoreForm
              projectId={projectId}
              traceId={traceId}
              knownNames={knownNames}
              onCreated={handleCreated}
              onCancel={() => setIsAdding(false)}
            />
          )}
        </>
      )}
    </section>
  )
}

function ScoreRow({ score }: { score: DashboardScore }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', sourceStyles[score.source])} />
        <span className="truncate text-[12px] font-medium text-foreground">{score.name}</span>
        <span className="rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
          {formatScoreValue(score)}
        </span>
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap text-[10.5px] text-muted-foreground">
        <span className="capitalize">{score.source}</span>
        <time dateTime={score.created_at}>{formatScoreTime(score.created_at)}</time>
      </div>
      {score.comment && (
        <p className="col-span-2 ml-4 break-words text-[11px] leading-relaxed text-muted-foreground">
          {score.comment}
        </p>
      )}
    </div>
  )
}

function formatScoreValue(score: DashboardScore): string {
  if (score.data_type === 'categorical') return score.string_value ?? 'Unknown'
  if (score.data_type === 'boolean') return score.value === 1 ? 'Pass' : 'Fail'
  return Number.isInteger(score.value) ? String(score.value) : score.value.toFixed(3).replace(/0+$/, '')
}

function formatScoreTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return formatDistanceToNow(date, { addSuffix: true })
}

function readScores(value: unknown): DashboardScore[] {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.scores)
      ? value.scores
      : []
  return candidates.filter(isDashboardScore)
}

function readApiError(value: unknown): string | null {
  if (!isRecord(value) || typeof value.error !== 'string') return null
  return value.error
}

function isDashboardScore(value: unknown): value is DashboardScore {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.project_id === 'string' &&
    typeof value.trace_id === 'string' &&
    (value.span_id === null || typeof value.span_id === 'string') &&
    typeof value.name === 'string' &&
    typeof value.value === 'number' &&
    (value.data_type === 'numeric' || value.data_type === 'categorical' || value.data_type === 'boolean') &&
    (value.string_value === null || typeof value.string_value === 'string') &&
    (value.source === 'human' || value.source === 'api' || value.source === 'auto') &&
    (value.comment === null || typeof value.comment === 'string') &&
    (value.created_by === null || typeof value.created_by === 'string') &&
    typeof value.created_at === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

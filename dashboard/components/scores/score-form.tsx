'use client'

import { FormEvent, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DashboardScore, ScoreDataType } from '@/lib/supabase/types'

interface ScoreFormProps {
  projectId: string
  traceId: string
  knownNames: string[]
  onCreated: (score: DashboardScore) => void
  onCancel: () => void
}

export function ScoreForm({
  projectId,
  traceId,
  knownNames,
  onCreated,
  onCancel,
}: ScoreFormProps) {
  const [name, setName] = useState('')
  const [dataType, setDataType] = useState<ScoreDataType>('numeric')
  const [numericValue, setNumericValue] = useState('1')
  const [booleanValue, setBooleanValue] = useState(true)
  const [category, setCategory] = useState('')
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedCategory = category.trim()
    const value = dataType === 'numeric'
      ? Number(numericValue)
      : dataType === 'boolean'
        ? Number(booleanValue)
        : 0

    if (!trimmedName) {
      setError('Score name is required.')
      return
    }
    if (dataType === 'numeric' && !Number.isFinite(value)) {
      setError('Enter a valid numeric value.')
      return
    }
    if (dataType === 'categorical' && !trimmedCategory) {
      setError('Category is required.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traceId,
          spanId: null,
          name: trimmedName,
          value,
          dataType,
          stringValue: dataType === 'categorical' ? trimmedCategory : null,
          comment: comment.trim() || null,
        }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(readApiError(body) ?? 'Unable to add score')
      }

      const score = readCreatedScore(body)
      if (!score) {
        throw new Error('The score API returned an invalid response.')
      }
      onCreated(score)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to add score')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border/60 bg-secondary/20 p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
        <label className="min-w-0">
          <span className="mb-1 block text-[10.5px] font-medium text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            list="trace-score-names"
            placeholder="correctness"
            className="ns-input h-8 w-full text-[12px]"
            disabled={isSubmitting}
            autoFocus
          />
          <datalist id="trace-score-names">
            {knownNames.map((knownName) => <option key={knownName} value={knownName} />)}
          </datalist>
        </label>

        <label>
          <span className="mb-1 block text-[10.5px] font-medium text-muted-foreground">Type</span>
          <select
            value={dataType}
            onChange={(event) => {
              const nextDataType = event.currentTarget.value
              if (isScoreDataType(nextDataType)) setDataType(nextDataType)
            }}
            className="ns-input h-8 w-full text-[12px]"
            disabled={isSubmitting}
          >
            <option value="numeric">Numeric</option>
            <option value="boolean">Boolean</option>
            <option value="categorical">Category</option>
          </select>
        </label>
      </div>

      <div className="mt-2">
        <span className="mb-1 block text-[10.5px] font-medium text-muted-foreground">Value</span>
        {dataType === 'numeric' && (
          <input
            type="number"
            step="any"
            value={numericValue}
            onChange={(event) => setNumericValue(event.currentTarget.value)}
            className="ns-input h-8 w-full text-[12px]"
            disabled={isSubmitting}
          />
        )}
        {dataType === 'categorical' && (
          <input
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value)}
            placeholder="approved"
            className="ns-input h-8 w-full text-[12px]"
            disabled={isSubmitting}
          />
        )}
        {dataType === 'boolean' && (
          <div className="grid h-8 grid-cols-2 rounded-md border border-border bg-background p-0.5">
            {[true, false].map((option) => (
              <button
                key={String(option)}
                type="button"
                onClick={() => setBooleanValue(option)}
                className={cn(
                  'rounded text-[11px] font-medium transition-colors',
                  booleanValue === option
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                disabled={isSubmitting}
              >
                {option ? 'Pass' : 'Fail'}
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="mt-2 block">
        <span className="mb-1 block text-[10.5px] font-medium text-muted-foreground">Comment</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.currentTarget.value)}
          placeholder="Optional review note"
          rows={2}
          className="ns-input min-h-16 w-full resize-y py-2 text-[12px]"
          disabled={isSubmitting}
        />
      </label>

      {error && <p role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>}

      <div className="mt-3 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="h-7 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="ns-button !h-7 !px-3 !text-[11px] disabled:opacity-60"
          disabled={isSubmitting}
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {isSubmitting ? 'Saving...' : 'Save score'}
        </button>
      </div>
    </form>
  )
}

function readCreatedScore(value: unknown): DashboardScore | null {
  if (isDashboardScore(value)) return value
  if (!isRecord(value) || !('score' in value)) return null
  return isDashboardScore(value.score) ? value.score : null
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
    isScoreDataType(value.data_type) &&
    (value.string_value === null || typeof value.string_value === 'string') &&
    isScoreSource(value.source) &&
    (value.comment === null || typeof value.comment === 'string') &&
    (value.created_by === null || typeof value.created_by === 'string') &&
    typeof value.created_at === 'string'
  )
}

function isScoreDataType(value: unknown): value is ScoreDataType {
  return value === 'numeric' || value === 'categorical' || value === 'boolean'
}

function isScoreSource(value: unknown): value is DashboardScore['source'] {
  return value === 'human' || value === 'api' || value === 'auto'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

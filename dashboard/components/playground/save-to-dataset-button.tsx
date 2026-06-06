'use client'

import { useEffect, useRef, useState } from 'react'
import { Database, Check, X } from 'lucide-react'
import type { EvalDatasetSummary } from '@/lib/supabase/types'

interface SaveToDatasetButtonProps {
  projectId: string
  userInput: string
  assistantOutput: string
  disabled: boolean
}

export function SaveToDatasetButton({
  projectId,
  userInput,
  assistantOutput,
  disabled,
}: SaveToDatasetButtonProps) {
  const [open, setOpen] = useState(false)
  const [datasets, setDatasets] = useState<EvalDatasetSummary[]>([])
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setSubmitError(null)
    setSuccess(null)

    let isCurrent = true
    async function load() {
      setIsLoadingDatasets(true)
      setLoadError(null)
      try {
        const response = await fetch(`/api/projects/${projectId}/eval-datasets`, {
          cache: 'no-store',
        })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(
            typeof body === 'object' && body && 'error' in body
              ? String((body as { error: unknown }).error)
              : 'Unable to load datasets'
          )
        }
        if (!isCurrent) return
        const list = isEvalDatasetsResponse(body) ? body.datasets : []
        setDatasets(list)
        if (list.length > 0 && !list.some((d) => d.id === selectedDatasetId)) {
          setSelectedDatasetId(list[0].id)
        }
      } catch (err) {
        if (isCurrent) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load datasets')
        }
      } finally {
        if (isCurrent) setIsLoadingDatasets(false)
      }
    }
    load()
    return () => {
      isCurrent = false
    }
  }, [open, projectId, selectedDatasetId])

  useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  async function handleSubmit() {
    if (!selectedDatasetId) {
      setSubmitError('Pick a dataset to save this output to.')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    setSuccess(null)

    const casePayload: Record<string, unknown> = {}
    if (userInput) casePayload.input = userInput
    if (assistantOutput) casePayload.expected = assistantOutput

    try {
      const response = await fetch(
        `/api/projects/${projectId}/eval-datasets/${selectedDatasetId}/cases`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ case: casePayload }),
        }
      )
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          typeof body === 'object' && body && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'Unable to save to dataset'
        )
      }
      const datasetName = datasets.find((d) => d.id === selectedDatasetId)?.name ?? 'dataset'
      setSuccess(`Saved to "${datasetName}".`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to save to dataset')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="ns-button !h-7 !px-2.5 !text-[11px]"
        title={disabled ? 'Run the prompt first to save the output' : 'Save to dataset'}
      >
        <Database className="w-3 h-3" /> Save to dataset
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-80 rounded-md border border-border bg-background p-3 shadow-lg">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Save output to dataset
          </div>

          <label className="mb-2 block">
            <span className="mb-1 block text-[10.5px] font-medium text-muted-foreground">Dataset</span>
            <select
              className="ns-input h-8 w-full text-[12px]"
              value={selectedDatasetId}
              onChange={(event) => setSelectedDatasetId(event.currentTarget.value)}
              disabled={isLoadingDatasets || isSubmitting}
            >
              {isLoadingDatasets ? (
                <option value="">Loading...</option>
              ) : datasets.length === 0 ? (
                <option value="">No datasets yet</option>
              ) : (
                datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name} ({dataset.caseCount ?? 0} cases)
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="mb-3 rounded-md border border-border/60 bg-secondary/30 p-2 text-[11px] text-muted-foreground">
            <div className="mb-0.5 font-medium text-foreground/80">Case preview</div>
            <div>input{userInput ? `: ${truncate(userInput, 60)}` : ': (empty)'}</div>
            <div>expected{assistantOutput ? `: ${truncate(assistantOutput, 60)}` : ': (empty)'}</div>
          </div>

          {loadError && (
            <div className="mb-2 text-[11px] text-destructive">{loadError}</div>
          )}
          {submitError && (
            <div className="mb-2 text-[11px] text-destructive">{submitError}</div>
          )}
          {success && (
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-600">
              <Check className="h-3 w-3" /> {success}
            </div>
          )}

          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-7 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              disabled={isSubmitting}
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || isLoadingDatasets || datasets.length === 0}
              className="ns-button ns-button-primary !h-7 !px-3 !text-[11px] disabled:opacity-60"
            >
              {isSubmitting ? 'Saving...' : 'Save case'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}...`
}

function isEvalDatasetsResponse(value: unknown): value is { datasets: EvalDatasetSummary[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'datasets' in value &&
    Array.isArray((value as { datasets: unknown }).datasets)
  )
}

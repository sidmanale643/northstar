'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DashboardPrompt, DashboardPromptVersion, Json } from '@/lib/supabase/types'

export interface PromoteLabelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  promptId: string
  prompt: DashboardPrompt
  targetVersion: DashboardPromptVersion
  defaultLabel?: string
  onSuccess?: () => void
}

interface CurrentLabelState {
  versionId: string
  versionNumber: number | null
  contentHash: string | null
}

export function PromoteLabelDialog({
  open,
  onOpenChange,
  projectId,
  promptId,
  prompt,
  targetVersion,
  defaultLabel = 'prod',
  onSuccess,
}: PromoteLabelDialogProps) {
  const [label, setLabel] = useState<string>(defaultLabel)
  const [changeNote, setChangeNote] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setLabel(defaultLabel)
      setChangeNote('')
      setSubmitError(null)
    }
  }, [open, defaultLabel, targetVersion.id])

  useEffect(() => {
    if (!open) return
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!isSubmitting) onOpenChange(false)
      }
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [open, isSubmitting, onOpenChange])

  if (!open) return null

  const current = resolveCurrentLabel(prompt, label)
  const trimmedLabel = label.trim()
  const trimmedNote = changeNote.trim()
  const requiresChangeNote = trimmedLabel === 'prod'
  const labelIsValid = trimmedLabel.length > 0
  const canSubmit =
    !isSubmitting && labelIsValid && targetVersion != null && (!requiresChangeNote || trimmedNote.length > 0)

  async function handleSubmit() {
    if (!canSubmit) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/prompts/${promptId}/labels/${encodeURIComponent(trimmedLabel)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId: targetVersion.id, changeNote: trimmedNote || null }),
        }
      )
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = extractApiError(body) ?? 'Unable to promote version.'
        setSubmitError(message)
        return
      }
      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to promote version.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#18352d]/25 px-4 ns-backdrop-enter"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onOpenChange(false)
      }}
    >
      <section
        aria-labelledby="promote-label-title"
        aria-modal="true"
        className="ns-panel ns-dialog-enter w-full max-w-md p-5 shadow-[0_20px_60px_rgb(24_53_45_/_0.18)]"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="ns-label">Promote version</div>
            <h2 id="promote-label-title" className="mt-0.5 truncate text-sm font-semibold text-foreground">
              {prompt.name}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Move a label to a new version. Prod labels require a change note.
            </p>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
            aria-label="Close promote dialog"
            disabled={isSubmitting}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="ns-label" htmlFor="promote-label-input">
              Target label
            </label>
            <input
              id="promote-label-input"
              className="ns-input mt-1 h-9"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              spellCheck={false}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border/60 bg-secondary/30 p-2.5">
              <div className="ns-label">Current at &quot;{trimmedLabel || 'label'}&quot;</div>
              <div className="mt-1 text-[12px] text-foreground">
                {current ? (
                  <>
                    <div className="font-mono">v{current.versionNumber ?? '?'}</div>
                    {current.contentHash && (
                      <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                        {current.contentHash.slice(0, 12)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[12px] text-muted-foreground">No version on this label yet</div>
                )}
              </div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5">
              <div className="ns-label">New version</div>
              <div className="mt-1 text-[12px] text-foreground">
                <div className="font-mono">v{targetVersion.version_number}</div>
                {targetVersion.content_hash && (
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                    {targetVersion.content_hash.slice(0, 12)}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="ns-label" htmlFor="promote-change-note">
              Change note {requiresChangeNote ? <span className="text-rose-600">*</span> : null}
            </label>
            <textarea
              id="promote-change-note"
              className="mt-1 block h-20 w-full rounded-md border bg-white px-2.5 py-1.5 text-xs text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-emerald-100"
              value={changeNote}
              onChange={(event) => setChangeNote(event.currentTarget.value)}
              placeholder={
                requiresChangeNote
                  ? 'Required for prod — describe what is changing and why.'
                  : 'Optional summary of the change.'
              }
              disabled={isSubmitting}
            />
            {requiresChangeNote && trimmedNote.length === 0 && (
              <div className="mt-1 text-[10.5px] text-rose-600">
                A change note is required for the prod label.
              </div>
            )}
          </div>

          {submitError && (
            <div
              role="alert"
              className={cn(
                'flex items-start gap-2 rounded-md border px-3 py-2 text-[11.5px]',
                'border-[#F09595] bg-[#FCEBEB] text-[#791F1F]'
              )}
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            className="ns-button"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ns-button ns-button-primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isSubmitting ? 'Promoting…' : 'Promote version'}
          </button>
        </div>
      </section>
    </div>
  )
}

function resolveCurrentLabel(prompt: DashboardPrompt, label: string): CurrentLabelState | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  const labels = readLabelsRecord(prompt.labels)
  const versionId = labels[trimmed]
  if (!versionId) return null
  return {
    versionId,
    versionNumber: null,
    contentHash: null,
  }
}

function readLabelsRecord(value: Json): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, Json | undefined>)) {
    if (typeof raw === 'string' && raw.length > 0) {
      out[key] = raw
    }
  }
  return out
}

function extractApiError(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = (value as { error?: unknown }).error
  if (typeof candidate === 'string' && candidate.length > 0) return candidate
  return null
}

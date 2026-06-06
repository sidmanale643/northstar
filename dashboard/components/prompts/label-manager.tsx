'use client'

import { useState } from 'react'
import { AlertCircle, Loader2, Plus, Tag, X } from 'lucide-react'
import type { DashboardPrompt, DashboardPromptVersion, Json } from '@/lib/supabase/types'

interface LabelManagerProps {
  prompt: DashboardPrompt
  versions: DashboardPromptVersion[]
  onChange: () => void
}

export function LabelManager({ prompt, versions, onChange }: LabelManagerProps) {
  const [labelInput, setLabelInput] = useState('prod')
  const [versionId, setVersionId] = useState<string>(prompt.current_version_id ?? '')
  const [changeNote, setChangeNote] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const labelEntries = readLabelEntries(prompt.labels)

  async function handlePromote(event: React.FormEvent) {
    event.preventDefault()
    setSubmitError(null)
    const label = labelInput.trim()
    if (!label) {
      setSubmitError('Label is required.')
      return
    }
    if (!versionId) {
      setSubmitError('Pick a version to promote.')
      return
    }
    if (label === 'prod' && !changeNote.trim()) {
      setSubmitError('A change note is required for the prod label.')
      return
    }
    setIsSubmitting(true)
    try {
      const response = await fetch(
        `/api/projects/${prompt.project_id}/prompts/${prompt.id}/labels/${encodeURIComponent(label)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            versionId,
            changeNote: changeNote.trim() ? changeNote.trim() : null,
          }),
        }
      )
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(readApiError(body))
      }
      setChangeNote('')
      onChange()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to set label.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="ns-label">Current labels</div>
        {labelEntries.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">No labels set yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border/60 bg-white">
            {labelEntries.map(({ label, versionId: pointingVersionId }) => {
              const target = versions.find((v) => v.id === pointingVersionId)
              return (
                <li key={label} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono font-medium text-foreground">{label}</span>
                    <span className="text-muted-foreground">→</span>
                    {target ? (
                      <span className="font-mono text-foreground">v{target.version_number}</span>
                    ) : (
                      <span className="font-mono text-muted-foreground">unknown</span>
                    )}
                    {pointingVersionId === prompt.current_version_id ? (
                      <span className="ns-pill text-[#0E7C5C]">current</span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <form onSubmit={handlePromote} className="space-y-3 rounded-md border border-dashed border-border bg-secondary/30 p-3">
        <div className="ns-label">Promote version to label</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="ns-label" htmlFor="label-input">Label</label>
            <input
              id="label-input"
              value={labelInput}
              onChange={(event) => setLabelInput(event.target.value)}
              className="ns-input mt-1 h-9 w-full"
              placeholder="prod"
              disabled={isSubmitting}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="ns-label" htmlFor="label-version">Version</label>
            <select
              id="label-version"
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
              className="ns-input mt-1 h-9 w-full"
              disabled={isSubmitting || versions.length === 0}
            >
              {versions.length === 0 ? (
                <option value="">No versions yet</option>
              ) : (
                versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version_number} · {v.id.slice(0, 8)}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div>
          <label className="ns-label" htmlFor="label-change-note">
            Change note {labelInput.trim() === 'prod' ? <span className="text-[#791F1F]">*</span> : '(optional)'}
          </label>
          <input
            id="label-change-note"
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
            className="ns-input mt-1 h-9 w-full"
            placeholder="Why is this version being promoted?"
            disabled={isSubmitting}
          />
        </div>

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-[#F09595] bg-[#FCEBEB] px-3 py-2 text-[12px] text-[#791F1F]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {submitError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="submit"
            className="ns-button ns-button-primary h-8"
            disabled={isSubmitting || versions.length === 0}
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {isSubmitting ? 'Promoting…' : 'Promote'}
          </button>
        </div>
      </form>
    </div>
  )
}

function readLabelEntries(labels: Json): { label: string; versionId: string }[] {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return []
  return Object.entries(labels as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([label, versionId]) => ({ label, versionId }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function readApiError(value: unknown) {
  if (value && typeof value === 'object' && 'error' in value) {
    const candidate = (value as { error: unknown }).error
    if (typeof candidate === 'string') return candidate
  }
  return 'Unexpected server response.'
}

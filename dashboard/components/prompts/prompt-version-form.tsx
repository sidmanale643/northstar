'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { Json } from '@/lib/supabase/types'

const MAX_PROMPT_CONTENT_BYTES = 64 * 1024

const JINJA_VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
const PYTHON_VARIABLE_RE = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g

interface PromptVersionFormProps {
  projectId: string
  promptId: string
  onCreated: () => void
}

export function PromptVersionForm({ projectId, promptId, onCreated }: PromptVersionFormProps) {
  const [content, setContent] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [extraVariables, setExtraVariables] = useState<string[]>([])
  const [removedVariables, setRemovedVariables] = useState<string[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const detectedVariables = useMemo(() => extractVariables(content), [content])
  const variablesList = useMemo(() => {
    const removed = new Set(removedVariables)
    return Array.from(new Set([...detectedVariables, ...extraVariables])).filter((name) => !removed.has(name))
  }, [detectedVariables, extraVariables, removedVariables])

  const contentBytes = useMemo(() => new TextEncoder().encode(content).byteLength, [content])
  const contentOverLimit = contentBytes > MAX_PROMPT_CONTENT_BYTES

  const validationError = (() => {
    if (!content.trim()) return 'Content is required.'
    if (contentOverLimit) return `Content must be 64 KB or smaller (${(contentBytes / 1024).toFixed(1)} KB).`
    if (!changeNote.trim()) return 'Change note is required.'
    const tempValue = parseOptionalNumber(temperature)
    if (temperature.trim() && (tempValue === null || tempValue < 0 || tempValue > 2)) {
      return 'Temperature must be between 0 and 2.'
    }
    const tokensValue = parseOptionalInteger(maxTokens)
    if (maxTokens.trim() && (tokensValue === null || tokensValue <= 0)) {
      return 'Max tokens must be a positive integer.'
    }
    return null
  })()

  function addExtraVariable() {
    setExtraVariables((current) => [...current, ''])
  }

  function updateExtraVariable(index: number, value: string) {
    setExtraVariables((current) => current.map((entry, i) => (i === index ? value : entry)))
  }

  function removeVariable(name: string) {
    if (detectedVariables.includes(name) && !extraVariables.includes(name)) {
      setRemovedVariables((current) => Array.from(new Set([...current, name])))
    } else {
      setExtraVariables((current) => current.filter((entry) => entry !== name))
    }
  }

  function reset() {
    setContent('')
    setModel('')
    setTemperature('')
    setMaxTokens('')
    setChangeNote('')
    setExtraVariables([])
    setRemovedVariables([])
    setSubmitError(null)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (validationError) {
      setSubmitError(validationError)
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)
    const variablesPayload: Json = variablesList.map((name) => ({
      name,
      type: 'string',
      required: true,
      default: null,
    }))
    try {
      const response = await fetch(`/api/projects/${projectId}/prompts/${promptId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          model: model.trim() ? model.trim() : null,
          temperature: temperature.trim() ? Number(temperature) : null,
          maxTokens: maxTokens.trim() ? Number(maxTokens) : null,
          variables: variablesPayload,
          changeNote: changeNote.trim() ? changeNote.trim() : null,
        }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(readApiError(body))
      }
      reset()
      onCreated()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to create version.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="ns-label" htmlFor="version-content">Content</label>
        <textarea
          id="version-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="mt-1 block w-full rounded-md border bg-white px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-emerald-100"
          rows={8}
          placeholder="You are a helpful assistant for {{ persona }}. Answer the user question: {user_input}"
          disabled={isSubmitting}
          spellCheck={false}
        />
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Use <span className="font-mono">{`{{ var }}`}</span> for Jinja or <span className="font-mono">{`{var}`}</span> for Python style. Variables are auto-detected.
          </span>
          <span className={contentOverLimit ? 'text-[#791F1F]' : ''}>
            {(contentBytes / 1024).toFixed(1)} / 64 KB
          </span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="ns-label">Variables</span>
          <button
            type="button"
            onClick={addExtraVariable}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-white px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            disabled={isSubmitting}
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {variablesList.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">No variables detected.</span>
          ) : (
            variablesList.map((name) => {
              const isExtra = extraVariables.includes(name) && !detectedVariables.includes(name)
              return isExtra ? (
                <span key={`extra-${name}`} className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 font-mono text-[10.5px] text-foreground">
                  <input
                    value={name}
                    onChange={(event) => updateExtraVariable(extraVariables.indexOf(name), event.target.value)}
                    className="w-24 border-none bg-transparent font-mono text-[10.5px] outline-none"
                    disabled={isSubmitting}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => removeVariable(name)}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                    disabled={isSubmitting}
                    aria-label={`Remove ${name}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ) : (
                <span key={`detected-${name}`} className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 font-mono text-[10.5px] text-foreground">
                  {name}
                  <button
                    type="button"
                    onClick={() => removeVariable(name)}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                    disabled={isSubmitting}
                    aria-label={`Remove ${name}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )
            })
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="ns-label" htmlFor="version-model">Model</label>
          <input
            id="version-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="ns-input mt-1 h-9 w-full"
            placeholder="gpt-4o"
            disabled={isSubmitting}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="ns-label" htmlFor="version-temperature">Temperature</label>
          <input
            id="version-temperature"
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
            className="ns-input mt-1 h-9 w-full"
            placeholder="0.2"
            inputMode="decimal"
            disabled={isSubmitting}
          />
        </div>
        <div>
          <label className="ns-label" htmlFor="version-max-tokens">Max tokens</label>
          <input
            id="version-max-tokens"
            value={maxTokens}
            onChange={(event) => setMaxTokens(event.target.value)}
            className="ns-input mt-1 h-9 w-full"
            placeholder="1024"
            inputMode="numeric"
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div>
        <label className="ns-label" htmlFor="version-change-note">Change note</label>
        <input
          id="version-change-note"
          value={changeNote}
          onChange={(event) => setChangeNote(event.target.value)}
          className="ns-input mt-1 h-9 w-full"
          placeholder="What changed in this version?"
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
          type="button"
          onClick={reset}
          className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          disabled={isSubmitting}
        >
          Reset
        </button>
        <button
          type="submit"
          className="ns-button ns-button-primary h-8"
          disabled={isSubmitting || Boolean(validationError)}
        >
          {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {isSubmitting ? 'Creating…' : 'Create version'}
        </button>
      </div>
    </form>
  )
}

function extractVariables(template: string) {
  const names = new Set<string>()
  for (const match of template.matchAll(JINJA_VARIABLE_RE)) {
    if (match[1]) names.add(match[1])
  }
  for (const match of template.matchAll(PYTHON_VARIABLE_RE)) {
    if (match[1]) names.add(match[1])
  }
  return Array.from(names).sort()
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseOptionalInteger(value: string) {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

function readApiError(value: unknown) {
  if (value && typeof value === 'object' && 'error' in value) {
    const candidate = (value as { error: unknown }).error
    if (typeof candidate === 'string') return candidate
  }
  return 'Unexpected server response.'
}

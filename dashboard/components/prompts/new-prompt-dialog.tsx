'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, BookText, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface NewPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function NewPromptDialog({ open, onOpenChange, projectId }: NewPromptDialogProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setName('')
      setSlug('')
      setSlugTouched(false)
      setDescription('')
      setSubmitError(null)
      setIsSubmitting(false)
      return
    }
    const t = window.setTimeout(() => nameInputRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, isSubmitting, onOpenChange])

  if (!open) return null

  const trimmedName = name.trim()
  const trimmedSlug = slug.trim()
  const validationError = (() => {
    if (!trimmedName) return 'Name is required.'
    if (!trimmedSlug) return 'Slug is required.'
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(trimmedSlug)) {
      return 'Slug must be lowercase, alphanumeric, and dash-separated.'
    }
    return null
  })()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (validationError) {
      setSubmitError(validationError)
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          slug: trimmedSlug,
          description: description.trim() ? description.trim() : null,
        }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(readApiError(body))
      }
      const prompt = parsePromptResponse(body)
      if (!prompt) throw new Error('The server returned an invalid prompt.')
      onOpenChange(false)
      router.push(`/projects/${projectId}/prompts/${prompt.id}`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to create prompt.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Create new prompt">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => (isSubmitting ? undefined : onOpenChange(false))}
        className="ns-backdrop-enter flex-1 cursor-default bg-black/30"
      />
      <div className="ns-dialog-enter relative flex h-full w-full max-w-[520px] flex-col border-l border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <BookText className="h-5 w-5 text-[#1D9E75]" />
              New prompt
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Prompts are versioned, slugs are immutable, and labels (like prod / staging) can be set on each version.
            </p>
          </div>
          <button
            type="button"
            onClick={() => (isSubmitting ? undefined : onOpenChange(false))}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div>
              <label className="ns-label" htmlFor="prompt-name">Name</label>
              <input
                id="prompt-name"
                ref={nameInputRef}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (!slugTouched) setSlug(slugify(event.target.value))
                }}
                className="ns-input mt-1 h-9 w-full"
                placeholder="Customer support agent"
                disabled={isSubmitting}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="ns-label" htmlFor="prompt-slug">Slug</label>
              <input
                id="prompt-slug"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value)
                  setSlugTouched(true)
                }}
                className="ns-input mt-1 h-9 w-full"
                placeholder="customer-support-agent"
                disabled={isSubmitting}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Used by the SDK: <span className="font-mono">client.pull_prompt(&quot;{trimmedSlug || 'slug'}&quot;)</span>
              </p>
            </div>

            <div>
              <label className="ns-label" htmlFor="prompt-description">Description (optional)</label>
              <textarea
                id="prompt-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-emerald-100"
                rows={3}
                placeholder="What this prompt is for, who maintains it, etc."
                disabled={isSubmitting}
              />
            </div>

            {submitError && (
              <div className="flex items-start gap-2 rounded-md border border-[#F09595] bg-[#FCEBEB] px-3 py-2 text-[12px] text-[#791F1F]">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {submitError}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-6 py-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="ns-button ns-button-primary h-8"
              disabled={isSubmitting || Boolean(validationError)}
            >
              {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookText className="h-3.5 w-3.5" />}
              {isSubmitting ? 'Creating…' : 'Create prompt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function readApiError(value: unknown) {
  if (value && typeof value === 'object' && 'error' in value) {
    const candidate = (value as { error: unknown }).error
    if (typeof candidate === 'string') return candidate
  }
  return 'Unexpected server response.'
}

function parsePromptResponse(value: unknown): { id: string } | null {
  if (!value || typeof value !== 'object') return null
  const prompt = (value as { prompt?: unknown }).prompt
  if (!prompt || typeof prompt !== 'object') return null
  const id = (prompt as { id?: unknown }).id
  if (typeof id !== 'string') return null
  return { id }
}

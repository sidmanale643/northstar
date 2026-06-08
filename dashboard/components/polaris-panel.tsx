'use client'

import { type FormEvent, useMemo, useState } from 'react'
import { AlertCircle, Bug, ListChecks, MessageSquareText, Send, Sparkles, Stars, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProjectId } from '@/lib/projects'

type PolarisScope = 'session' | 'trace'
type PolarisPreset = 'summary' | 'feedback' | 'errors' | 'next_steps'

type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; model: string }

const PRESETS: {
  id: PolarisPreset
  label: string
  icon: typeof Sparkles
  prompt: string
}[] = [
  {
    id: 'summary',
    label: 'Summarize',
    icon: Sparkles,
    prompt: 'Summarize this run.',
  },
  {
    id: 'feedback',
    label: 'Feedback',
    icon: MessageSquareText,
    prompt: 'Give feedback on the agent behavior.',
  },
  {
    id: 'errors',
    label: 'Find errors',
    icon: Bug,
    prompt: 'Find errors or failure signals.',
  },
  {
    id: 'next_steps',
    label: 'Next steps',
    icon: ListChecks,
    prompt: 'Suggest the next debugging steps.',
  },
]

export function PolarisPanel({
  projectId,
  scope,
  targetId,
}: {
  projectId: ProjectId
  scope: PolarisScope
  targetId: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scopeLabel = scope === 'session' ? 'session' : 'trace'

  async function submit(message: string, preset: PolarisPreset | null) {
    const trimmed = message.trim()
    if (!trimmed || isLoading) return

    setError(null)
    setIsLoading(true)
    setMessages((current) => [...current, { role: 'user', content: trimmed }])
    if (!preset) setDraft('')

    try {
      const response = await fetch(`/api/projects/${projectId}/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, targetId, message: trimmed, preset }),
      })
      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(readErrorMessage(payload) ?? 'Polaris could not answer this request.')
      }

      const answer = readAnswer(payload)
      if (!answer) throw new Error('Polaris returned an invalid response.')

      setMessages((current) => [
        ...current,
        { role: 'assistant', content: answer.content, model: answer.model },
      ])
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Polaris could not answer this request.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit(draft, null)
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          'group inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-left text-[12px] text-muted-foreground shadow-sm transition-colors',
          'hover:border-primary/30 hover:bg-primary/5 hover:text-foreground'
        )}
        aria-label={`Ask Polaris about this ${scopeLabel}`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Stars className="h-3 w-3" />
        </span>
        <span className="font-medium text-foreground">Polaris</span>
        <span className="hidden sm:inline">· ask about this {scopeLabel}</span>
        <span className="ml-1 text-primary opacity-0 transition-opacity group-hover:opacity-100">›</span>
      </button>
    )
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Stars className="h-3 w-3" />
          </span>
          <span className="truncate text-[12px] font-medium text-foreground">
            Polaris · {scopeLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close Polaris"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((preset) => {
            const Icon = preset.icon
            return (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={isLoading}
                onClick={() => void submit(preset.prompt, preset.id)}
              >
                <Icon className="h-3 w-3" />
                {preset.label}
              </Button>
            )
          })}
        </div>

        {messages.length > 0 && (
          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-[12px] leading-relaxed',
                  message.role === 'user'
                    ? 'ml-auto max-w-[88%] border-primary/20 bg-primary/5 text-foreground'
                    : 'mr-auto max-w-[92%] border-border bg-background text-foreground'
                )}
              >
                <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {message.role === 'user' ? 'You' : `Polaris · ${message.model}`}
                </div>
                <div className="whitespace-pre-wrap">{message.content}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 rounded-md border border-[#f0b8b8] bg-[#fcebeb] px-2.5 py-1.5 text-[11px] text-[#791f1f]">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex gap-1.5">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Ask about this ${scopeLabel}…`}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[12px] ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading}
          />
          <Button
            type="submit"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={isLoading || !draft.trim()}
            aria-label="Ask Polaris"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>
    </section>
  )
}

function readAnswer(value: unknown): { content: string; model: string } | null {
  if (!isRecord(value) || !isRecord(value.answer)) return null
  const content = value.answer.content
  const model = value.answer.model
  if (typeof content !== 'string' || typeof model !== 'string') return null
  return { content, model }
}

function readErrorMessage(value: unknown) {
  if (!isRecord(value)) return null
  const error = value.error
  if (typeof error === 'string') return error
  if (isRecord(error)) {
    const reason = typeof error.reason === 'string' ? error.reason : null
    const feedback = typeof error.feedback === 'string' ? error.feedback : null
    return [reason, feedback].filter(Boolean).join(' ')
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

'use client'

import { type FormEvent, useMemo, useState } from 'react'
import { AlertCircle, Bug, ListChecks, MessageSquareText, Send, Sparkles, Stars } from 'lucide-react'
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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = useMemo(
    () => scope === 'session' ? 'Ask Polaris about this session' : 'Ask Polaris about this trace',
    [scope]
  )

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

  return (
    <section className="bg-transparent mt-2">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Stars className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Polaris answers from this {scope}&apos;s trace, tool, event, token, cost, and error data.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((preset) => {
            const Icon = preset.icon
            return (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-[12px]"
                disabled={isLoading}
                onClick={() => void submit(preset.prompt, preset.id)}
              >
                <Icon className="h-3.5 w-3.5" />
                {preset.label}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3 pb-3">
        {messages.length > 0 && (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn(
                  'rounded-lg border px-3 py-2 text-[13px] leading-relaxed',
                  message.role === 'user'
                    ? 'ml-auto max-w-[88%] border-primary/20 bg-primary/5 text-foreground'
                    : 'mr-auto max-w-[92%] border-border bg-background text-foreground'
                )}
              >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {message.role === 'user' ? 'You' : `Polaris · ${message.model}`}
                </div>
                <div className="whitespace-pre-wrap">{message.content}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[#f0b8b8] bg-[#fcebeb] px-3 py-2 text-[12px] text-[#791f1f]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Ask about this ${scope}...`}
            rows={2}
            className="min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading}
          />
          <Button
            type="submit"
            size="icon"
            className="h-10 w-10 shrink-0"
            disabled={isLoading || !draft.trim()}
            aria-label="Ask Polaris"
          >
            <Send className="h-4 w-4" />
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

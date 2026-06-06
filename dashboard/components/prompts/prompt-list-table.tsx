'use client'

import { ArrowRight, BookText, Tag } from 'lucide-react'
import Link from 'next/link'
import type { DashboardPrompt, Json } from '@/lib/supabase/types'

interface PromptListTableProps {
  prompts: DashboardPrompt[]
  onCreateClick: () => void
}

export function PromptListTable({ prompts, onCreateClick }: PromptListTableProps) {
  if (prompts.length === 0) {
    return (
      <div className="flex min-h-[480px] flex-col items-center justify-center gap-6 px-6">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#E1F5EE]">
          <BookText className="h-10 w-10 text-[#1D9E75]" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-foreground">No prompts yet</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Create your first prompt to register a versioned template that your agent can pull at runtime.
          </p>
        </div>
        <button type="button" className="ns-button ns-button-primary" onClick={onCreateClick}>
          <BookText className="h-4 w-4" />
          Create your first prompt
        </button>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {prompts.map((prompt) => (
        <PromptRow key={prompt.id} prompt={prompt} />
      ))}
    </div>
  )
}

function PromptRow({ prompt }: { prompt: DashboardPrompt }) {
  const labels = extractLabelEntries(prompt.labels)

  return (
    <div className="group flex items-start gap-4 px-6 py-4 transition-colors hover:bg-secondary/50">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border bg-white">
        <BookText className="h-5 w-5 text-[#1D9E75]" />
      </div>

      <div className="min-w-0 flex-1">
        <Link
          href={`./prompts/${prompt.id}`}
          className="block truncate text-sm font-medium text-foreground hover:text-[#0E7C5C]"
          title={prompt.name}
        >
          {prompt.name}
        </Link>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={prompt.slug}>
          {prompt.slug}
        </div>
        {prompt.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{prompt.description}</p>
        ) : null}
      </div>

      <div className="hidden items-center gap-2 lg:flex">
        <span className="ns-pill">
          {prompt.current_version_id ? 'has current' : 'no version'}
        </span>
        {labels.length === 0 ? (
          <span className="ns-pill">
            <Tag className="h-3 w-3" />
            no labels
          </span>
        ) : (
          labels.map((label) => (
            <span key={label} className="ns-pill">
              <Tag className="h-3 w-3" />
              {label}
            </span>
          ))
        )}
        <span className="ns-pill">{formatDate(prompt.updated_at)}</span>
      </div>

      <div className="flex items-center gap-2">
        <Link href={`./prompts/${prompt.id}`} className="ns-button h-8 gap-1">
          Open
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

function extractLabelEntries(labels: Json): string[] {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return []
  return Object.keys(labels as Record<string, unknown>).sort()
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

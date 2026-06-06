'use client'

import { Tag } from 'lucide-react'
import type { DashboardTracePromptLink, Json } from '@/lib/supabase/types'

interface PromptVersionBadgeProps {
  link: DashboardTracePromptLink
  onClick: (link: DashboardTracePromptLink) => void
}

export function PromptVersionBadge({ link, onClick }: PromptVersionBadgeProps) {
  const labels = readLabelEntries(link.labels)

  return (
    <button
      type="button"
      onClick={() => onClick(link)}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/60 bg-white px-2.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:border-[#1D9E75] hover:bg-[#E1F5EE]"
      title={`${link.prompt_name} v${link.version_number}`}
    >
      <span className="font-medium">{link.prompt_name}</span>
      <span className="font-mono text-[10.5px] text-muted-foreground">v{link.version_number}</span>
      {labels.length > 0 ? (
        labels.map((label) => (
          <span
            key={label}
            className={pillTone(label)}
          >
            <Tag className="h-2.5 w-2.5" />
            {label}
          </span>
        ))
      ) : null}
    </button>
  )
}

function pillTone(label: string) {
  const base = 'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0 font-mono text-[9.5px] font-semibold'
  if (label === 'prod') return `${base} bg-emerald-500 text-white`
  if (label === 'staging') return `${base} bg-amber-500 text-white`
  return `${base} bg-secondary text-muted-foreground`
}

function readLabelEntries(labels: Json): string[] {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return []
  return Object.keys(labels as Record<string, unknown>).sort()
}

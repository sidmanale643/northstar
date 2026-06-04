'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Activity, AlertCircle, ArrowUpRight, Brain, Cpu } from 'lucide-react'
import { CostBadge } from '@/components/cost-badge'
import type { DashboardTraceWithToolCalls } from '@/lib/supabase/types'
import { traceHref, type ProjectId } from '@/lib/projects'
import { cn } from '@/lib/utils'
import {
  buildSortHref,
  parseTracesSort,
  sortTraces,
  type TracesSortKey,
  type SortDir,
} from '@/lib/sort'

type SortOption = {
  label: string
  key: TracesSortKey
  dir: SortDir
}

const SORT_OPTIONS: SortOption[] = [
  { label: 'Newest', key: 'created_at', dir: 'desc' },
  { label: 'Oldest', key: 'created_at', dir: 'asc' },
  { label: 'Longest', key: 'duration', dir: 'desc' },
  { label: 'Most tools', key: 'tool_calls', dir: 'desc' },
  { label: 'Cost ↓', key: 'cost_usd', dir: 'desc' },
  { label: 'Errored first', key: 'status', dir: 'desc' },
]

const DEFAULT_SORT = { key: 'created_at' as const, dir: 'desc' as const }

export function RecentTraceTimeline({
  projectId,
  traces,
}: {
  projectId: ProjectId
  traces: DashboardTraceWithToolCalls[]
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const sortSpec = parseTracesSort(searchParams)

  const sorted = useMemo(() => sortTraces(traces, sortSpec), [traces, sortSpec])

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-muted-foreground">Sort:</span>
          {SORT_OPTIONS.map((option) => {
            const isOn = sortSpec.key === option.key && sortSpec.dir === option.dir
            const href = buildSortHref(
              pathname,
              searchParams,
              { key: option.key, dir: option.dir },
              DEFAULT_SORT
            )
            return (
              <Link
                key={`${option.key}-${option.dir}`}
                href={href}
                scroll={false}
                prefetch={false}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12px] transition-colors',
                  isOn
                    ? 'border-[#5dcaa5] bg-[#e1f5ee] text-[#0f6e56]'
                    : 'border-border bg-white text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </Link>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <LegendPill tone="trace" label="Trace" />
          <LegendPill tone="active" label="Active" />
          <LegendPill tone="error" label="Error" />
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="ns-panel flex min-h-52 flex-col items-center justify-center px-6 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ns-green-pale)] text-primary">
            <Activity className="h-4 w-4" />
          </span>
          <h3 className="mt-3 text-sm font-medium">No traces captured yet</h3>
          <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            Send an SDK trace to populate this project. New runs will appear here automatically.
          </p>
        </div>
      ) : (
        <div>
          {sorted.map((trace, index) => (
            <div
              key={trace.id}
              className="ns-enter"
              style={{ animationDelay: `${0.04 + index * 0.05}s` }}
            >
              <RecentTraceRow projectId={projectId} trace={trace} />
              {index < sorted.length - 1 && <div className="ml-[15px] h-2 w-px bg-border" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RecentTraceRow({
  projectId,
  trace,
}: {
  projectId: ProjectId
  trace: DashboardTraceWithToolCalls
}) {
  const isError = trace.status === 'error' || trace.status === 'failed'
  const isActive = !trace.ended_at
  const durationMs = trace.ended_at
    ? new Date(trace.ended_at).getTime() - new Date(trace.created_at).getTime()
    : null
  const tone = isError ? 'error' : isActive ? 'active' : 'trace'

  return (
    <div className="flex items-start gap-3.5">
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
          tone === 'error' && 'border-[#f09595] bg-[#fcebeb] text-[#a32d2d]',
          tone === 'active' && 'border-[#9fe1cb] bg-[#e1f5ee] text-[#0f6e56]',
          tone === 'trace' && 'border-[#afa9ec] bg-[#eeedfe] text-[#534ab7]'
        )}
      >
        {isError ? <AlertCircle className="h-3.5 w-3.5" /> : <Brain className="h-3.5 w-3.5" />}
      </span>

      <Link
        href={traceHref(projectId, trace.id)}
        className={cn(
          'group min-w-0 flex-1 rounded-[10px] border bg-white px-4 py-3 transition-all hover:border-[#c9c6bd] hover:shadow-[0_1px_6px_rgb(0_0_0_/_0.06)]',
          isError && 'border-[#f09595] bg-[#fffafa]'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={cn('truncate text-[13px] font-medium', isError && 'text-[#a32d2d]')}>
              {trace.name || 'Agent run'}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Chip>trace_{trace.id.slice(0, 8)}</Chip>
              <Chip>sess_{trace.session_id.slice(0, 8)}</Chip>
              <Chip>{trace.tool_calls.length} tool call{trace.tool_calls.length === 1 ? '' : 's'}</Chip>
              {trace.model && <ModelChip model={trace.model} />}
              {(isError || isActive) && (
                <StatusChip tone={tone}>{isError ? 'errored' : 'active'}</StatusChip>
              )}
              <CostBadge cost={trace.cost_usd} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-right">
              <div className="font-mono text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(trace.created_at), { addSuffix: true })}
              </div>
              {durationMs !== null && (
                <div className="mt-1 font-mono text-[10px] text-[var(--ns-faint)]">
                  {formatDuration(durationMs)}
                </div>
              )}
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
        </div>
      </Link>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border bg-[var(--ns-panel)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  )
}

function ModelChip({ model }: { model: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border bg-[var(--ns-panel)] px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
      <Cpu className="h-2.5 w-2.5 text-muted-foreground" />
      {model}
    </span>
  )
}

function StatusChip({
  tone,
  children,
}: {
  tone: 'trace' | 'active' | 'error'
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'rounded border px-1.5 py-0.5 font-mono text-[10px]',
        tone === 'error' && 'border-[#f09595] bg-[#fcebeb] text-[#a32d2d]',
        tone === 'active' && 'border-[#9fe1cb] bg-[#e1f5ee] text-[#0f6e56]',
        tone === 'trace' && 'border-[#afa9ec] bg-[#eeedfe] text-[#534ab7]'
      )}
    >
      {children}
    </span>
  )
}

function LegendPill({
  tone,
  label,
}: {
  tone: 'trace' | 'active' | 'error'
  label: string
}) {
  return <StatusChip tone={tone}>{label}</StatusChip>
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

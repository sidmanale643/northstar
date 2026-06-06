'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Layers3, Search, Wrench } from 'lucide-react'
import { CostBadge } from '@/components/cost-badge'
import { formatUsd, hasCost } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DashboardSession } from '@/lib/supabase/types'
import { sessionHref, type ProjectId } from '@/lib/projects'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import {
  buildSortHref,
  parseSessionsSort,
  sortSessions,
  type SessionsSortKey,
  type SortDir,
} from '@/lib/sort'

type StatusFilter = 'all' | 'active' | 'completed' | 'last24h' | 'errored'

type FilterDef = { value: StatusFilter; label: string; tone?: 'default' | 'warn' }

const FILTERS: FilterDef[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'last24h', label: 'Last 24h' },
  { value: 'errored', label: 'Errored', tone: 'warn' },
]

type ColumnDef = {
  label: string
  sortable: boolean
  sortKey?: SessionsSortKey
  defaultDir?: SortDir
}

const COLUMNS: ColumnDef[] = [
  { label: 'Session ID', sortable: false },
  { label: 'Status', sortable: false },
  { label: 'Started', sortable: true, sortKey: 'created_at', defaultDir: 'desc' },
  { label: 'Duration', sortable: true, sortKey: 'duration', defaultDir: 'desc' },
  { label: 'Traces', sortable: true, sortKey: 'trace_count', defaultDir: 'desc' },
  { label: 'Tool calls', sortable: true, sortKey: 'tool_call_count', defaultDir: 'desc' },
  { label: 'Cost', sortable: true, sortKey: 'total_cost_usd', defaultDir: 'desc' },
  { label: 'Tags', sortable: false },
]

interface SessionsTableProps {
  projectId: ProjectId
  sessions: DashboardSession[]
}

export function SessionsTable({ projectId, sessions }: SessionsTableProps) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 200)

  const pathname = usePathname()
  const searchParams = useSearchParams()
  const sortSpec = parseSessionsSort(searchParams)

  const filtered = useMemo(() => {
    const now = Date.now()
    const cutoff = now - 24 * 60 * 60 * 1000
    const needle = debouncedQuery.trim().toLowerCase()
    return sessions.filter((session) => {
      if (filter === 'active' && session.ended_at) return false
      if (filter === 'completed' && !session.ended_at) return false
      if (filter === 'last24h' && new Date(session.created_at).getTime() < cutoff) return false
      if (filter === 'errored' && session.errored_count === 0) return false
      if (needle) {
        // TODO(server-search): expand to trace.name + model when RPC joins available
        const haystack = `sess_${session.id}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [sessions, filter, debouncedQuery])

  const sorted = useMemo(() => sortSessions(filtered, sortSpec), [filtered, sortSpec])

  const maxDurationMs = useMemo(() => {
    const durations = sessions
      .map((session) => {
        if (!session.ended_at) return 0
        return new Date(session.ended_at).getTime() - new Date(session.created_at).getTime()
      })
      .filter((ms) => ms > 0)
    return Math.max(1000, ...durations)
  }, [sessions])

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted-foreground">Filter:</span>
        {FILTERS.map((f) => {
          const isOn = filter === f.value
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              title={f.tone === 'warn' ? 'Sessions with at least one errored run' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] transition-colors',
                isOn
                  ? f.tone === 'warn'
                    ? 'border-[#f09595] bg-[#fcebeb] text-[#a32d2d]'
                    : 'border-[#5dcaa5] bg-[#e1f5ee] text-[#0f6e56]'
                  : 'border-border bg-white text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions…"
            className="h-7 w-[200px] rounded-md border bg-white px-2.5 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-emerald-100"
          />
          <span className="font-mono text-[10px] text-muted-foreground">Client-side filter · server search coming</span>
        </div>
      </div>

      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="ns-label">Recent sessions</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          {sorted.length} of {sessions.length} shown
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-[var(--ns-panel)]">
              {COLUMNS.map((column) => (
                <ColumnHeader
                  key={column.label}
                  column={column}
                  pathname={pathname}
                  searchParams={searchParams}
                  sortSpec={sortSpec}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-muted-foreground">
                  <span className="font-mono text-[12px]">No sessions match the current filter.</span>
                </td>
              </tr>
            ) : (
              sorted.map((session) => (
                <SessionRow
                  key={session.id}
                  projectId={projectId}
                  session={session}
                  maxDurationMs={maxDurationMs}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ColumnHeader({
  column,
  pathname,
  searchParams,
  sortSpec,
}: {
  column: ColumnDef
  pathname: string
  searchParams: ReturnType<typeof useSearchParams>
  sortSpec: ReturnType<typeof parseSessionsSort>
}) {
  const baseClass = 'border-b px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground'

  if (!column.sortable || !column.sortKey) {
    return <th className={baseClass}>{column.label}</th>
  }

  const isActive = sortSpec.key === column.sortKey
  const nextDir: SortDir = isActive
    ? sortSpec.dir === 'desc'
      ? 'asc'
      : 'desc'
    : column.defaultDir ?? 'desc'
  const href = buildSortHref(
    pathname,
    searchParams,
    { key: column.sortKey, dir: nextDir },
    { key: 'created_at', dir: 'desc' }
  )
  const Icon = !isActive ? ArrowUpDown : sortSpec.dir === 'desc' ? ArrowDown : ArrowUp

  return (
    <th className={cn(baseClass, 'p-0')}>
      <Link
        href={href}
        scroll={false}
        prefetch={false}
        className={cn(
          'flex w-full items-center gap-1 px-4 py-2 transition-colors hover:text-foreground',
          isActive && 'text-foreground'
        )}
        aria-sort={isActive ? (sortSpec.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
      >
        <span>{column.label}</span>
        <Icon
          className={cn('h-3 w-3', isActive ? 'text-foreground' : 'text-muted-foreground/60')}
          aria-hidden="true"
        />
      </Link>
    </th>
  )
}

function SessionRow({
  projectId,
  session,
  maxDurationMs,
}: {
  projectId: ProjectId
  session: DashboardSession
  maxDurationMs: number
}) {
  const isActive = !session.ended_at
  const started = new Date(session.created_at)
  const startedLabel = formatRelative(started)
  const duration = isActive ? null : new Date(session.ended_at!).getTime() - started.getTime()

  const barColor = isActive ? '#b5d4f4' : '#9fe1cb'
  const barWidth = isActive
    ? 60
    : Math.max(8, Math.min(110, (duration! / maxDurationMs) * 110))

  return (
    <tr className="group transition-colors hover:bg-[var(--ns-panel)]">
      <td className="border-b px-4 py-2.5 last:border-b-0 group-last:border-b-0">
        <Link
          href={sessionHref(projectId, session.id)}
          className="font-mono text-[12px] text-foreground hover:text-primary"
        >
          sess_{session.id.slice(0, 8)}
        </Link>
      </td>
      <td className="border-b px-4 py-2.5 last:border-b-0 group-last:border-b-0">
        <StatusPill active={isActive} />
      </td>
      <td className="border-b px-4 py-2.5 text-[12px] text-muted-foreground last:border-b-0 group-last:border-b-0">
        {startedLabel}
      </td>
      <td className="border-b px-4 py-2.5 last:border-b-0 group-last:border-b-0">
        <div className="flex items-center gap-2">
          <span
            className="h-1 rounded-full"
            style={{ width: `${barWidth}px`, background: barColor }}
          />
          <span className="font-mono text-[12px] text-muted-foreground">
            {isActive ? 'running…' : formatDuration(duration!)}
          </span>
        </div>
      </td>
      <td className="border-b px-4 py-2.5 last:border-b-0 group-last:border-b-0">
        <span className="inline-flex items-center gap-1 text-[13px] text-foreground">
          <Layers3 className="h-3 w-3 text-muted-foreground" />
          {session.trace_count}
        </span>
      </td>
      <td className="border-b px-4 py-2.5 last:border-b-0 group-last:border-b-0">
        <span className="inline-flex items-center gap-1 text-[13px] text-foreground">
          <Wrench className="h-3 w-3 text-muted-foreground" />
          {session.tool_call_count}
        </span>
      </td>
      <td className="border-b px-4 py-2.5 last:border-b-0 group-last:border-b-0">
        <CostCell cost={session.total_cost_usd} />
      </td>
      <td className="border-b px-4 py-2.5 last:border-b-0 group-last:border-b-0">
        <Tags session={session} />
      </td>
    </tr>
  )
}

function CostCell({ cost }: { cost: string | number | null | undefined }) {
  if (hasCost(cost)) {
    return <CostBadge cost={cost} />
  }
  return <span className="font-mono text-[11px] text-muted-foreground">{formatUsd(cost)}</span>
}

function StatusPill({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ background: '#e6f1fb', color: '#0c447c' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#378add' }} />
        active
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e1f5ee] px-2 py-0.5 text-[11px] font-medium text-[#0f6e56]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#1d9e75]" />
      completed
    </span>
  )
}

function Tags({ session }: { session: DashboardSession }) {
  const tags: { label: string; tone: 'gray' | 'amber' }[] = []
  if (session.tool_call_count === 0 && !session.ended_at) {
    tags.push({ label: 'no-tools', tone: 'gray' })
  }
  if (session.trace_count > 10) {
    tags.push({ label: 'long-running', tone: 'amber' })
  }
  if (tags.length === 0) {
    return <span className="text-[11px] text-muted-foreground">—</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag.label}
          className="rounded border bg-[var(--ns-panel)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          style={tag.tone === 'amber' ? { color: '#854f0b', borderColor: '#f0d8a8', background: '#faeeda' } : undefined}
        >
          {tag.label}
        </span>
      ))}
    </div>
  )
}

function formatRelative(date: Date) {
  const diff = Date.now() - date.getTime()
  const seconds = Math.round(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

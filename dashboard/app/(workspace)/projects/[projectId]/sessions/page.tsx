import { Activity, AlertTriangle, Clock3, DollarSign, Layers3, Wrench } from 'lucide-react'
import { SessionsPageHeader } from '@/components/sessions-page-header'
import { SessionsTable } from '@/components/sessions-table'
import { CostStat } from '@/components/cost-stat'
import { getDashboardBackendProjectId, listDashboardSessions } from '@/lib/supabase/dashboard'
import type { DashboardSession } from '@/lib/supabase/types'
import { parseProjectId } from '@/lib/projects'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function SessionsPage({ params }: { params: { projectId: string } }) {
  const projectId = parseProjectId(params.projectId)
  if (!projectId) notFound()

  const backendProjectId = getDashboardBackendProjectId(projectId)
  let sessions: DashboardSession[] = []

  if (backendProjectId) {
    sessions = await listDashboardSessions(backendProjectId)
  }

  const stats = computeStats(sessions)

  return (
    <div className="ns-enter p-6 space-y-6 max-w-6xl mx-auto w-full">
      <SessionsPageHeader />

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Total sessions"
          value={stats.total}
          detail={`${stats.active} active now`}
          icon={Layers3}
        />
        <Stat
          label="Avg duration"
          value={stats.avgDurationLabel}
          detail={`p95: ${stats.p95DurationLabel}`}
          icon={Clock3}
        />
        <Stat
          label="Error rate"
          value={`${stats.errorRatePct}%`}
          detail={`${stats.errored} sessions errored`}
          icon={AlertTriangle}
          tone="warn"
        />
        <Stat
          label="Tool calls"
          value={stats.totalToolCalls}
          detail={`avg ${stats.avgToolsPerSession} / session`}
          icon={Wrench}
        />
        <CostStat
          label="Total cost"
          cost={stats.totalCost}
          inputTokens={stats.totalInputTokens}
          outputTokens={stats.totalOutputTokens}
          detail={`${stats.sessionsWithCost} sessions billed`}
          icon={DollarSign}
        />
      </div>

      {sessions.length ? (
        <SessionsTable projectId={projectId} sessions={sessions} />
      ) : (
        <EmptySessions />
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string | number
  detail: string
  icon: typeof Activity
  tone?: 'default' | 'warn'
}) {
  return (
    <div className="rounded-md bg-[var(--ns-panel)] px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {label}
        </div>
        <Icon className={`h-3.5 w-3.5 ${tone === 'warn' ? 'text-[#ba7517]' : 'text-muted-foreground'}`} />
      </div>
      <div
        className={`mt-2 font-mono text-[20px] font-medium ${
          tone === 'warn' ? 'text-[#ba7517]' : 'text-foreground'
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  )
}

function EmptySessions() {
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="ns-label">Recent sessions</h2>
        <span className="font-mono text-[10px] text-muted-foreground">0 shown</span>
      </div>
      <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border bg-white px-6 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ns-green-pale)] text-primary">
          <Activity className="h-4 w-4" />
        </span>
        <h3 className="mt-3 text-sm font-medium">No sessions captured yet</h3>
        <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
          Send an SDK trace to populate this project. New sessions will appear here automatically.
        </p>
      </div>
    </div>
  )
}

interface ComputedStats {
  total: number
  active: number
  errored: number
  errorRatePct: number
  totalToolCalls: number
  avgToolsPerSession: string
  avgDurationLabel: string
  p95DurationLabel: string
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  sessionsWithCost: number
}

function computeStats(sessions: DashboardSession[]): ComputedStats {
  const total = sessions.length
  const active = sessions.filter((s) => !s.ended_at).length
  const totalToolCalls = sessions.reduce((acc, s) => acc + s.tool_call_count, 0)
  const avgToolsPerSession = total > 0 ? (totalToolCalls / total).toFixed(1) : '0.0'

  const completedDurations = sessions
    .filter((s) => s.ended_at)
    .map((s) => new Date(s.ended_at as string).getTime() - new Date(s.created_at).getTime())
    .filter((ms) => ms > 0)

  const errored = sessions.reduce((acc, s) => acc + s.errored_count, 0)
  const errorRatePct = total > 0 ? Math.round((errored / total) * 100) : 0

  const totalCost = sessions.reduce((acc, s) => acc + toNumber(s.total_cost_usd), 0)
  const totalInputTokens = sessions.reduce((acc, s) => acc + (s.total_input_tokens ?? 0), 0)
  const totalOutputTokens = sessions.reduce((acc, s) => acc + (s.total_output_tokens ?? 0), 0)
  const sessionsWithCost = sessions.filter((s) => toNumber(s.total_cost_usd) > 0).length

  if (completedDurations.length === 0) {
    return {
      total,
      active,
      errored,
      errorRatePct,
      totalToolCalls,
      avgToolsPerSession,
      avgDurationLabel: '—',
      p95DurationLabel: '—',
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      sessionsWithCost,
    }
  }

  const avg = completedDurations.reduce((acc, ms) => acc + ms, 0) / completedDurations.length
  const sorted = [...completedDurations].sort((a, b) => a - b)
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  const p95 = sorted[p95Index]

  return {
    total,
    active,
    errored,
    errorRatePct,
    totalToolCalls,
    avgToolsPerSession,
    avgDurationLabel: formatDurationCompact(avg),
    p95DurationLabel: formatDurationCompact(p95),
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    sessionsWithCost,
  }
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDurationCompact(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

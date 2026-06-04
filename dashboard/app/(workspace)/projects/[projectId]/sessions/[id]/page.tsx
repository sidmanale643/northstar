import { Brain, DollarSign, Layers3, Wrench } from 'lucide-react'
import { notFound } from 'next/navigation'
import { TraceTimeline } from '@/components/trace-timeline'
import { ProjectContextLabel } from '@/components/project-context-label'
import { CostStat } from '@/components/cost-stat'
import { cn } from '@/lib/utils'
import {
  attachToolCalls,
  getDashboardBackendProjectId,
  getDashboardSession,
  getDashboardSessionCost,
  listDashboardTraces,
  listSessionToolCalls,
} from '@/lib/supabase/dashboard'
import { parseProjectId } from '@/lib/projects'

export const dynamic = 'force-dynamic'

export default async function SessionPage({ params }: { params: { projectId: string; id: string } }) {
  const projectId = parseProjectId(params.projectId)
  if (!projectId) notFound()

  const backendProjectId = getDashboardBackendProjectId(projectId)
  if (!backendProjectId) notFound()

  const [session, traceRows, toolCallRows, sessionCost] = await Promise.all([
    getDashboardSession(backendProjectId, params.id),
    listDashboardTraces(backendProjectId, params.id),
    listSessionToolCalls(backendProjectId, params.id),
    getDashboardSessionCost(backendProjectId, params.id),
  ])

  if (!session) notFound()

  const traces = attachToolCalls(traceRows, toolCallRows)
  const totalToolCalls = toolCallRows.length
  const llmCallCount = traces.length

  const sortedTraces = [...traces].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  const firstErroredIndex = sortedTraces.findIndex(
    (t) => t.status === 'error' || t.status === 'failed'
  )
  const errorCount = firstErroredIndex >= 0 ? sortedTraces.length - firstErroredIndex : 0
  const failedToolCallCount = toolCallRows.filter((toolCall) => toolCall.error !== null).length
  const firstErroredStatus = firstErroredIndex >= 0 ? sortedTraces[firstErroredIndex].status : null
  const firstErroredTraceNumber = firstErroredIndex >= 0 ? firstErroredIndex + 1 : null

  const sessionDurationMs = session.ended_at
    ? new Date(session.ended_at).getTime() - new Date(session.created_at).getTime()
    : null

  const isActive = !session.ended_at
  const badgeTone: 'error' | 'active' | 'completed' =
    errorCount > 0 ? 'error' : isActive ? 'active' : 'completed'

  return (
    <div className="ns-enter p-6 space-y-6 max-w-6xl mx-auto w-full">
      <div>
        <ProjectContextLabel section={`Sessions / sess_${session.id.slice(0, 8)}`} />

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-medium tracking-[-0.01em] text-foreground">
              Session: sess_{session.id.slice(0, 8)}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Trace-by-trace view of all LLM calls, tool uses, and events in this session.
            </p>
          </div>
          <SessionStatusBadge tone={badgeTone} durationMs={sessionDurationMs} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Traces"
          value={llmCallCount}
          detail="in this session"
          icon={Layers3}
        />
        <Stat
          label="LLM calls"
          value={llmCallCount}
          detail="—"
          icon={Brain}
        />
        <Stat
          label="Tool calls"
          value={totalToolCalls}
          detail={
            failedToolCallCount > 0
              ? `${failedToolCallCount} failed`
              : `${totalToolCalls} succeeded`
          }
          icon={Wrench}
          tone={failedToolCallCount > 0 ? 'warn' : 'ok'}
        />
        <CostStat
          label="Cost"
          cost={sessionCost?.cost_usd ?? 0}
          inputTokens={sessionCost?.input_tokens}
          outputTokens={sessionCost?.output_tokens}
          detail={
            sessionCost?.model_call_count
              ? `${sessionCost.model_call_count} model call${sessionCost.model_call_count === 1 ? '' : 's'}`
              : 'no model calls recorded'
          }
          icon={DollarSign}
        />
        <Stat
          label="Error"
          value={
            errorCount > 0 && firstErroredStatus
              ? capitalizeStatus(firstErroredStatus)
              : 'No errors'
          }
          detail={
            errorCount > 0 && firstErroredTraceNumber
              ? `at trace #${firstErroredTraceNumber}`
              : 'all traces completed cleanly'
          }
          icon={Brain}
          tone={errorCount > 0 ? 'error' : 'ok'}
          size={errorCount > 0 ? 'sm' : 'md'}
        />
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Trace timeline
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <LegendPill tone="llm" label="LLM call" />
            <LegendPill tone="event" label="Event" />
            <LegendPill tone="error" label="Error" />
          </div>
        </div>
        <TraceTimeline
          projectId={projectId}
          traces={traces}
          sessionStart={session.created_at}
        />
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
  size = 'md',
}: {
  label: string
  value: string | number
  detail: string
  icon: typeof Brain
  tone?: 'default' | 'ok' | 'warn' | 'error'
  size?: 'sm' | 'md'
}) {
  const numClass = cn(
    'mt-2 font-mono font-medium',
    size === 'sm' ? 'text-[14px]' : tone === 'ok' && typeof value === 'string' ? 'text-[20px]' : 'text-[24px]'
  )

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 pb-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {label}
        </div>
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            tone === 'error' && 'text-[#a32d2d]',
            tone === 'warn' && 'text-[#ba7517]',
            tone === 'ok' && 'text-primary',
            tone === 'default' && 'text-muted-foreground'
          )}
        />
      </div>
      <div
        className={cn(
          numClass,
          tone === 'error' && 'text-[#a32d2d]',
          tone === 'ok' && 'text-primary',
          tone === 'default' && 'text-foreground'
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-muted-foreground">{detail}</div>
    </div>
  )
}

function SessionStatusBadge({
  tone,
  durationMs,
}: {
  tone: 'error' | 'active' | 'completed'
  durationMs: number | null
}) {
  if (tone === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
        style={{ background: '#fcebeb', color: '#a32d2d' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#a32d2d' }} />
        errored
        {durationMs !== null && ` · ${formatDuration(durationMs)}`}
      </span>
    )
  }
  if (tone === 'active') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
        style={{ background: '#e6f1fb', color: '#0c447c' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#378add' }} />
        active
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e1f5ee] px-2.5 py-1 text-[12px] font-medium text-[#0f6e56]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#1d9e75]" />
      completed
      {durationMs !== null && ` · ${formatDuration(durationMs)}`}
    </span>
  )
}

function LegendPill({ tone, label }: { tone: 'llm' | 'tool' | 'event' | 'error'; label: string }) {
  const styleByTone: Record<typeof tone, React.CSSProperties> = {
    llm: { background: '#eeedfe', color: '#3c3489' },
    tool: { background: '#e6f1fb', color: '#0c447c' },
    event: { background: '#e1f5ee', color: '#0f6e56' },
    error: { background: '#fcebeb', color: '#a32d2d' },
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={styleByTone[tone]}
    >
      {label}
    </span>
  )
}

function capitalizeStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

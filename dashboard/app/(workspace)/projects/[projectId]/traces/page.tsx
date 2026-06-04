import { Activity, DollarSign, Layers3, Radio, Wrench } from 'lucide-react'
import { ProjectDashboardHeading } from '@/components/project-dashboard-heading'
import { RecentTraceTimeline } from '@/components/recent-trace-timeline'
import { CostStat, type CostBreakdownEntry } from '@/components/cost-stat'
import {
  attachToolCalls,
  getDashboardBackendProjectId,
  getDashboardProjectCostSummary,
  listDashboardSessions,
  listDashboardTraces,
  listSessionToolCalls,
} from '@/lib/supabase/dashboard'
import type { DashboardProjectCostSummary, DashboardSession, DashboardTraceWithToolCalls } from '@/lib/supabase/types'
import { parseProjectId, type ProjectId } from '@/lib/projects'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({ params }: { params: { projectId: string } }) {
  const projectId = parseProjectId(params.projectId)
  if (!projectId) notFound()

  const backendProjectId = getDashboardBackendProjectId(projectId)
  let sessions: DashboardSession[] = []
  let recentTraces: DashboardTraceWithToolCalls[] = []
  let costSummary: DashboardProjectCostSummary | null = null

  if (backendProjectId) {
    [sessions, costSummary] = await Promise.all([
      listDashboardSessions(backendProjectId),
      getDashboardProjectCostSummary(backendProjectId),
    ])
    const traceGroups = await Promise.all(
      sessions.map(async (session) => {
        const [traces, toolCalls] = await Promise.all([
          listDashboardTraces(backendProjectId, session.id),
          listSessionToolCalls(backendProjectId, session.id),
        ])
        return attachToolCalls(traces, toolCalls)
      })
    )
    recentTraces = traceGroups.flat()
  }

  const totalTraces = sessions.reduce((total, session) => total + session.trace_count, 0)
  const totalTools = sessions.reduce((total, session) => total + session.tool_call_count, 0)
  const activeSessions = sessions.filter((session) => !session.ended_at).length
  const breakdown = buildCostBreakdown(costSummary)

  return (
    <div className="ns-enter space-y-5">
      <ProjectDashboardHeading />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Traces" value={totalTraces} detail="captured runs" icon={Activity} />
        <Stat label="Sessions" value={sessions.length} detail={`${activeSessions} active`} icon={Layers3} />
        <Stat label="Tool calls" value={totalTools} detail="across all sessions" icon={Wrench} />
        <CostStat
          label="Cost (30d)"
          cost={costSummary?.cost_usd ?? 0}
          inputTokens={costSummary?.input_tokens}
          outputTokens={costSummary?.output_tokens}
          detail={`${costSummary?.run_count ?? 0} runs`}
          breakdown={breakdown}
          icon={DollarSign}
        />
        <Stat label="Pipeline" value="ready" detail="project configured" icon={Radio} tone="ok" />
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="ns-label">Recent trace timeline</h2>
        </div>
        <RecentTraceTimeline projectId={projectId} traces={recentTraces} />
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
}: {
  label: string
  value: string | number
  detail: string
  icon: typeof Activity
  tone?: 'default' | 'ok'
}) {
  return (
    <div className="rounded-[10px] border bg-white px-4 py-3.5">
      <div className="flex items-center justify-between">
        <div className="ns-label">{label}</div>
        <Icon className={`h-3.5 w-3.5 ${tone === 'ok' ? 'text-primary' : 'text-muted-foreground'}`} />
      </div>
      <div className={`mt-2 font-mono text-[26px] font-semibold leading-none tracking-[-0.03em] ${tone === 'ok' ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  )
}

function buildCostBreakdown(summary: DashboardProjectCostSummary | null): CostBreakdownEntry[] | undefined {
  if (!summary || !summary.by_model || summary.by_model.length === 0) return undefined
  return summary.by_model.map((entry) => ({
    label: entry.model,
    cost: entry.cost_usd,
  }))
}

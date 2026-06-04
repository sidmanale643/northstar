import { notFound } from 'next/navigation'
import { ActiveProjectBreadcrumb } from '@/components/active-project-breadcrumb'
import { TraceInspector } from '@/components/trace-inspector'
import { getDashboardBackendProjectId, getDashboardTrace, listTraceEvents, listTraceToolCalls } from '@/lib/supabase/dashboard'
import { parseProjectId } from '@/lib/projects'

export const dynamic = 'force-dynamic'

export default async function TracePage({ params }: { params: { projectId: string; id: string } }) {
  const projectId = parseProjectId(params.projectId)
  if (!projectId) notFound()

  const backendProjectId = getDashboardBackendProjectId(projectId)
  if (!backendProjectId) notFound()

  const [trace, toolCalls, events] = await Promise.all([
    getDashboardTrace(backendProjectId, params.id),
    listTraceToolCalls(backendProjectId, params.id),
    listTraceEvents(backendProjectId, params.id),
  ])

  if (!trace) notFound()

  return (
    <div className="ns-enter flex-1 flex flex-col p-6 min-h-0 gap-4">
      <ActiveProjectBreadcrumb
        segments={[
          { label: `sess_${trace.session_id.slice(0, 8)}`, href: `/projects/${projectId}/sessions/${trace.session_id}` },
          { label: `trace_${trace.id.slice(0, 8)}` },
        ]}
      />

      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-foreground">
          Trace detail
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Inspect spans, metrics, and I/O for this agent run &nbsp;·&nbsp;
          <span className="font-mono text-[11px] text-[var(--ns-faint)]">
            {trace.id}
          </span>
        </p>
      </div>

      <TraceInspector trace={trace} toolCalls={toolCalls} events={events} />
    </div>
  )
}

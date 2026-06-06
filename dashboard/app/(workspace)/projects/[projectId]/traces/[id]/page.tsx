import { notFound } from 'next/navigation'
import { PolarisPanel } from '@/components/polaris-panel'
import { TraceInspector } from '@/components/trace-inspector'
import {
  getDashboardBackendProjectId,
  getDashboardPrompt,
  getDashboardTrace,
  listTraceEvents,
  listTracePromptLinks,
  listTraceSpans,
  listTraceToolCalls,
} from '@/lib/supabase/dashboard'
import { parseProjectId } from '@/lib/projects'
import type { DashboardPromptDetail, DashboardTracePromptLink } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

export default async function TracePage({ params }: { params: { projectId: string; id: string } }) {
  const projectId = parseProjectId(params.projectId)
  if (!projectId) notFound()

  const backendProjectId = getDashboardBackendProjectId(projectId)
  if (!backendProjectId) notFound()

  const [trace, spans, toolCalls, events, promptLinks] = await Promise.all([
    getDashboardTrace(backendProjectId, params.id),
    listTraceSpans(backendProjectId, params.id),
    listTraceToolCalls(backendProjectId, params.id),
    listTraceEvents(backendProjectId, params.id),
    listTracePromptLinks({ projectId: backendProjectId, traceId: params.id }),
  ])

  if (!trace) notFound()

  const uniquePromptIds = Array.from(new Set(promptLinks.map((link) => link.prompt_id)))
  const promptDetails = await Promise.all(
    uniquePromptIds.map((id) => getDashboardPrompt(backendProjectId, id))
  )
  const promptDetailById = new Map<string, DashboardPromptDetail>()
  promptDetails.forEach((detail, index) => {
    if (!detail) return
    promptDetailById.set(uniquePromptIds[index] ?? '', detail)
  })

  const versionContent: Record<string, string> = {}
  const versionMeta: Record<string, { model: string | null; temperature: number | null; maxTokens: number | null }> = {}
  for (const link of promptLinks) {
    const detail = promptDetailById.get(link.prompt_id)
    if (!detail?.versions) continue
    const version = detail.versions.find((v) => v.id === link.prompt_version_id)
    if (!version) continue
    versionContent[link.prompt_version_id] = version.content
    versionMeta[link.prompt_version_id] = {
      model: version.model,
      temperature: version.temperature,
      maxTokens: version.max_tokens,
    }
  }
  const promptIdByLink: Record<string, string> = {}
  for (const link of promptLinks) {
    promptIdByLink[link.prompt_id] = link.prompt_id
  }

  return (
    <div className="ns-enter flex-1 flex flex-col min-h-0">
      <div className="p-6 pb-4 space-y-4">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
        >
          <a
            href={`/projects/${projectId}/sessions/${trace.session_id}`}
            className="font-mono text-[10px] normal-case tracking-normal text-muted-foreground transition-colors hover:text-foreground"
          >
            {`sess_${trace.session_id.slice(0, 8)}`}
          </a>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-[10px] normal-case tracking-normal text-[var(--ns-faint)]">
            {`trace_${trace.id.slice(0, 8)}`}
          </span>
        </nav>

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

        <PolarisPanel projectId={projectId} scope="trace" targetId={trace.id} />
      </div>

      <TraceInspector
        trace={trace}
        spans={spans}
        toolCalls={toolCalls}
        events={events}
        projectId={projectId}
        promptLinks={promptLinks}
        promptVersionContent={versionContent}
        promptVersionMeta={versionMeta}
        promptIdByLink={promptIdByLink}
      />
    </div>
  )
}

void ({} as DashboardTracePromptLink)

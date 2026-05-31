import { format } from 'date-fns'
import { Activity, ArrowLeft, Clock3, Layers3, Wrench } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TraceTimeline } from '@/components/trace-timeline'
import { ProjectContextLabel } from '@/components/project-context-label'
import { createClient } from '@/lib/supabase/server'
import { Tables } from '@/lib/supabase/types'
import { DEMO_PROJECT_ID, projectHref } from '@/lib/projects'

export const dynamic = 'force-dynamic'

type TraceWithCalls = Tables<'traces'> & { tool_calls: Tables<'tool_calls'>[] | null }

export default async function SessionPage({ params }: { params: { projectId: string; id: string } }) {
  if (params.projectId !== DEMO_PROJECT_ID) notFound()

  const supabase = createClient()
  const { data: sessionData } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!sessionData) notFound()

  const session = sessionData as Tables<'sessions'>
  const { data: tracesData } = await supabase
    .from('traces')
    .select('*, tool_calls(*)')
    .eq('session_id', params.id)
    .order('created_at', { ascending: true })
  const traces = (tracesData ?? []) as TraceWithCalls[]
  const toolCalls = traces.reduce((total, trace) => total + (trace.tool_calls?.length ?? 0), 0)

  return (
    <div className="ns-enter space-y-5">
      <Link href={projectHref(DEMO_PROJECT_ID, 'sessions')} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" />
        All sessions
      </Link>

      <div>
        <ProjectContextLabel section="session" />
        <div className="font-mono text-[11px] text-muted-foreground">sess_{session.id}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-[-0.02em]">Session trace sequence</h1>
          <span className={`ns-pill ${session.ended_at ? '' : 'border-[#97c459] bg-[#eaf3de] text-[#3b6d11]'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${session.ended_at ? 'bg-[var(--ns-faint)]' : 'bg-[#639922]'}`} />
            {session.ended_at ? 'ended' : 'active'}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{format(new Date(session.created_at), 'PPpp')}</span>
          <span className="flex items-center gap-1"><Layers3 className="h-3 w-3" />{traces.length} traces</span>
          <span className="flex items-center gap-1"><Wrench className="h-3 w-3" />{toolCalls} tool calls</span>
          <span className="flex items-center gap-1 text-primary"><Activity className="h-3 w-3" />realtime</span>
        </div>
      </div>

      <section>
        <div className="mb-2.5 ns-label">Captured sequence</div>
        <TraceTimeline projectId={DEMO_PROJECT_ID} traces={traces} sessionId={session.id} />
      </section>
    </div>
  )
}

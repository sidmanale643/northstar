import { format } from 'date-fns'
import { Activity, ArrowLeft, Clock3, Cpu, Wrench } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ToolCallDetail } from '@/components/tool-call-detail'
import { ProjectContextLabel } from '@/components/project-context-label'
import { createClient } from '@/lib/supabase/server'
import { Tables } from '@/lib/supabase/types'
import { DEMO_PROJECT_ID, sessionHref } from '@/lib/projects'

export const dynamic = 'force-dynamic'

type TraceWithCalls = Tables<'traces'> & { tool_calls: Tables<'tool_calls'>[] | null }

export default async function TracePage({ params }: { params: { projectId: string; id: string } }) {
  if (params.projectId !== DEMO_PROJECT_ID) notFound()

  const supabase = createClient()
  const { data: traceData } = await supabase
    .from('traces')
    .select('*, tool_calls(*)')
    .eq('id', params.id)
    .single()

  if (!traceData) notFound()

  const trace = traceData as TraceWithCalls
  const toolCalls = trace.tool_calls ?? []

  return (
    <div className="ns-enter space-y-5">
      <Link href={sessionHref(DEMO_PROJECT_ID, trace.session_id)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" />
        Back to session
      </Link>

      <div>
        <ProjectContextLabel section="trace" />
        <div className="font-mono text-[11px] text-muted-foreground">trace_{trace.id} · sess_{trace.session_id.slice(0, 8)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-[-0.02em]">Agent run inspection</h1>
          <span className="ns-pill border-[#97c459] bg-[#eaf3de] text-[#3b6d11]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#639922]" />
            captured
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{format(new Date(trace.created_at), 'PPpp')}</span>
          <span className="flex items-center gap-1"><Cpu className="h-3 w-3" />run_{trace.run_id}</span>
          <span className="flex items-center gap-1 text-primary"><Wrench className="h-3 w-3" />{toolCalls.length} tool calls</span>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        <TraceStat label="Tool calls" value={toolCalls.length} detail="captured in this trace" />
        <TraceStat label="Run state" value="stored" detail="available for inspection" />
        <TraceStat label="Sequence" value="complete" detail="ordered by capture time" />
      </div>

      <section>
        <div className="mb-2.5 flex items-center gap-1.5 ns-label">
          <Activity className="h-3 w-3" />
          Tool calls
        </div>
        {toolCalls.length ? (
          <div className="space-y-2">
            {toolCalls.map((toolCall, index) => (
              <ToolCallDetail key={toolCall.id} toolCall={toolCall} index={index} />
            ))}
          </div>
        ) : (
          <div className="ns-panel px-4 py-8 text-center text-xs text-muted-foreground">
            This trace contains no tool calls.
          </div>
        )}
      </section>
    </div>
  )
}

function TraceStat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-md bg-[var(--ns-panel)] px-3 py-2.5">
      <div className="ns-label">{label}</div>
      <div className="mt-1.5 font-mono text-base font-medium">{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{detail}</div>
    </div>
  )
}

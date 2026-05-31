'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Activity, ArrowRight, Cpu, Wrench } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Tables } from '@/lib/supabase/types'
import { traceHref, type ProjectId } from '@/lib/projects'

type TraceWithCalls = Tables<'traces'> & { tool_calls: Tables<'tool_calls'>[] | null }

export function TraceTimeline({ projectId, traces: initial, sessionId }: { projectId: ProjectId; traces: TraceWithCalls[]; sessionId: string }) {
  const [traces, setTraces] = useState<TraceWithCalls[]>(initial)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const channel = supabase
      .channel(`session-traces-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'traces',
          filter: `session_id=eq.${sessionId}`,
        },
        async (payload) => {
          const newTrace = payload.new as Tables<'traces'>
          const { data: calls } = await supabase
            .from('tool_calls')
            .select('*')
            .eq('trace_id', newTrace.id)
          setTraces((previous) => [...previous, { ...newTrace, tool_calls: calls ?? [] }])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, supabase])

  if (!traces.length) {
    return (
      <div className="ns-panel flex min-h-44 flex-col items-center justify-center px-5 text-center">
        <Activity className="h-4 w-4 text-primary" />
        <p className="mt-2 text-xs font-medium">Waiting for the first trace</p>
        <p className="mt-1 text-[11px] text-muted-foreground">New runs appear here as they are ingested.</p>
      </div>
    )
  }

  return (
    <div className="ns-panel overflow-hidden">
      <div className="grid grid-cols-[170px_1fr_84px] border-b bg-[var(--ns-panel)] px-3 py-2 ns-label">
        <span>Captured at</span>
        <span>Run sequence</span>
        <span className="text-right">Tools</span>
      </div>
      <div>
        {traces.map((trace, index) => (
          <Link
            key={trace.id}
            href={traceHref(projectId, trace.id)}
            className="group grid min-h-[72px] grid-cols-[170px_1fr_84px] items-center border-b px-3 py-2 last:border-b-0 hover:bg-[var(--ns-panel)]"
          >
            <div>
              <div className="font-mono text-[11px] text-foreground">{format(new Date(trace.created_at), 'HH:mm:ss.SSS')}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">trace #{String(index + 1).padStart(2, '0')}</div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-primary" />
                <span className="truncate font-mono text-[11px] text-foreground">run_{trace.run_id.slice(0, 12)}</span>
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-1.5">
                {trace.tool_calls?.length ? (
                  trace.tool_calls.slice(0, 4).map((call) => (
                    <span key={call.id} className="inline-flex max-w-32 items-center gap-1 rounded-sm bg-[#e6f1fb] px-1.5 py-0.5 font-mono text-[9px] text-[#185fa5]">
                      <Wrench className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{call.name ?? 'unnamed'}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-[10px] text-muted-foreground">No tool calls recorded</span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 font-mono text-[11px] text-muted-foreground">
              {trace.tool_calls?.length ?? 0}
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

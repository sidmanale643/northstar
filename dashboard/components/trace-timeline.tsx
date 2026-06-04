import { AlertCircle, Brain, Play } from 'lucide-react'
import Link from 'next/link'
import { ModelCallRow } from '@/components/model-call-row'
import { cn } from '@/lib/utils'
import type { DashboardTraceWithToolCalls } from '@/lib/supabase/types'
import { traceHref, type ProjectId } from '@/lib/projects'

type TimelineEvent =
  | { type: 'start'; id: 'start'; timestamp: number }
  | { type: 'trace'; id: string; timestamp: number; trace: DashboardTraceWithToolCalls }

interface TraceTimelineProps {
  projectId: ProjectId
  traces: DashboardTraceWithToolCalls[]
  sessionStart: string
}

export function TraceTimeline({ projectId, traces, sessionStart }: TraceTimelineProps) {
  const sessionStartMs = new Date(sessionStart).getTime()

  const events: TimelineEvent[] = [
    { type: 'start', id: 'start', timestamp: sessionStartMs },
  ]

  for (const trace of traces) {
    const traceMs = new Date(trace.created_at).getTime()
    events.push({ type: 'trace', id: trace.id, timestamp: traceMs, trace })
  }

  events.sort((a, b) => a.timestamp - b.timestamp)

  if (events.length <= 1) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center rounded-md border bg-white px-5 text-center">
        <Brain className="h-4 w-4 text-primary" />
        <p className="mt-2 text-xs font-medium">Waiting for the first trace</p>
        <p className="mt-1 text-[11px] text-muted-foreground">New runs appear here as they are ingested.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <div key={event.id}>
          <TimelineItem
            event={event}
            sessionStartMs={sessionStartMs}
            projectId={projectId}
          />
          {index < events.length - 1 && <div className="ml-[13px] h-2 w-px bg-border" />}
        </div>
      ))}
    </div>
  )
}

function TimelineItem({
  event,
  sessionStartMs,
  projectId,
}: {
  event: TimelineEvent
  sessionStartMs: number
  projectId: ProjectId
}) {
  const offset = event.timestamp - sessionStartMs
  const offsetLabel = formatOffset(offset)

  if (event.type === 'start') {
    return (
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: '#e1f5ee', color: '#0f6e56' }}
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </span>
        <div className="flex-1 rounded-md bg-[var(--ns-panel)] px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-foreground">Session started</span>
            <span className="font-mono text-[11px] text-muted-foreground">+{offsetLabel}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            Run begins · waiting for first agent step
          </div>
        </div>
      </div>
    )
  }

  if (event.type === 'trace') {
    const trace = event.trace
    const durationMs = trace.ended_at
      ? new Date(trace.ended_at).getTime() - new Date(trace.created_at).getTime()
      : null
    const isError = trace.status === 'error' || trace.status === 'failed'
    const tone = isError ? 'error' : 'llm'

    return (
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            tone === 'llm' && 'text-[#534ab7]'
          )}
          style={iconStyle(tone)}
        >
          {tone === 'error' ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Brain className="h-3.5 w-3.5" />
          )}
        </span>
        <div
          className="flex-1 rounded-md bg-[var(--ns-panel)] px-3 py-2"
          style={tone === 'error' ? { border: '0.5px solid #f7c1c1' } : undefined}
        >
          <div className="flex items-center justify-between">
            <Link
              href={traceHref(projectId, trace.id)}
              className={cn(
                'text-[13px] font-medium hover:underline',
                tone === 'error' ? 'text-[#a32d2d]' : 'text-foreground'
              )}
            >
              LLM call · {trace.name || `run_${trace.run_id.slice(0, 8)}`}
            </Link>
            <span
              className={cn(
                'font-mono text-[11px]',
                tone === 'error' ? 'text-[#a32d2d]' : 'text-muted-foreground'
              )}
            >
              +{offsetLabel}
              {durationMs !== null && ` · ${formatDuration(durationMs)}`}
            </span>
          </div>
          <div
            className={cn(
              'mt-0.5 text-[12px]',
              tone === 'error' ? 'text-[#a32d2d]' : 'text-muted-foreground'
            )}
          >
            run_{trace.run_id.slice(0, 12)} · {trace.tool_calls.length} tool call
            {trace.tool_calls.length === 1 ? '' : 's'}
            {trace.status && trace.status !== 'completed' && trace.status !== 'success' ? ` · ${trace.status}` : ''}
          </div>
          <ModelCallRow
            model={trace.model}
            inputTokens={trace.input_tokens}
            outputTokens={trace.output_tokens}
            costUsd={trace.cost_usd}
          />
        </div>
      </div>
    )
  }

  const _exhaustive: never = event
  return _exhaustive
}

function iconStyle(tone: 'llm' | 'error'): React.CSSProperties {
  if (tone === 'error') {
    return { background: '#fcebeb', color: '#a32d2d' }
  }
  return { background: '#eeedfe', color: '#534ab7' }
}

function formatOffset(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

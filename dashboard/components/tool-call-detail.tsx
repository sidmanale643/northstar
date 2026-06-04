import { format } from 'date-fns'
import { ChevronDown, Wrench } from 'lucide-react'
import { JsonViewer } from '@/components/json-viewer'
import type { DashboardToolCall } from '@/lib/supabase/types'

interface ToolCallDetailProps {
  toolCall: DashboardToolCall
  index: number
}

export function ToolCallDetail({ toolCall, index }: ToolCallDetailProps) {
  return (
    <details className="group ns-panel overflow-hidden" open={index === 0}>
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-[var(--ns-panel)] px-3 py-2.5">
        <span className="rounded-full border border-[#85b7eb] bg-[#e6f1fb] px-2 py-0.5 font-mono text-[10px] text-[#185fa5]">
          call_{String(index + 1).padStart(2, '0')}
        </span>
        <Wrench className="h-3.5 w-3.5 text-[#378add]" />
        <span className="font-mono text-xs font-medium text-foreground">{toolCall.name ?? 'unnamed_tool'}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{format(new Date(toolCall.created_at), 'HH:mm:ss.SSS')}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-3 border-t p-3 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 ns-label">Params</div>
          <JsonViewer data={toolCall.params} className="h-full" />
        </div>
        <div>
          <div className="mb-1.5 ns-label">Output</div>
          <JsonViewer data={toolCall.output ?? 'No output captured.'} className="h-full" />
        </div>
      </div>
    </details>
  )
}

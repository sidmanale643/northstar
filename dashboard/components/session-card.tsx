import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Activity, ArrowUpRight, Layers3, Wrench } from 'lucide-react'
import type { DashboardSession } from '@/lib/supabase/types'
import { sessionHref, type ProjectId } from '@/lib/projects'

interface SessionCardProps {
  projectId: ProjectId
  session: DashboardSession
  stats?: { traceCount: number; toolCallCount: number }
}

export function SessionCard({ projectId, session, stats }: SessionCardProps) {
  const isActive = !session.ended_at

  return (
    <Link
      href={sessionHref(projectId, session.id)}
      className="group ns-panel block px-3 py-3 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-[0_7px_20px_rgb(24_53_45_/_0.07)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-primary' : 'bg-[var(--ns-faint)]'}`} />
            sess_{session.id.slice(0, 8)}
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            {formatDistanceToNow(new Date(session.created_at), { addSuffix: true })}
          </div>
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>

      <div className="mt-4 flex items-center gap-3 border-t pt-2.5 font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Layers3 className="h-3 w-3" />
          {stats?.traceCount ?? 0} traces
        </span>
        <span className="flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          {stats?.toolCallCount ?? 0} tools
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Activity className="h-3 w-3" />
          {isActive ? 'active' : 'ended'}
        </span>
      </div>
    </Link>
  )
}

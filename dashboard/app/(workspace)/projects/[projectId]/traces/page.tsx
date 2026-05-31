import { Activity, Layers3, Radio, Wrench } from 'lucide-react'
import { ProjectDashboardHeading } from '@/components/project-dashboard-heading'
import { SessionCard } from '@/components/session-card'
import { createClient } from '@/lib/supabase/server'
import { Tables } from '@/lib/supabase/types'
import { DEMO_PROJECT_ID } from '@/lib/projects'

export const dynamic = 'force-dynamic'

interface SessionStats {
  session_id: string
  trace_count: number
  tool_call_count: number
}

export default async function DashboardPage({ params }: { params: { projectId: string } }) {
  let sessions: Tables<'sessions'>[] = []
  let stats: SessionStats[] = []

  if (params.projectId === DEMO_PROJECT_ID) {
    const supabase = createClient()
    const [{ data: sessionsData }, { data: statsData }] = await Promise.all([
      supabase.from('sessions').select('*').order('created_at', { ascending: false }).limit(12),
      supabase.rpc('get_session_stats'),
    ])
    sessions = (sessionsData ?? []) as Tables<'sessions'>[]
    stats = (statsData ?? []) as SessionStats[]
  }

  const statsMap = new Map(
    stats.map((session) => [
      session.session_id,
      { traceCount: session.trace_count, toolCallCount: session.tool_call_count },
    ])
  )
  const totalTraces = stats.reduce((total, session) => total + session.trace_count, 0)
  const totalTools = stats.reduce((total, session) => total + session.tool_call_count, 0)
  const activeSessions = sessions.filter((session) => !session.ended_at).length

  return (
    <div className="ns-enter space-y-5">
      <ProjectDashboardHeading />

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sessions" value={sessions.length} detail={`${activeSessions} active`} icon={Layers3} />
        <Stat label="Traces" value={totalTraces} detail="captured runs" icon={Activity} />
        <Stat label="Tool calls" value={totalTools} detail="across all sessions" icon={Wrench} />
        <Stat label="Pipeline" value="ready" detail="project configured" icon={Radio} accent />
      </div>

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="ns-label">Recent sessions</h2>
          <span className="font-mono text-[10px] text-muted-foreground">{sessions.length} shown</span>
        </div>
        {sessions.length ? (
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {sessions.map((session) => (
              <SessionCard key={session.id} projectId={DEMO_PROJECT_ID} session={session} stats={statsMap.get(session.id)} />
            ))}
          </div>
        ) : (
          <EmptySessions />
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
  accent = false,
}: {
  label: string
  value: string | number
  detail: string
  icon: typeof Activity
  accent?: boolean
}) {
  return (
    <div className="ns-panel px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="ns-label">{label}</div>
        <Icon className={`h-3.5 w-3.5 ${accent ? 'text-primary' : 'text-muted-foreground'}`} />
      </div>
      <div className={`mt-2 font-mono text-lg font-medium ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{detail}</div>
    </div>
  )
}

function EmptySessions() {
  return (
    <div className="ns-panel flex min-h-52 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ns-green-pale)] text-primary">
        <Activity className="h-4 w-4" />
      </span>
      <h3 className="mt-3 text-sm font-medium">No sessions captured yet</h3>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
        Send an SDK trace to populate this project. New sessions will appear here automatically.
      </p>
    </div>
  )
}

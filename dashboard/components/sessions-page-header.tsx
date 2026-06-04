'use client'

import { useActiveProject } from '@/components/project-provider'

export function SessionsPageHeader() {
  const project = useActiveProject()

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
        Project / {project.name}
      </div>
      <h1 className="mt-1 text-[22px] font-medium tracking-[-0.01em] text-foreground">
        Sessions
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Each session groups a conversation or agent run. Click a session to inspect its traces.
      </p>
    </div>
  )
}

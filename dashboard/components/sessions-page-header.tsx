'use client'

import { useActiveProject } from '@/components/project-provider'

export function SessionsPageHeader() {
  const project = useActiveProject()

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="ns-label">Project / {project.name}</div>
        <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Sessions</h1>
        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
          Each session groups a conversation or agent run. Click a session to inspect its traces.
        </p>
      </div>
    </div>
  )
}

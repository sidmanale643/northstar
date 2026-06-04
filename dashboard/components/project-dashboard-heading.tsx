'use client'

import { useActiveProject } from '@/components/project-provider'

export function ProjectDashboardHeading() {
  const project = useActiveProject()

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="ns-label">Project / {project.name}</div>
        <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Trace dashboard</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Recent traces and captured tool activity for the selected project.
        </p>
      </div>
    </div>
  )
}

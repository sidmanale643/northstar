'use client'

import { Radio } from 'lucide-react'
import { useActiveProject } from '@/components/project-provider'

export function ProjectDashboardHeading() {
  const project = useActiveProject()

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="ns-label">Project / {project.name}</div>
        <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Trace dashboard</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Recent sessions and captured tool activity for the selected project.
        </p>
      </div>
      <span className="ns-pill mt-1">
        <Radio className="h-3 w-3 text-primary" />
        ingestion ready
      </span>
    </div>
  )
}

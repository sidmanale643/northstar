'use client'

import { useActiveProject } from '@/components/project-provider'

export function ProjectContextLabel({ section }: { section: string }) {
  const project = useActiveProject()

  return <div className="ns-label">Project / {project.name} / {section}</div>
}

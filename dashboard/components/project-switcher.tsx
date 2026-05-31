'use client'

import { Plus } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useActiveProject, useProjectWorkspace } from '@/components/project-provider'
import { projectSwitchHref } from '@/lib/projects'

export function ProjectSwitcher() {
  const pathname = usePathname()
  const router = useRouter()
  const activeProject = useActiveProject()
  const { projects, selectProject } = useProjectWorkspace()

  function handleProjectChange(id: string) {
    const project = projects.find((candidate) => candidate.id === id)
    if (!project) return
    selectProject(project.id)
    router.push(projectSwitchHref(pathname, project.id))
  }

  return (
    <div className="flex items-center gap-1">
      <label className="sr-only" htmlFor="project-switcher">Current project</label>
      <select
        id="project-switcher"
        className="h-7 max-w-[190px] rounded-full border bg-white px-2 font-mono text-[10px] text-muted-foreground outline-none transition-colors hover:border-primary focus:border-primary"
        value={activeProject.id}
        onChange={(event) => handleProjectChange(event.target.value)}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
      <Link
        href="/projects"
        className="flex h-7 w-7 items-center justify-center rounded-full border bg-white text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        aria-label="Manage projects"
      >
        <Plus className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

'use client'

import { Plus, ChevronsUpDown } from 'lucide-react'
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
    <div className="flex w-full items-center gap-1.5">
      <label className="sr-only" htmlFor="project-switcher">Current project</label>
      <div className="relative flex-1">
        <select
          id="project-switcher"
          className="h-8 w-full appearance-none rounded-md border border-border/60 bg-white/50 pl-2.5 pr-8 font-sans text-[11px] font-medium text-foreground outline-none transition-colors hover:border-border focus:border-primary"
          value={activeProject.id}
          onChange={(event) => handleProjectChange(event.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
      </div>
      <Link
        href="/projects"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-white/50 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        aria-label="Manage projects"
      >
        <Plus className="h-4 w-4" />
      </Link>
    </div>
  )
}

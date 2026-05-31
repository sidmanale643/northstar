'use client'

import { FormEvent, useState } from 'react'
import { ArrowUpRight, Check, FolderKanban, Plus, Radio, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { DeleteProjectDialog } from '@/components/delete-project-dialog'
import { useProjectWorkspace } from '@/components/project-provider'
import { cn } from '@/lib/utils'
import { projectHref, type Project } from '@/lib/projects'

export function ProjectsPage() {
  const router = useRouter()
  const { createProject, deleteProject, isHydrated, projects, selectProject, selectedProjectId } = useProjectWorkspace()
  const [name, setName] = useState('')
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const project = createProject(name)
    if (!project) return
    setName('')
    router.push(projectHref(project.id))
  }

  function openProject(project: Project) {
    selectProject(project.id)
    router.push(projectHref(project.id))
  }

  function confirmDelete(project: Project) {
    deleteProject(project.id)
    setProjectToDelete(null)
  }

  if (!isHydrated) {
    return <div className="font-mono text-[11px] text-muted-foreground">Loading projects...</div>
  }

  return (
    <>
      <div className="ns-enter space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="ns-label">Workspace / projects</div>
            <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Projects</h1>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
              Open a project to inspect its sessions, traces, and ingestion settings.
            </p>
          </div>
          <span className="ns-pill">browser-local prototype</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="ns-label">Your projects</h2>
              <span className="font-mono text-[10px] text-muted-foreground">{projects.length} total</span>
            </div>
            {projects.length ? (
              <div className="grid gap-2.5 md:grid-cols-2">
                {projects.map((project) => {
                  const isSelected = project.id === selectedProjectId
                  return (
                    <article
                      key={project.id}
                      className={cn(
                        'ns-panel group min-h-36 px-3 py-3 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-[0_7px_20px_rgb(24_53_45_/_0.07)]',
                        isSelected && 'border-primary'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--ns-green-pale)] text-primary">
                          <FolderKanban className="h-4 w-4" />
                        </span>
                        <div className="flex items-center gap-1.5">
                          {isSelected && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-[var(--ns-green-pale)] px-2 py-0.5 font-mono text-[9px] text-[var(--ns-green-dark)]">
                              <Check className="h-2.5 w-2.5" />selected
                            </span>
                          )}
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded border border-red-100 text-red-600 opacity-0 transition-opacity hover:bg-red-50 group-hover:opacity-100 focus:opacity-100"
                            onClick={() => setProjectToDelete(project)}
                            aria-label={`Delete ${project.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <button type="button" className="mt-3 block w-full text-left" onClick={() => openProject(project)}>
                        <span className="block text-sm font-medium text-foreground">{project.name}</span>
                        <span className="mt-1 block font-mono text-[10px] text-muted-foreground">{project.id}</span>
                        <span className="mt-3 flex items-center gap-1 border-t pt-2 text-[10px] text-muted-foreground">
                          <Radio className="h-3 w-3 text-primary" />
                          ready for sessions
                          <ArrowUpRight className="ml-auto h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                        </span>
                      </button>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="ns-panel flex min-h-48 flex-col items-center justify-center px-5 text-center">
                <FolderKanban className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-sm font-medium">No projects yet</h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                  Create a project to open a workspace for its traces and settings.
                </p>
              </div>
            )}
          </section>

          <aside className="ns-panel h-fit p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Plus className="h-3.5 w-3.5 text-primary" />
              Create project
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
              New projects stay in this browser until the project API is connected.
            </p>
            <form className="mt-4" onSubmit={handleSubmit}>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="new-project-name">
                Project name
              </label>
              <input
                id="new-project-name"
                className="ns-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="customer-support-agent"
              />
              <button className="ns-button ns-button-primary mt-2.5 w-full" type="submit" disabled={!name.trim()}>
                <Plus />Create project
              </button>
            </form>
          </aside>
        </div>
      </div>
      <DeleteProjectDialog project={projectToDelete} onCancel={() => setProjectToDelete(null)} onConfirm={confirmDelete} />
    </>
  )
}

'use client'

import { useEffect } from 'react'
import {
  Activity,
  BarChart3,
  Bug,
  Database,
  FolderKanban,
  Layers3,
  Settings2,
  Star,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ActiveProjectProvider, useProjectWorkspace } from '@/components/project-provider'
import { ProjectSwitcher } from '@/components/project-switcher'
import { cn } from '@/lib/utils'
import { projectHref, type Project } from '@/lib/projects'

function navigation(project: Project) {
  return [
    { label: 'Projects', href: '/projects', icon: FolderKanban },
    { label: 'Sessions', href: projectHref(project.id, 'sessions'), icon: Layers3 },
    { label: 'Traces', href: projectHref(project.id), icon: Activity },
    { label: 'Datasets', href: projectHref(project.id, 'datasets'), icon: Database },
    { label: 'Evals', href: projectHref(project.id, 'evals'), icon: Bug },
    { label: 'Metrics', icon: BarChart3 },
    { label: 'Settings', href: projectHref(project.id, 'settings'), icon: Settings2 },
  ]
}

function isActivePath({ href, pathname }: { href?: string; pathname: string }) {
  if (!href) return false
  if (href === '/projects') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function ProjectWorkspaceShell({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const router = useRouter()
  const { findProject, isHydrated, selectProject } = useProjectWorkspace()
  const project = findProject(projectId)

  useEffect(() => {
    if (!isHydrated) return
    if (!project) {
      router.replace('/projects')
      return
    }
    selectProject(project.id)
  }, [isHydrated, project, router, selectProject])

  if (!isHydrated || !project) return <WorkspaceLoading />

  return (
    <ActiveProjectProvider project={project}>
      <ProjectWorkspaceShellContent project={project}>{children}</ProjectWorkspaceShellContent>
    </ActiveProjectProvider>
  )
}

function ProjectWorkspaceShellContent({ project, children }: { project: Project; children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border/40 bg-background overflow-hidden">
        <div className="flex h-14 shrink-0 items-center px-5 mb-2">
          <Link href="/projects" className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.03em] text-foreground transition-opacity hover:opacity-80">
            <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-primary">
              <Star className="h-3 w-3 fill-white text-white" />
            </span>
            northstar
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <nav className="flex flex-col gap-0.5">
            {(() => {
              const projectsItem = navigation(project).find(({ href }) => href === '/projects')
              if (!projectsItem?.href) return null
              const active = isActivePath({ href: projectsItem.href, pathname })
              const Icon = projectsItem.icon
              return (
                <Link
                  href={projectsItem.href}
                  className={cn(
                    'group flex h-8 items-center gap-2.5 mx-3 px-3 rounded-md text-[12px] transition-all',
                    active ? 'bg-[var(--ns-green-pale)]/60 font-semibold text-[var(--ns-green-dark)]' : 'font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground'
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", active ? "text-[var(--ns-green-dark)]" : "text-muted-foreground/70 group-hover:text-foreground")} />
                  {projectsItem.label}
                </Link>
              )
            })()}
            <div className="px-6 pb-2 pt-6 ns-label text-muted-foreground/60">Navigation</div>
            {navigation(project).filter(({ href }) => href !== '/projects').map(({ label, href, icon: Icon }) => {
              const active = isActivePath({ href, pathname })
              const className = cn(
                'group flex h-8 items-center gap-2.5 mx-3 px-3 rounded-md text-[12px] transition-all',
                active && 'bg-[var(--ns-green-pale)]/60 font-semibold text-[var(--ns-green-dark)]',
                !active && href && 'font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground',
                !href && 'font-medium text-muted-foreground cursor-not-allowed opacity-40'
              )

              if (!href) {
                return (
                  <span key={label} className={className} aria-disabled="true">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
                    {label}
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-wide">soon</span>
                  </span>
                )
              }

              return (
                <Link key={label} href={href} className={className}>
                  <Icon className={cn("h-3.5 w-3.5", active ? "text-[var(--ns-green-dark)]" : "text-muted-foreground/70 group-hover:text-foreground")} />
                  {label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="shrink-0 border-t border-border/40 bg-black/[0.02] p-4">
          <div className="ns-label mb-2.5 px-1">Workspace</div>
          <ProjectSwitcher />
          <div className="mt-3 px-1">
            <div className="truncate text-[11px] font-medium text-foreground">{project.name}</div>
            <div className="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground/80">{project.id}</div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
        <div className="flex flex-1 min-h-full w-full flex-col">{children}</div>
      </main>
    </div>
  )
}

function WorkspaceLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="font-mono text-[11px] text-muted-foreground">Loading project workspace...</div>
    </div>
  )
}

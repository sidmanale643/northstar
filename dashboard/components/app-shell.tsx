'use client'

import { useEffect } from 'react'
import {
  Activity,
  BarChart3,
  Bug,
  FolderKanban,
  Layers3,
  Settings2,
  Star,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ActiveProjectProvider, useProjectWorkspace } from '@/components/project-provider'
import { ProjectSwitcher } from '@/components/project-switcher'
import { RealtimeIndicator } from '@/components/real-time-indicator'
import { cn } from '@/lib/utils'
import { projectHref, type Project } from '@/lib/projects'

function navigation(project: Project) {
  return [
    { label: 'Projects', href: '/projects', icon: FolderKanban },
    { label: 'Traces', href: projectHref(project.id), icon: Activity },
    { label: 'Sessions', href: projectHref(project.id, 'sessions'), icon: Layers3 },
    { label: 'Metrics', icon: BarChart3 },
    { label: 'Evals', icon: Bug },
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
    <div className="grid min-h-screen grid-cols-[220px_1fr] grid-rows-[48px_1fr] bg-background max-md:grid-cols-1">
      <header className="col-span-full flex items-center gap-3 border-b bg-[var(--ns-panel)] px-4">
        <Link href="/projects" className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[-0.03em] text-foreground">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-primary">
            <Star className="h-3 w-3 fill-white text-white" />
          </span>
          northstar
        </Link>
        <ProjectSwitcher />
        <span className="ml-auto">
          <RealtimeIndicator />
        </span>
        <span className="ns-pill">env: prod</span>
      </header>

      <aside className="border-r bg-[var(--ns-panel)] max-md:hidden">
        <div className="px-3 pb-1 pt-5 ns-label">Navigation</div>
        <nav className="mt-1">
          {navigation(project).map(({ label, href, icon: Icon }) => {
            const active = isActivePath({ href, pathname })
            const className = cn(
              'flex h-8 items-center gap-2 border-r-2 border-transparent px-3 text-[12.5px] text-muted-foreground transition-colors',
              active && 'border-r-primary bg-white font-medium text-foreground',
              !active && href && 'hover:bg-white hover:text-foreground',
              !href && 'cursor-not-allowed opacity-55'
            )

            if (!href) {
              return (
                <span key={label} className={className} aria-disabled="true">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  <span className="ml-auto font-mono text-[9px] uppercase tracking-wide">soon</span>
                </span>
              )
            }

            return (
              <Link key={label} href={href} className={className}>
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="mx-3 mt-8 border-t pt-4">
          <div className="ns-label">Current project</div>
          <div className="mt-3 rounded-md border bg-white px-2.5 py-2">
            <div className="truncate text-[11px] font-medium text-foreground">{project.name}</div>
            <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">{project.id}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              ingestion configured
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1240px] p-5 md:p-6">{children}</div>
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

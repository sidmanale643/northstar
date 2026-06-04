'use client'

import { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  Bug,
  ChevronDown,
  ChevronUp,
  Database,
  FolderKanban,
  Layers3,
  PanelLeft,
  PanelLeftClose,
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
    { label: 'Traces', href: projectHref(project.id), icon: Activity },
    { label: 'Sessions', href: projectHref(project.id, 'sessions'), icon: Layers3 },
    { label: 'Metrics', icon: BarChart3 },
    { label: 'Datasets', href: projectHref(project.id, 'datasets'), icon: Database },
    { label: 'Evals', href: projectHref(project.id, 'evals'), icon: Bug },
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState(false)

  return (
    <div className={cn(
      "grid h-screen w-full overflow-hidden bg-background max-md:grid-cols-1 transition-all duration-200",
      isSidebarCollapsed ? "grid-cols-[0px_1fr]" : "grid-cols-[220px_1fr]",
      isTopBarCollapsed ? "grid-rows-[24px_1fr]" : "grid-rows-[48px_1fr]"
    )}>
      <header className={cn(
        "col-span-full flex items-center border-b bg-[var(--ns-panel)] transition-all duration-200 overflow-hidden",
        isTopBarCollapsed ? "h-6 px-2" : "h-12 px-4"
      )}>
        {!isTopBarCollapsed ? (
          <div className="flex w-full items-center gap-3">
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isSidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <Link href="/projects" className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[-0.03em] text-foreground">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-primary">
                <Star className="h-3 w-3 fill-white text-white" />
              </span>
              northstar
            </Link>
            <ProjectSwitcher />
            <div className="flex-1" />
            <button 
              onClick={() => setIsTopBarCollapsed(true)}
              className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse top bar"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button 
            onClick={() => setIsTopBarCollapsed(false)}
            className="flex w-full items-center justify-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="h-3 w-3" /> Expand top bar
          </button>
        )}
      </header>

      <aside className={cn(
        "border-r bg-[var(--ns-panel)] max-md:hidden overflow-x-hidden overflow-y-auto custom-scrollbar transition-all duration-200",
        isSidebarCollapsed ? "w-0 opacity-0" : "w-[220px] opacity-100"
      )}>
        <nav className="mt-1 pt-3">
          {(() => {
            const projectsItem = navigation(project).find(({ href }) => href === '/projects')
            if (!projectsItem?.href) return null
            const active = isActivePath({ href: projectsItem.href, pathname })
            const Icon = projectsItem.icon
            return (
              <Link
                href={projectsItem.href}
                className={cn(
                  'flex h-8 items-center gap-2 border-r-2 border-transparent px-3 text-[12.5px] text-muted-foreground transition-colors',
                  active && 'border-r-primary bg-white font-medium text-foreground',
                  !active && 'hover:bg-white hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {projectsItem.label}
              </Link>
            )
          })()}
        </nav>
        <div className="px-3 pb-1 pt-5 ns-label">Navigation</div>
        <nav className="mt-1">
          {navigation(project).filter(({ href }) => href !== '/projects').map(({ label, href, icon: Icon }) => {
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
          <div className="mt-3 rounded-md border border-l-2 border-l-primary bg-white px-2.5 py-2">
            <div className="truncate text-[11px] font-medium text-foreground">{project.name}</div>
            <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">{project.id}</div>
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

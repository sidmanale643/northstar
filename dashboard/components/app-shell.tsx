'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  BookText,
  Bug,
  Database,
  FlaskConical,
  FolderKanban,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Star,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ActiveProjectProvider, useProjectWorkspace } from '@/components/project-provider'
import { ProjectSwitcher } from '@/components/project-switcher'
import { cn } from '@/lib/utils'
import { projectHref, type Project } from '@/lib/projects'

const SIDEBAR_WIDTH_KEY = 'northstar.sidebar.width'
const SIDEBAR_COLLAPSED_KEY = 'northstar.sidebar.collapsed'
const SIDEBAR_COLLAPSED_WIDTH = 56
const SIDEBAR_DEFAULT_WIDTH = 220
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 360

function navigation(project: Project) {
  return [
    { label: 'Projects', href: '/projects', icon: FolderKanban },
    { label: 'Sessions', href: projectHref(project.id, 'sessions'), icon: Layers3 },
    { label: 'Traces', href: projectHref(project.id), icon: Activity },
    { label: 'Datasets', href: projectHref(project.id, 'datasets'), icon: Database },
    { label: 'Prompts', href: projectHref(project.id, 'prompts'), icon: BookText },
    { label: 'Playground', href: projectHref(project.id, 'playground'), icon: FlaskConical },
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
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [collapsed, setCollapsed] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (Number.isFinite(storedWidth) && storedWidth >= SIDEBAR_MIN_WIDTH && storedWidth <= SIDEBAR_MAX_WIDTH) {
      setWidth(storedWidth)
    }
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)))
  }, [width, hydrated])

  useEffect(() => {
    if (!hydrated) return
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed, hydrated])

  const onResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    dragStateRef.current = { startX: event.clientX, startWidth: width }
  }, [width])

  const onResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state) return
    const next = clampWidth(state.startWidth + (event.clientX - state.startX))
    setWidth(next)
  }, [])

  const onResizePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragStateRef.current = null
  }, [])

  const onResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 16 : 4
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setWidth((current) => clampWidth(current - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setWidth((current) => clampWidth(current + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setWidth(SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWidth(SIDEBAR_MAX_WIDTH)
    }
  }, [])

  const onToggleCollapsed = useCallback(() => {
    setCollapsed((current) => !current)
  }, [])

  const asideWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : width

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside
        className="relative flex shrink-0 flex-col border-r border-border/40 bg-background overflow-hidden"
        style={{ width: `${asideWidth}px`, transition: dragStateRef.current ? 'none' : 'width 160ms ease-out' }}
        aria-label="Primary navigation"
        data-collapsed={collapsed}
      >
        <div
          className={cn(
            'flex h-14 shrink-0 items-center',
            collapsed ? 'justify-center px-2' : 'px-5'
          )}
        >
          <Link
            href="/projects"
            className={cn(
              'flex items-center gap-2 text-[14px] font-semibold tracking-[-0.03em] text-foreground transition-opacity hover:opacity-80',
              collapsed && 'justify-center'
            )}
            aria-label="Northstar home"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-primary">
              <Star className="h-3 w-3 fill-white text-white" />
            </span>
            {!collapsed && <span>northstar</span>}
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <nav className={cn('flex flex-col gap-0.5', collapsed ? 'px-2' : undefined)}>
            {(() => {
              const projectsItem = navigation(project).find(({ href }) => href === '/projects')
              if (!projectsItem?.href) return null
              const active = isActivePath({ href: projectsItem.href, pathname })
              const Icon = projectsItem.icon
              return (
                <Link
                  href={projectsItem.href}
                  title={collapsed ? projectsItem.label : undefined}
                  className={cn(
                    'group flex h-8 items-center gap-2.5 rounded-md text-[12px] transition-all',
                    collapsed ? 'justify-center px-0 mx-0' : 'mx-1 px-3',
                    active
                      ? 'bg-[var(--ns-green-pale)]/60 font-semibold text-[var(--ns-green-dark)]'
                      : 'font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      active ? 'text-[var(--ns-green-dark)]' : 'text-muted-foreground/70 group-hover:text-foreground'
                    )}
                  />
                  {!collapsed && projectsItem.label}
                </Link>
              )
            })()}
            {!collapsed && (
              <div className="px-7 pb-2 pt-6 ns-label text-muted-foreground/60">Navigation</div>
            )}
            <div
              className={cn('flex flex-col gap-0.5', !collapsed && 'mt-0')}
              role={collapsed ? 'group' : undefined}
              aria-label={collapsed ? 'Navigation' : undefined}
            >
              {navigation(project)
                .filter(({ href }) => href !== '/projects')
                .map(({ label, href, icon: Icon }) => {
                  const active = isActivePath({ href, pathname })
                  const className = cn(
                    'group flex h-8 items-center gap-2.5 rounded-md text-[12px] transition-all',
                    collapsed ? 'justify-center px-0 mx-0' : 'mx-1 px-3',
                    active && 'bg-[var(--ns-green-pale)]/60 font-semibold text-[var(--ns-green-dark)]',
                    !active && href && 'font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground',
                    !href && 'font-medium text-muted-foreground cursor-not-allowed opacity-40'
                  )

                  if (!href) {
                    return (
                      <span
                        key={label}
                        className={className}
                        aria-disabled="true"
                        title={collapsed ? `${label} (soon)` : undefined}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                        {!collapsed && (
                          <>
                            {label}
                            <span className="ml-auto font-mono text-[9px] uppercase tracking-wide">soon</span>
                          </>
                        )}
                      </span>
                    )
                  }

                  return (
                    <Link
                      key={label}
                      href={href}
                      className={className}
                      title={collapsed ? label : undefined}
                    >
                      <Icon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          active ? 'text-[var(--ns-green-dark)]' : 'text-muted-foreground/70 group-hover:text-foreground'
                        )}
                      />
                      {!collapsed && label}
                    </Link>
                  )
                })}
            </div>
          </nav>
        </div>

        <div
          className={cn(
            'shrink-0 border-t border-border/40 bg-black/[0.02]',
            collapsed ? 'p-2' : 'p-4'
          )}
        >
          {collapsed ? (
            <Link
              href="/projects"
              aria-label={`Open project: ${project.name}`}
              title={`${project.name}\n${project.id}`}
              className="flex h-8 w-full items-center justify-center rounded-md border border-border/60 bg-white/50 text-foreground transition-colors hover:border-border"
            >
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.04em]">
                {project.name.slice(0, 2)}
              </span>
            </Link>
          ) : (
            <>
              <div className="ns-label mb-2.5 px-1">Workspace</div>
              <ProjectSwitcher />
              <div className="mt-3 px-1">
                <div className="truncate text-[11px] font-medium text-foreground">{project.name}</div>
                <div className="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground/80">{project.id}</div>
              </div>
            </>
          )}
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={collapsed ? 'Expand sidebar' : 'Resize sidebar'}
          aria-valuenow={Math.round(asideWidth)}
          aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          tabIndex={0}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerEnd}
          onPointerCancel={onResizePointerEnd}
          onKeyDown={onResizeKeyDown}
          onDoubleClick={onToggleCollapsed}
          className={cn(
            'group/resizer absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none',
            'transition-colors hover:bg-primary/30 focus:bg-primary/30 focus:outline-none',
            'after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-border/60'
          )}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'pointer-events-auto absolute top-12 -right-3 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground shadow-sm transition-all',
              'opacity-0 group-hover/resizer:opacity-100 focus:opacity-100 hover:text-foreground hover:shadow'
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-3 w-3" />
            ) : (
              <PanelLeftClose className="h-3 w-3" />
            )}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
        <div className="flex flex-1 min-h-full w-full flex-col">{children}</div>
      </main>
    </div>
  )
}

function clampWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value))
}

function WorkspaceLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="font-mono text-[11px] text-muted-foreground">Loading project workspace...</div>
    </div>
  )
}

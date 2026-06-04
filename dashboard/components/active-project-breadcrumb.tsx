'use client'

import { useActiveProject } from '@/components/project-provider'

interface ActiveProjectBreadcrumbProps {
  segments: { label: string; href?: string }[]
}

export function ActiveProjectBreadcrumb({ segments }: ActiveProjectBreadcrumbProps) {
  const project = useActiveProject()

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
    >
      <span>Project</span>
      <span className="text-muted-foreground">/</span>
      <span className="font-mono text-[10px] normal-case tracking-normal text-muted-foreground">
        {project.name}
      </span>
      {segments.map((segment, index) => (
        <span key={`${segment.label}-${index}`} className="flex items-center gap-1.5">
          <span className="text-muted-foreground">/</span>
          {segment.href ? (
            <a
              href={segment.href}
              className="font-mono text-[10px] normal-case tracking-normal text-muted-foreground transition-colors hover:text-foreground"
            >
              {segment.label}
            </a>
          ) : (
            <span className="font-mono text-[10px] normal-case tracking-normal text-[var(--ns-faint)]">
              {segment.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}

'use client'

import Link from 'next/link'
import { ArrowRight, Box, ExternalLink, FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DashboardPrompt, DashboardPromptVersion } from '@/lib/supabase/types'
import type { ProjectId } from '@/lib/projects'
import { formatDistanceToNow } from 'date-fns'
import { DiffWithProdButton } from './diff-with-prod-button'

export interface VersionRowProps {
  version: DashboardPromptVersion
  prompt: DashboardPrompt
  isCurrent: boolean
  hasProdVersion: boolean
  projectId: ProjectId
  onPromoteClick: (version: DashboardPromptVersion) => void
  onDiffWithProdClick: (version: DashboardPromptVersion) => void
}

export function VersionRow({
  version,
  prompt,
  isCurrent,
  hasProdVersion,
  projectId,
  onPromoteClick,
  onDiffWithProdClick,
}: VersionRowProps) {
  const previewLines = version.content.split('\n').slice(0, 8)

  return (
    <div
      className={cn(
        'ns-panel flex flex-col gap-3 px-4 py-3',
        isCurrent && 'border-primary/40 bg-primary/5'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-md border border-border bg-white px-2 font-mono text-[11px] font-semibold text-foreground">
            v{version.version_number}
          </span>
          {isCurrent && (
            <span className="inline-flex h-6 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[10.5px] font-medium text-emerald-700">
              current
            </span>
          )}
          {version.parent_version_id && (
            <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 font-mono text-[10.5px] text-muted-foreground">
              <Box className="h-3 w-3" /> parent v{version.parent_version_id.slice(0, 6)}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <DiffWithProdButton
            projectId={projectId}
            promptId={prompt.id}
            baseVersionId={version.id}
            targetVersionId={version.id}
            hasProdVersion={hasProdVersion}
            isOpen={false}
            onOpenChange={() => onDiffWithProdClick(version)}
          />
          <Link
            href={`/projects/${projectId}/playground?promptId=${prompt.id}&versionId=${version.id}`}
            className="ns-button !h-7 !px-2.5 !text-[11px]"
            title="Open in playground"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Playground
          </Link>
          <button
            type="button"
            onClick={() => onPromoteClick(version)}
            className="ns-button ns-button-primary !h-7 !px-2.5 !text-[11px]"
          >
            Promote to…
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
        {version.model && (
          <span className="ns-pill">
            <span className="font-semibold text-foreground/80">model</span>
            {version.model}
          </span>
        )}
        {version.temperature !== null && (
          <span className="ns-pill">
            <span className="font-semibold text-foreground/80">temp</span>
            {Number(version.temperature).toFixed(2)}
          </span>
        )}
        {version.max_tokens !== null && (
          <span className="ns-pill">
            <span className="font-semibold text-foreground/80">max</span>
            {version.max_tokens}
          </span>
        )}
        {Array.isArray(version.variables) && version.variables.length > 0 && (
          <span className="ns-pill">
            <span className="font-semibold text-foreground/80">vars</span>
            {version.variables.length}
          </span>
        )}
      </div>

      <div className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-foreground/90">
        <pre className="whitespace-pre-wrap break-words">
          {previewLines.length > 0 ? previewLines.join('\n') : '(empty)'}
        </pre>
        {version.content.split('\n').length > previewLines.length && (
          <div className="mt-1 flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            {version.content.split('\n').length - previewLines.length} more lines
          </div>
        )}
      </div>

      {version.change_note && (
        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">{version.change_note}</span>
        </div>
      )}
    </div>
  )
}

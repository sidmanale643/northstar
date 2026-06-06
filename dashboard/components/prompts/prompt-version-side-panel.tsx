'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, FlaskConical, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DashboardTracePromptLink, Json } from '@/lib/supabase/types'
import type { ProjectId } from '@/lib/projects'
import { formatDistanceToNow } from 'date-fns'
import { DiffWithProdButton } from './diff-with-prod-button'

export interface PromptVersionSidePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  link: DashboardTracePromptLink
  promptId: string
  projectId: ProjectId
  versionContent: string
  model: string | null
  temperature: number | null
  maxTokens: number | null
  hasProdVersion: boolean
  onDiffWithProdClick: (versionId: string) => void
}

export function PromptVersionSidePanel({
  open,
  onOpenChange,
  link,
  promptId,
  projectId,
  versionContent,
  model,
  temperature,
  maxTokens,
  hasProdVersion,
  onDiffWithProdClick,
}: PromptVersionSidePanelProps) {
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) return null

  const labels = readLabels(link.labels)

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Prompt version details">
      <button
        type="button"
        aria-label="Close panel"
        onClick={() => onOpenChange(false)}
        className="ns-backdrop-enter flex-1 cursor-default bg-black/30"
      />
      <aside
        className={cn(
          'ns-dialog-enter relative flex h-full max-w-[90vw] w-[560px] flex-col border-l border-border bg-background shadow-2xl'
        )}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-border/60 px-5 py-4 pr-12">
          <div className="ns-label">Prompt version</div>
          <h2 className="mt-0.5 truncate text-sm font-semibold text-foreground">
            {link.prompt_name} v{link.version_number}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
            {labels.length > 0 ? (
              labels.map((label) => (
                <span
                  key={label}
                  className="inline-flex h-5 items-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 font-mono text-[10px] font-medium text-emerald-700"
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="font-mono text-[10.5px] text-muted-foreground/70">unlabeled</span>
            )}
            <span>·</span>
            <span>linked {formatDistanceToNow(new Date(link.linked_at), { addSuffix: true })}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
            {model && (
              <span className="ns-pill">
                <span className="font-semibold text-foreground/80">model</span>
                {model}
              </span>
            )}
            {temperature !== null && (
              <span className="ns-pill">
                <span className="font-semibold text-foreground/80">temp</span>
                {Number(temperature).toFixed(2)}
              </span>
            )}
            {maxTokens !== null && (
              <span className="ns-pill">
                <span className="font-semibold text-foreground/80">max</span>
                {maxTokens}
              </span>
            )}
          </div>

          <div>
            <div className="ns-label mb-1.5">Content</div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-secondary/20 p-3 font-mono text-[12px] leading-[1.55] text-foreground/90">
              {versionContent || '(empty)'}
            </pre>
          </div>

          <div>
            <div className="ns-label mb-1.5">Variable values</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-secondary/20 p-3 font-mono text-[11.5px] leading-[1.55] text-foreground/90">
              {formatJson(link.variable_values)}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-white px-5 py-3">
          <DiffWithProdButton
            projectId={projectId}
            promptId={promptId}
            baseVersionId={link.prompt_version_id}
            targetVersionId={link.prompt_version_id}
            hasProdVersion={hasProdVersion}
            isOpen={false}
            onOpenChange={() => onDiffWithProdClick(link.prompt_version_id)}
            size="md"
          />
          <button
            type="button"
            className="ns-button ns-button-primary"
            onClick={() =>
              router.push(
                `/projects/${projectId}/playground?promptId=${link.prompt_id}&versionId=${link.prompt_version_id}`
              )
            }
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Open in Playground
          </button>
        </div>
      </aside>
    </div>
  )
}

function readLabels(value: Json): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const out: string[] = []
  for (const [key, raw] of Object.entries(value as Record<string, Json | undefined>)) {
    if (typeof raw === 'string' && raw.length > 0) out.push(key)
  }
  return out
}

function formatJson(value: Json): string {
  if (value === null) return 'null'
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

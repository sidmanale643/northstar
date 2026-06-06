'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BookText, History, Loader2, Sparkles, Tag, X } from 'lucide-react'
import { LabelHistoryTable } from '@/components/prompts/label-history-table'
import { LabelManager } from '@/components/prompts/label-manager'
import { PromoteLabelDialog } from '@/components/prompts/promote-label-dialog'
import { PromptVersionForm } from '@/components/prompts/prompt-version-form'
import { VersionRow } from '@/components/prompts/version-row'
import { DiffPane } from '@/components/playground/diff-pane'
import type { DiffPaneVersion } from '@/components/playground/diff-pane'
import type { ProjectId } from '@/lib/projects'
import type { BackendProjectId } from '@/lib/projects'
import type { DashboardPromptDetail, DashboardPromptVersion } from '@/lib/supabase/types'

interface PromptDetailProps {
  projectId: ProjectId
  backendProjectId: BackendProjectId
  initialPrompt: DashboardPromptDetail
}

export function PromptDetail({ projectId, backendProjectId: _backendProjectId, initialPrompt }: PromptDetailProps) {
  const [prompt, setPrompt] = useState<DashboardPromptDetail>(initialPrompt)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [promotingVersion, setPromotingVersion] = useState<DashboardPromptVersion | null>(null)
  const [diffVersion, setDiffVersion] = useState<DashboardPromptVersion | null>(null)
  const [isDiffPaneOpen, setIsDiffPaneOpen] = useState(false)

  const refetch = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/prompts/${initialPrompt.id}`, {
        cache: 'no-store',
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readApiError(body))
      const next = parsePromptResponse(body)
      if (!next) throw new Error('The server returned an invalid prompt.')
      setPrompt(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh prompt.')
    } finally {
      setIsRefreshing(false)
    }
  }, [projectId, initialPrompt.id])

  useEffect(() => {
    function onFocus() {
      void refetch()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refetch])

  const versions: DashboardPromptVersion[] = prompt.versions ?? []
  const labelHistory = prompt.label_history ?? []
  const labelsRecord = readLabelsObject(prompt.labels)
  const hasProdVersion = 'prod' in labelsRecord && typeof labelsRecord['prod'] === 'string'

  function handlePromoteClick(version: DashboardPromptVersion) {
    setPromotingVersion(version)
  }

  function handleDiffWithProdClick(version: DashboardPromptVersion) {
    setDiffVersion(version)
    setIsDiffPaneOpen(true)
  }

  function toDiffPaneVersion(v: DashboardPromptVersion): DiffPaneVersion {
    return {
      content: v.content,
      model: v.model,
      temperature: v.temperature,
      max_tokens: v.max_tokens,
      variables: v.variables,
    }
  }

  const prodVersionId = typeof labelsRecord['prod'] === 'string' ? labelsRecord['prod'] : null
  const prodVersion = prodVersionId ? versions.find((v) => v.id === prodVersionId) ?? null : null

  return (
    <div className="ns-enter relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-10">
      <section className="rounded-lg border bg-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <BookText className="h-5 w-5 text-[#1D9E75]" />
              {prompt.name}
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">{prompt.slug}</div>
            {prompt.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{prompt.description}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="ns-pill">{versions.length} versions</span>
              <span className="ns-pill">{Object.keys(readLabelsObject(prompt.labels)).length} labels</span>
              <span className="ns-pill">updated {formatDate(prompt.updated_at)}</span>
            </div>
          </div>
          {isRefreshing && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              refreshing
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="border-b border-[#F09595] bg-[#FCEBEB] px-6 py-2.5 text-sm text-[#791F1F]">
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            {error}
          </span>
        </div>
      )}

      <section className="rounded-lg border bg-background p-5">
        <div className="ns-label flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5" /> Labels
        </div>
        <div className="mt-3">
          <LabelManager prompt={prompt} versions={versions} onChange={refetch} />
        </div>
      </section>

      <section className="rounded-lg border bg-background p-5">
        <div className="ns-label flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Add version
        </div>
        <div className="mt-3">
          <PromptVersionForm projectId={projectId} promptId={prompt.id} onCreated={refetch} />
        </div>
      </section>

      <section className="rounded-lg border bg-background p-5">
        <div className="ns-label flex items-center gap-1.5">
          <BookText className="h-3.5 w-3.5" /> Versions
        </div>
        <div className="mt-3 space-y-3">
          {versions.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-secondary/30 px-4 py-6 text-center text-[12px] text-muted-foreground">
              No versions yet. Create the first one above.
            </p>
          ) : (
            versions.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                prompt={prompt}
                isCurrent={prompt.current_version_id === version.id}
                hasProdVersion={hasProdVersion}
                projectId={projectId}
                onPromoteClick={handlePromoteClick}
                onDiffWithProdClick={handleDiffWithProdClick}
              />
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-background p-5">
        <div className="ns-label flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" /> Label deployments
        </div>
        <div className="mt-3">
          <LabelHistoryTable history={labelHistory} />
        </div>
      </section>

      {promotingVersion !== null && (
        <PromoteLabelDialog
          open={promotingVersion !== null}
          onOpenChange={(open) => {
            if (!open) setPromotingVersion(null)
          }}
          projectId={projectId}
          promptId={prompt.id}
          prompt={prompt}
          targetVersion={promotingVersion}
          onSuccess={() => {
            void refetch()
            setPromotingVersion(null)
          }}
        />
      )}

      {isDiffPaneOpen && diffVersion !== null && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col border-l border-border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="text-sm font-semibold text-foreground">
              Diff - v{diffVersion.version_number} vs prod
            </div>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close diff panel"
              onClick={() => {
                setIsDiffPaneOpen(false)
                setDiffVersion(null)
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <DiffPane
              baseVersion={prodVersion ? toDiffPaneVersion(prodVersion) : null}
              targetVersion={toDiffPaneVersion(diffVersion)}
              baseLabel="prod"
              targetLabel={`v${diffVersion.version_number}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function readLabelsObject(labels: unknown): Record<string, unknown> {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return {}
  return labels as Record<string, unknown>
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function readApiError(value: unknown) {
  if (value && typeof value === 'object' && 'error' in value) {
    const candidate = (value as { error: unknown }).error
    if (typeof candidate === 'string') return candidate
  }
  return 'Unexpected server response.'
}

function parsePromptResponse(value: unknown): DashboardPromptDetail | null {
  if (!value || typeof value !== 'object') return null
  const prompt = (value as { prompt?: unknown }).prompt
  if (!prompt || typeof prompt !== 'object') return null
  const v = prompt as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.project_id !== 'string') return null
  if (typeof v.name !== 'string' || typeof v.slug !== 'string') return null
  if (typeof v.created_at !== 'string' || typeof v.updated_at !== 'string') return null
  return prompt as DashboardPromptDetail
}

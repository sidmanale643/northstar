'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, BookText, Loader2, Plus, Search, X } from 'lucide-react'
import { NewPromptDialog } from '@/components/prompts/new-prompt-dialog'
import { PromptListTable } from '@/components/prompts/prompt-list-table'
import { useActiveProject } from '@/components/project-provider'
import type { DashboardPrompt } from '@/lib/supabase/types'

export default function PromptsPage() {
  const project = useActiveProject()
  const [prompts, setPrompts] = useState<DashboardPrompt[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  useEffect(() => {
    let isCurrent = true
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/projects/${project.id}/prompts`, { cache: 'no-store' })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(readApiError(body))
        const list = parsePromptsResponse(body)
        if (!list) throw new Error('The server returned an invalid prompt list.')
        if (isCurrent) setPrompts(list)
      } catch (err) {
        if (isCurrent) {
          setPrompts([])
          setError(err instanceof Error ? err.message : 'Unable to load prompts.')
        }
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }
    void load()
    return () => {
      isCurrent = false
    }
  }, [project.id])

  useEffect(() => {
    function onFocus() {
      void refetch()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [project.id])

  async function refetch() {
    try {
      const response = await fetch(`/api/projects/${project.id}/prompts`, { cache: 'no-store' })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) return
      const list = parsePromptsResponse(body)
      if (list) setPrompts(list)
    } catch {
      // best-effort refetch; ignore errors
    }
  }

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return prompts
    return prompts.filter((prompt) => {
      if (prompt.name.toLowerCase().includes(query)) return true
      if (prompt.slug.toLowerCase().includes(query)) return true
      if (prompt.description && prompt.description.toLowerCase().includes(query)) return true
      return false
    })
  }, [prompts, searchQuery])

  return (
    <>
      <div className="ns-enter relative min-h-[680px] overflow-hidden rounded-lg border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <BookText className="h-5 w-5 text-[#1D9E75]" />
              Prompts
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Versioned prompt registry — add versions, set prod / staging labels, and link them from traces.
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search prompts..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="ns-input h-9 w-48 pl-9 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              className="ns-button ns-button-primary h-9"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              New prompt
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-[#F09595] bg-[#FCEBEB] px-6 py-2.5 text-sm text-[#791F1F]">
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              {error}
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading prompts...</span>
            </div>
          ) : (
            <PromptListTable prompts={filtered} onCreateClick={() => setIsCreateOpen(true)} />
          )}
        </div>

        {!isLoading && prompts.length > 0 && (
          <div className="border-t border-border bg-secondary/30 px-6 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {filtered.length} of {prompts.length} prompts
                {searchQuery && ` matching "${searchQuery}"`}
              </span>
            </div>
          </div>
        )}
      </div>
      <NewPromptDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} projectId={project.id} />
    </>
  )
}

function readApiError(value: unknown) {
  if (value && typeof value === 'object' && 'error' in value) {
    const candidate = (value as { error: unknown }).error
    if (typeof candidate === 'string') return candidate
  }
  return 'Unexpected server response.'
}

function parsePromptsResponse(value: unknown): DashboardPrompt[] | null {
  if (!value || typeof value !== 'object') return null
  const list = (value as { prompts?: unknown }).prompts
  if (!Array.isArray(list)) return null
  const out: DashboardPrompt[] = []
  for (const item of list) {
    if (!isDashboardPrompt(item)) return null
    out.push(item)
  }
  return out
}

function isDashboardPrompt(value: unknown): value is DashboardPrompt {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.project_id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.slug === 'string' &&
    (v.description === null || typeof v.description === 'string') &&
    (v.current_version_id === null || typeof v.current_version_id === 'string') &&
    typeof v.created_at === 'string' &&
    typeof v.updated_at === 'string'
  )
}

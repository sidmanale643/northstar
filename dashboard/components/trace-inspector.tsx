'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  ArrowUp, ArrowDown, Copy, X, ListTree, History, MessagesSquare,
  Database, Play, Flag, Tag, ChevronDown, ChevronRight, Braces, Sparkles,
  Wrench, Percent, Clock, DollarSign, Binary, CheckCircle2, Box, BarChart2, Loader2, Check, AlertCircle, Download
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TraceDagGraph } from '@/components/trace-dag-graph'
import { ScorePanel } from '@/components/scores/score-panel'
import { PromptVersionBadge } from '@/components/prompts/prompt-version-badge'
import { PromptVersionSidePanel } from '@/components/prompts/prompt-version-side-panel'
import type { DashboardSpan, DashboardToolCall, DashboardTrace, DashboardTraceEvent, DashboardTracePromptLink, EvalDatasetSummary, Json } from '@/lib/supabase/types'
import { format } from 'date-fns'

type SpanType = 'agent' | 'llm' | 'tool' | 'eval'

interface SpanNode {
  id: string
  type: SpanType
  name: string
  duration: string
  tokens?: string
  cost?: string
  data: DashboardTrace | DashboardToolCall | DashboardTraceEvent
  children: SpanNode[]
  isOpen: boolean
  breadcrumb: string
}

function buildTree(trace: DashboardTrace, toolCalls: DashboardToolCall[], events: DashboardTraceEvent[]): SpanNode {
  const root: SpanNode = {
    id: trace.id,
    type: 'agent',
    name: trace.name || 'Agent Run',
    duration: formatDuration(trace),
    tokens: `${(trace.input_tokens || 0) + (trace.output_tokens || 0)} tok`,
    cost: `$${Number(trace.cost_usd || 0).toFixed(4)}`,
    data: trace,
    children: [],
    isOpen: true,
    breadcrumb: 'Root span'
  }

  const children: SpanNode[] = []

  toolCalls.forEach(tc => {
    children.push({
      id: tc.id,
      type: 'tool',
      name: tc.name || 'unknown_tool',
      duration: '—',
      data: tc,
      children: [],
      isOpen: false,
      breadcrumb: `${root.name} › ${tc.name}`
    })
  })

  events.forEach(ev => {
    if (ev.type === 'user_input' || ev.type === 'final_response' || ev.type === 'reasoning' || ev.type === 'system_message') {
      const typeMap: Record<string, { name: string, type: SpanType }> = {
        user_input: { name: 'User Input', type: 'eval' },
        final_response: { name: 'Final Response', type: 'eval' },
        reasoning: { name: 'Model Reasoning', type: 'llm' },
        system_message: { name: 'System Prompt', type: 'llm' }
      }
      const meta = typeMap[ev.type] || { name: ev.type, type: 'eval' as SpanType }
      children.push({
        id: ev.id,
        type: meta.type,
        name: meta.name,
        duration: '—',
        data: ev,
        children: [],
        isOpen: false,
        breadcrumb: `${root.name} › ${meta.name}`
      })
    }
  })

  children.sort((a, b) => {
    const timeA = 'created_at' in a.data ? new Date(a.data.created_at).getTime() : 0
    const timeB = 'created_at' in b.data ? new Date(b.data.created_at).getTime() : 0
    return timeA - timeB
  })

  root.children = children
  return root
}

function formatDuration(trace: DashboardTrace): string {
  if (!trace.ended_at) return '—'
  const ms = new Date(trace.ended_at).getTime() - new Date(trace.created_at).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 1000).toFixed(1)}s`
}

function getIconClass(type: SpanType, isActive: boolean = false) {
  switch (type) {
    case 'agent': return isActive ? 'bg-primary text-white shadow-sm' : 'bg-primary/10 text-primary'
    case 'llm': return isActive ? 'bg-violet-600 text-white shadow-sm' : 'bg-violet-100 text-violet-700'
    case 'tool': return isActive ? 'bg-amber-500 text-white shadow-sm' : 'bg-amber-100 text-amber-700'
    case 'eval': return isActive ? 'bg-blue-500 text-white shadow-sm' : 'bg-blue-100 text-blue-700'
  }
}

function getIcon(type: SpanType) {
  switch (type) {
    case 'agent': return <Braces className="w-3.5 h-3.5" />
    case 'llm': return <Sparkles className="w-3.5 h-3.5" />
    case 'tool': return <Wrench className="w-3.5 h-3.5" />
    case 'eval': return <Box className="w-3.5 h-3.5" />
  }
}



function IOBlock({ label, value }: { label: string; value: unknown }) {
  const display = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <div className="flex flex-col rounded-lg border bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-secondary/50">
        <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
        <button 
          onClick={() => navigator.clipboard.writeText(display)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Copy to clipboard"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-3 text-[12px] font-mono leading-relaxed text-foreground bg-secondary/10">
        <pre className="whitespace-pre-wrap break-all">{display === 'null' || display === '""' ? '—' : display}</pre>
      </div>
    </div>
  )
}

function extractErrorMessage(error: Json): string {
  if (error == null) return 'Unknown error'
  if (typeof error === 'string') return error.length > 0 ? error : 'Unknown error'
  if (typeof error === 'object' && !Array.isArray(error)) {
    const e = error as Record<string, unknown>
    const candidate = e.message ?? e.error ?? e.detail
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
    if (candidate != null) return JSON.stringify(candidate)
    if (Object.keys(e).length === 0) return 'Unknown error'
    return JSON.stringify(error)
  }
  return 'Unknown error'
}

function ErrorBanner({ error, compact = false }: { error: Json; compact?: boolean }) {
  const message = extractErrorMessage(error)
  if (message === 'Unknown error') return null
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex items-start gap-2 rounded-md border border-[#f09595] bg-[#fcebeb] px-3 py-2 text-[12px] text-[#a32d2d]',
        compact && 'py-1.5 text-[11px]'
      )}
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">Run failed</div>
        <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px]">
          {message}
        </pre>
      </div>
    </div>
  )
}

function DetailPanel({ node, projectId, traceId, userInput, finalResponse, promptLinks, onPromptBadgeClick }: {
  node: SpanNode
  projectId: string
  traceId: string
  userInput: string
  finalResponse: string
  promptLinks: DashboardTracePromptLink[]
  onPromptBadgeClick: (link: DashboardTracePromptLink) => void
}) {
  const isTrace = node.type === 'agent'
  const isTool = node.type === 'tool'
  const isEvent = node.type === 'llm' || node.type === 'eval'

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="px-5 py-4 border-b border-border/60 bg-white sticky top-0 z-10 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground/80 mb-1.5 flex items-center gap-1.5">
              {node.breadcrumb.split(' › ').map((part, i, arr) => (
                <span key={i} className="flex items-center gap-1.5">
                  <span className={i === arr.length - 1 ? 'text-foreground' : ''}>{part}</span>
                  {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/40" />}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2.5">
              <div className={cn("w-7 h-7 rounded-md flex items-center justify-center", getIconClass(node.type, true))}>
                {getIcon(node.type)}
              </div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">{node.name}</h2>
              {isTrace && (node.data as DashboardTrace).status === 'success' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-1" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-secondary/50 border p-1 rounded-md">
            {isTrace ? (
              <AddToDatasetButton
                projectId={projectId}
                traceId={traceId}
                userInput={userInput}
                finalResponse={finalResponse}
              />
            ) : (
              <button
                type="button"
                disabled
                className="ns-button !border-transparent !shadow-none !h-7 !px-2.5 !text-[11px] !bg-transparent opacity-40 cursor-not-allowed"
                title="Select the trace root to add it to a dataset"
              >
                <Database className="w-3 h-3" /> Dataset
              </button>
            )}
            <button className="ns-button !border-transparent !shadow-none !h-7 !px-2.5 !text-[11px] !bg-transparent hover:!bg-white">
              <Play className="w-3 h-3" /> Replay
            </button>
            {isTrace && (
              <button
                type="button"
                onClick={() => downloadCsv(projectId, traceId)}
                className="ns-button !border-transparent !shadow-none !h-7 !px-2.5 !text-[11px] !bg-transparent hover:!bg-white"
                title="Download run as CSV"
              >
                <Download className="w-3 h-3" /> CSV
              </button>
            )}
          </div>
        </div>

        {/* Error banner for trace root or tool nodes */}
        {isTrace && (node.data as DashboardTrace).error && (
          <ErrorBanner error={(node.data as DashboardTrace).error!} />
        )}
        {isTool && (node.data as DashboardToolCall).error && (
          <ErrorBanner error={(node.data as DashboardToolCall).error!} compact />
        )}

        {/* Compact Metrics Strip */}
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground font-medium bg-secondary/30 border border-border/50 rounded-md px-3 py-1.5 w-fit">
          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {node.duration}</div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1.5"><Binary className="w-3.5 h-3.5" /> {node.tokens || '0 tok'}</div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" /> {node.cost || '$0.0000'}</div>
          {isTrace && (
             <>
               <div className="w-px h-3 bg-border" />
               <div className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> {(node.data as DashboardTrace).model || 'unknown'}</div>
             </>
          )}
        </div>

        {isTrace && promptLinks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="ns-label text-muted-foreground/70">Prompt</span>
            {promptLinks.map((link) => (
              <PromptVersionBadge key={link.id} link={link} onClick={onPromptBadgeClick} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="p-5 flex-1 overflow-y-auto space-y-4">
        <div className="grid grid-cols-1 gap-4">
          {isTrace && <ScorePanel projectId={projectId} traceId={traceId} />}
          {isTool && (
            <>
              <IOBlock label="Input Parameters" value={(node.data as DashboardToolCall).params} />
              <IOBlock label="Output" value={(node.data as DashboardToolCall).output} />
            </>
          )}
          {isEvent && (
            <IOBlock label="Content" value={(node.data as DashboardTraceEvent).content} />
          )}
          {isTrace && (
            <IOBlock label="Metadata" value={{ model: (node.data as DashboardTrace).model, status: (node.data as DashboardTrace).status, created: (node.data as DashboardTrace).created_at }} />
          )}
        </div>
      </div>
    </div>
  )
}

function TreeItem({ 
  node, 
  selectedId, 
  onSelect, 
  onToggle,
  depth = 0 
}: { 
  node: SpanNode
  selectedId: string
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  depth?: number
}) {
  const isSelected = selectedId === node.id
  const hasChildren = node.children.length > 0
  
  return (
    <div className="relative">
      {/* Indentation Lines */}
      {Array.from({ length: depth }).map((_, i) => (
        <div 
          key={i} 
          className="absolute top-0 bottom-0 w-px bg-border/50 pointer-events-none" 
          style={{ left: `${(i * 18) + 17}px` }} 
        />
      ))}

      <div 
        className={cn(
          "relative flex items-center gap-2 py-1.5 pr-3 cursor-pointer select-none group transition-all",
          isSelected ? "bg-primary/5" : "hover:bg-muted/50"
        )}
        style={{ paddingLeft: `${(depth * 18) + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {/* Active Indicator Line */}
        {isSelected && (
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r-full shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
        )}

        {/* Expand/Collapse Chevron (absolute to align nicely or inline, let's do inline) */}
        <div 
          className={cn(
            "w-4 h-4 flex items-center justify-center shrink-0 transition-transform duration-200 text-muted-foreground",
            hasChildren ? "hover:text-foreground hover:bg-muted rounded" : "opacity-0"
          )}
          onClick={(e) => { 
            if (hasChildren) {
              e.stopPropagation(); 
              onToggle(node.id); 
            }
          }}
        >
          {hasChildren && <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", node.isOpen && "rotate-90")} />}
        </div>

        <div className={cn("w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors", getIconClass(node.type, isSelected))}>
          {getIcon(node.type)}
        </div>
        
        <div className="flex-1 min-w-0 flex items-baseline justify-between gap-3">
          <div className={cn("text-[13px] font-medium truncate", isSelected ? "text-primary" : "text-foreground group-hover:text-primary transition-colors")}>
            {node.name}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground/70 shrink-0">
            {node.duration !== '—' && <span>{node.duration}</span>}
          </div>
        </div>
      </div>
      
      {node.isOpen && hasChildren && (
        <div className="animate-in slide-in-from-top-1 fade-in duration-200">
          {node.children.map(child => (
            <TreeItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function extractTraceCaseContent(events: DashboardTraceEvent[]): {
  userInput: string
  finalResponse: string
} {
  const userEvent = events.find((event) => event.type === 'user_input')
  const finalEvent = events.find((event) => event.type === 'final_response')
  return {
    userInput: userEvent ? stringifyEventContent(userEvent.content) : '',
    finalResponse: finalEvent ? stringifyEventContent(finalEvent.content) : '',
  }
}

async function downloadCsv(projectId: string, traceId: string) {
  const response = await fetch(`/api/projects/${projectId}/traces/${traceId}/export`)
  if (!response.ok) {
    console.error('CSV export failed:', response.status)
    return
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `trace_${traceId.slice(0, 8)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function stringifyEventContent(content: DashboardTraceEvent['content']): string {
  if (typeof content === 'string') return content
  if (content === null || content === undefined) return ''
  return JSON.stringify(content)
}

function AddToDatasetButton({
  projectId,
  traceId,
  userInput,
  finalResponse,
}: {
  projectId: string
  traceId: string
  userInput: string
  finalResponse: string
}) {
  const [open, setOpen] = useState(false)
  const [datasets, setDatasets] = useState<EvalDatasetSummary[]>([])
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('')
  const [caseId, setCaseId] = useState<string>(traceId)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setCaseId(traceId)
    setSubmitError(null)
    setSuccess(null)

    let isCurrent = true
    async function load() {
      setIsLoadingDatasets(true)
      setLoadError(null)
      try {
        const response = await fetch(`/api/projects/${projectId}/eval-datasets`, {
          cache: 'no-store',
        })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(typeof body === 'object' && body && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'Unable to load datasets')
        }
        if (!isCurrent) return
        const list = isEvalDatasetsResponse(body) ? body.datasets : []
        setDatasets(list)
        if (list.length > 0 && !list.some((d) => d.id === selectedDatasetId)) {
          setSelectedDatasetId(list[0].id)
        }
      } catch (error) {
        if (isCurrent) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load datasets')
        }
      } finally {
        if (isCurrent) setIsLoadingDatasets(false)
      }
    }
    load()
    return () => {
      isCurrent = false
    }
  }, [open, projectId, traceId, selectedDatasetId])

  useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  async function handleSubmit() {
    if (!selectedDatasetId) {
      setSubmitError('Pick a dataset to add this trace to.')
      return
    }
    if (!caseId.trim()) {
      setSubmitError('Case id is required.')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    setSuccess(null)

    const casePayload: Record<string, unknown> = {
      id: caseId.trim(),
      source_trace_id: traceId,
    }
    if (userInput) casePayload.input = userInput
    if (finalResponse) casePayload.expected = finalResponse

    try {
      const response = await fetch(
        `/api/projects/${projectId}/eval-datasets/${selectedDatasetId}/cases`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ case: casePayload }),
        }
      )
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(typeof body === 'object' && body && 'error' in body
          ? String((body as { error: unknown }).error)
          : 'Unable to add trace to dataset')
      }
      const datasetName = datasets.find((d) => d.id === selectedDatasetId)?.name ?? 'dataset'
      setSuccess(`Added to "${datasetName}".`)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to add trace to dataset')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ns-button !border-transparent !shadow-none !h-7 !px-2.5 !text-[11px] !bg-transparent hover:!bg-white"
      >
        <Database className="w-3 h-3" /> Dataset
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-80 rounded-md border border-border bg-background p-3 shadow-lg">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Add trace to dataset
          </div>

          <label className="mb-2 block">
            <span className="mb-1 block text-[10.5px] font-medium text-muted-foreground">Dataset</span>
            <select
              className="ns-input h-8 w-full text-[12px]"
              value={selectedDatasetId}
              onChange={(event) => setSelectedDatasetId(event.currentTarget.value)}
              disabled={isLoadingDatasets || isSubmitting}
            >
              {isLoadingDatasets ? (
                <option value="">Loading…</option>
              ) : datasets.length === 0 ? (
                <option value="">No datasets yet</option>
              ) : (
                datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name} ({dataset.caseCount ?? 0} cases)
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="mb-2 block">
            <span className="mb-1 block text-[10.5px] font-medium text-muted-foreground">Case id</span>
            <input
              className="ns-input h-8 w-full font-mono text-[12px]"
              value={caseId}
              onChange={(event) => setCaseId(event.currentTarget.value)}
              disabled={isSubmitting}
              spellCheck={false}
            />
          </label>

          <div className="mb-3 rounded-md border border-border/60 bg-secondary/30 p-2 text-[11px] text-muted-foreground">
            <div className="mb-0.5 font-medium text-foreground/80">Case preview</div>
            <div>input{userInput ? `: ${truncate(userInput, 60)}` : ': (no user_input event)'}</div>
            <div>expected{finalResponse ? `: ${truncate(finalResponse, 60)}` : ': (no final_response event)'}</div>
            <div>source_trace_id: {truncate(traceId, 32)}</div>
          </div>

          {loadError && (
            <div className="mb-2 text-[11px] text-destructive">{loadError}</div>
          )}
          {submitError && (
            <div className="mb-2 text-[11px] text-destructive">{submitError}</div>
          )}
          {success && (
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-600">
              <Check className="h-3 w-3" /> {success}
            </div>
          )}

          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-7 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              disabled={isSubmitting}
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || isLoadingDatasets || datasets.length === 0}
              className="ns-button !h-7 !px-3 !text-[11px] disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {isSubmitting ? 'Adding…' : 'Add to dataset'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function isEvalDatasetsResponse(value: unknown): value is { datasets: EvalDatasetSummary[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'datasets' in value &&
    Array.isArray((value as { datasets: unknown }).datasets)
  )
}

export function TraceInspector({
  trace,
  spans,
  toolCalls,
  events,
  projectId,
  promptLinks,
  promptVersionContent,
  promptVersionMeta,
  promptIdByLink,
}: {
  trace: DashboardTrace
  spans: DashboardSpan[]
  toolCalls: DashboardToolCall[]
  events: DashboardTraceEvent[]
  projectId: string
  promptLinks: DashboardTracePromptLink[]
  promptVersionContent: Record<string, string>
  promptVersionMeta: Record<string, { model: string | null; temperature: number | null; maxTokens: number | null }>
  promptIdByLink: Record<string, string>
}) {
  const [selectedId, setSelectedId] = useState(trace.id)
  const [activeTab, setActiveTab] = useState<'trace' | 'timeline' | 'thread'>('trace')
  const [sidePanelLink, setSidePanelLink] = useState<DashboardTracePromptLink | null>(null)

  const uniquePromptLinks = useMemo(() => dedupeLinksByVersion(promptLinks), [promptLinks])

  const tree = useMemo(() => buildTree(trace, toolCalls, events), [trace, toolCalls, events])

  const [openNodes, setOpenNodes] = useState<Set<string>>(() => {
    // initialize with root open
    return new Set([tree.id])
  })

  const findNode = (nodes: SpanNode[], id: string): SpanNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node
      const found = findNode(node.children, id)
      if (found) return found
    }
    return null
  }

  // Mutate tree open state based on openNodes set for rendering
  const applyOpenState = (node: SpanNode): SpanNode => ({
    ...node,
    isOpen: openNodes.has(node.id),
    children: node.children.map(applyOpenState)
  })

  const renderTree = applyOpenState(tree)
  const selectedNode = findNode([renderTree], selectedId) || renderTree

  const toggleNode = (id: string) => {
    setOpenNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const { userInput, finalResponse } = useMemo(() => extractTraceCaseContent(events), [events])

  return (
    <div className="flex flex-col flex-1 min-h-0 border-t border-border/80 bg-background">
      {/* Top Toolbar */}
      <div className="flex items-center gap-3 px-6 h-12 border-b border-border/80 bg-muted/10">
        <div className="flex items-center gap-1 text-muted-foreground">
          <button className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center transition-colors" aria-label="up">
            <ArrowUp className="w-4 h-4" />
          </button>
          <button className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center transition-colors" aria-label="down">
            <ArrowDown className="w-4 h-4" />
          </button>
        </div>
        
        <div className="w-px h-4 bg-border/60" />

        <div className="flex items-center gap-2 bg-muted/30 p-1 rounded-lg">
          {(['trace', 'timeline', 'thread'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "text-[12px] px-3 py-1.5 cursor-pointer rounded-md flex items-center gap-1.5 transition-all font-medium",
                activeTab === tab 
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/50" 
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              {tab === 'trace' && <ListTree className="w-3.5 h-3.5" />}
              {tab === 'timeline' && <History className="w-3.5 h-3.5" />}
              {tab === 'thread' && <MessagesSquare className="w-3.5 h-3.5" />}
              <span className="capitalize">{tab}</span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <span className="text-[12px] font-mono text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border/50">
          {trace.id.slice(0, 8)}...
        </span>

        <div className="flex items-center gap-1 text-muted-foreground">
          <button className="w-8 h-8 rounded-md hover:bg-muted hover:text-foreground flex items-center justify-center transition-colors" aria-label="copy">
            <Copy className="w-4 h-4" />
          </button>
          <button className="w-8 h-8 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center justify-center transition-colors" aria-label="close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex-1 grid grid-cols-[320px_1fr] overflow-hidden bg-muted/10">
        <div className="border-r border-border/80 overflow-y-auto bg-card/30 custom-scrollbar">
          <div className="py-2">
            <TreeItem 
              node={renderTree} 
              selectedId={selectedId} 
              onSelect={setSelectedId} 
              onToggle={toggleNode}
            />
          </div>
        </div>

        <div className="bg-background relative min-w-0 min-h-0 flex flex-col">
          {activeTab === 'trace' && selectedNode ? (
            <DetailPanel
              node={selectedNode}
              projectId={projectId}
              traceId={trace.id}
              userInput={userInput}
              finalResponse={finalResponse}
              promptLinks={uniquePromptLinks}
              onPromptBadgeClick={setSidePanelLink}
            />
          ) : activeTab === 'timeline' ? (
            <TraceDagGraph
              trace={trace}
              spans={spans}
              toolCalls={toolCalls}
              events={events}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground animate-in fade-in">
              <Sparkles className="w-8 h-8 mb-3 opacity-20" />
              <p className="text-sm">{activeTab} view coming soon</p>
            </div>
          )}
        </div>
      </div>
      {sidePanelLink ? (
        <PromptVersionSidePanel
          open
          onOpenChange={(open) => {
            if (!open) setSidePanelLink(null)
          }}
          link={sidePanelLink}
          promptId={promptIdByLink[sidePanelLink.prompt_id] ?? sidePanelLink.prompt_id}
          projectId={projectId}
          versionContent={promptVersionContent[sidePanelLink.prompt_version_id] ?? ''}
          model={promptVersionMeta[sidePanelLink.prompt_version_id]?.model ?? null}
          temperature={promptVersionMeta[sidePanelLink.prompt_version_id]?.temperature ?? null}
          maxTokens={promptVersionMeta[sidePanelLink.prompt_version_id]?.maxTokens ?? null}
          onDiffWithProdClick={handleDiffNoop}
        />
      ) : null}
    </div>
  )
}

function handleDiffNoop(_versionId: string) {
  // Phase 3 wires the DiffWithProdButton here.
}

function dedupeLinksByVersion(links: DashboardTracePromptLink[]): DashboardTracePromptLink[] {
  const seen = new Set<string>()
  const out: DashboardTracePromptLink[] = []
  for (const link of links) {
    if (seen.has(link.prompt_version_id)) continue
    seen.add(link.prompt_version_id)
    out.push(link)
  }
  return out
}

'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  Activity,
  AlertCircle,
  ArrowDownUp,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Shield,
  SkipBack,
  SkipForward,
  Square,
  Wrench,
  X,
} from 'lucide-react'
import { ModelCallRow } from '@/components/model-call-row'
import { cn } from '@/lib/utils'
import type { DashboardToolCall, DashboardTrace, DashboardTraceEvent } from '@/lib/supabase/types'

interface TraceDetailTimelineProps {
  trace: DashboardTrace
  toolCalls: DashboardToolCall[]
  events: DashboardTraceEvent[]
}

type TimelineEvent =
  | { kind: 'start'; timestamp: number }
  | { kind: 'tool'; timestamp: number; toolCall: DashboardToolCall; isError: boolean }
  | { kind: 'event'; timestamp: number; traceEvent: DashboardTraceEvent }
  | { kind: 'end'; timestamp: number; isError: boolean; error: DashboardTrace['error'] }

const TONE = {
  start: {
    bg: 'bg-[#e1f5ee]',
    border: 'border-[#9fe1cb]',
    color: 'text-[#0f6e56]',
  },
  tool: {
    bg: 'bg-[#e6f1fb]',
    border: 'border-[#85b7eb]',
    color: 'text-[#185fa5]',
  },
  error: {
    bg: 'bg-[#fcebeb]',
    border: 'border-[#f09595]',
    color: 'text-[#a32d2d]',
  },
  system: {
    bg: 'bg-[#eeedfe]',
    border: 'border-[#afa9ec]',
    color: 'text-[#534ab7]',
  },
  message: {
    bg: 'bg-[#e1f5ee]',
    border: 'border-[#9fe1cb]',
    color: 'text-[#0f6e56]',
  },
  reasoning: {
    bg: 'bg-[#faeeda]',
    border: 'border-[#fac775]',
    color: 'text-[#854f0b]',
  },
} as const

const TOOL_EVENT_TYPES = new Set(['tool_arguments', 'tool_result'])

type SortDir = 'asc' | 'desc'

const PLAYBACK_SPEEDS = [
  { label: '0.5×', ms: 2000 },
  { label: '1×', ms: 1000 },
  { label: '2×', ms: 500 },
  { label: '4×', ms: 250 },
] as const

const DEFAULT_PLAYBACK_SPEED_MS = 1000

export function TraceDetailTimeline({ trace, toolCalls, events: traceEvents }: TraceDetailTimelineProps) {
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [playbackMode, setPlaybackMode] = useState(false)
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState<number>(DEFAULT_PLAYBACK_SPEED_MS)
  const playbackListRef = useRef<HTMLDivElement | null>(null)

  const traceStartMs = new Date(trace.created_at).getTime()
  const traceEndMs = trace.ended_at ? new Date(trace.ended_at).getTime() : null
  const traceIsError = trace.status === 'error' || trace.status === 'failed'

  const events = useMemo<TimelineEvent[]>(() => {
    const collected: TimelineEvent[] = [
      { kind: 'start', timestamp: traceStartMs },
      ...toolCalls.map<TimelineEvent>((toolCall) => ({
        kind: 'tool',
        timestamp: new Date(toolCall.created_at).getTime(),
        toolCall,
        isError: toolCall.error !== null,
      })),
      ...traceEvents
        .filter((traceEvent) => !isToolPayloadEvent(traceEvent))
        .map<TimelineEvent>((traceEvent) => ({
          kind: 'event',
          timestamp: new Date(traceEvent.created_at).getTime(),
          traceEvent,
        })),
    ]

    if (traceEndMs !== null) {
      collected.push({ kind: 'end', timestamp: traceEndMs, isError: traceIsError, error: trace.error })
    }

    collected.sort((a, b) =>
      sortDir === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
    )

    return collected
  }, [toolCalls, traceEvents, traceStartMs, traceEndMs, traceIsError, trace.error, sortDir])

  useEffect(() => {
    if (!isPlaying || !playbackMode) return
    if (events.length === 0) {
      setIsPlaying(false)
      return
    }
    if (playbackIndex >= events.length - 1) {
      setIsPlaying(false)
      return
    }
    const timer = window.setTimeout(() => {
      setPlaybackIndex((current) => Math.min(current + 1, events.length - 1))
    }, playbackSpeedMs)
    return () => window.clearTimeout(timer)
  }, [isPlaying, playbackMode, playbackIndex, events.length, playbackSpeedMs])

  useEffect(() => {
    if (!playbackMode) return
    const node = playbackListRef.current?.querySelector(
      `[data-playback-index="${playbackIndex}"]`,
    ) as HTMLElement | null
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [playbackIndex, playbackMode])

  const enterPlayback = useCallback(() => {
    setPlaybackMode(true)
    setPlaybackIndex(0)
    setIsPlaying(false)
  }, [])

  const exitPlayback = useCallback(() => {
    setPlaybackMode(false)
    setIsPlaying(false)
    setPlaybackIndex(0)
  }, [])

  const togglePlay = useCallback(() => {
    if (events.length === 0) return
    if (playbackIndex >= events.length - 1) {
      setPlaybackIndex(0)
    }
    setIsPlaying((value) => !value)
  }, [playbackIndex, events.length])

  const stepPlayback = useCallback(
    (delta: number) => {
      setIsPlaying(false)
      setPlaybackIndex((current) => {
        if (events.length === 0) return 0
        return Math.max(0, Math.min(events.length - 1, current + delta))
      })
    },
    [events.length],
  )

  const resetPlayback = useCallback(() => {
    setIsPlaying(false)
    setPlaybackIndex(0)
  }, [])

  if (events.length === 0) {
    return (
      <div className="rounded-md border bg-white px-4 py-10 text-center text-xs text-muted-foreground">
        No events captured for this trace yet.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {playbackMode ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#9fe1cb] bg-[#e1f5ee] px-2.5 py-1 text-[11px] font-medium text-[#0f6e56]">
            <Play className="h-3 w-3 fill-current" />
            Replay mode
          </span>
        ) : (
          <button
            type="button"
            onClick={enterPlayback}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-[#c9c6bd] hover:text-foreground"
            aria-label="Enter replay mode"
          >
            <Play className="h-3 w-3 fill-current" />
            Replay
          </button>
        )}
        <button
          type="button"
          onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
          disabled={playbackMode}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-[#c9c6bd] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Toggle event sort order"
        >
          <ArrowDownUp className="h-3 w-3" />
          {sortDir === 'asc' ? 'Oldest → Newest' : 'Newest → Oldest'}
        </button>
      </div>
      {playbackMode && (
        <PlaybackBar
          index={playbackIndex}
          total={events.length}
          isPlaying={isPlaying}
          speedMs={playbackSpeedMs}
          onTogglePlay={togglePlay}
          onStep={stepPlayback}
          onReset={resetPlayback}
          onSpeedChange={setPlaybackSpeedMs}
          onExit={exitPlayback}
        />
      )}
      <div ref={playbackListRef}>
        {events.map((event, index) => {
          const isCurrent = playbackMode && index === playbackIndex
          const isFuture = playbackMode && index > playbackIndex
          return (
            <div
              key={`${event.kind}-${index}`}
              data-playback-index={index}
              className={cn(
                'ns-enter',
                isFuture && 'pointer-events-none opacity-30',
                isCurrent && 'rounded-lg ring-2 ring-[#1d9e75] ring-offset-2 ring-offset-background',
              )}
              style={{ animationDelay: `${0.04 * index}s` }}
            >
              <TimelineEventRow event={event} traceStartMs={traceStartMs} trace={trace} />
              {index < events.length - 1 && <div className="ml-[15px] h-2 w-px bg-border" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PlaybackBar({
  index,
  total,
  isPlaying,
  speedMs,
  onTogglePlay,
  onStep,
  onReset,
  onSpeedChange,
  onExit,
}: {
  index: number
  total: number
  isPlaying: boolean
  speedMs: number
  onTogglePlay: () => void
  onStep: (delta: number) => void
  onReset: () => void
  onSpeedChange: (ms: number) => void
  onExit: () => void
}) {
  const atStart = index <= 0
  const atEnd = index >= total - 1
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#9fe1cb] bg-[#f0faf6] px-3 py-2">
      <div className="flex items-center gap-2 text-[#0f6e56]">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1d9e75] text-white">
          <Play className="h-3 w-3 fill-current" />
        </span>
        <span className="text-[12px] font-semibold">Replay</span>
        <span className="hidden text-[11px] text-[#0f6e56]/70 sm:inline">
          · walks through captured events
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        <PlaybackIconButton onClick={onReset} ariaLabel="Reset to start" disabled={atStart}>
          <RotateCcw className="h-3.5 w-3.5" />
        </PlaybackIconButton>
        <PlaybackIconButton onClick={() => onStep(-1)} ariaLabel="Step back" disabled={atStart}>
          <SkipBack className="h-3.5 w-3.5" />
        </PlaybackIconButton>
        <PlaybackIconButton
          onClick={onTogglePlay}
          ariaLabel={isPlaying ? 'Pause replay' : 'Play replay'}
          primary
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
        </PlaybackIconButton>
        <PlaybackIconButton
          onClick={() => onStep(1)}
          ariaLabel="Step forward"
          disabled={atEnd}
        >
          <SkipForward className="h-3.5 w-3.5" />
        </PlaybackIconButton>
        <span className="ml-1 font-mono text-[11px] tabular-nums text-[#0f6e56]">
          {index + 1} / {total}
        </span>
        <select
          aria-label="Replay speed"
          value={speedMs}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
          className="ml-1 rounded border border-[#9fe1cb] bg-white px-1.5 py-1 font-mono text-[11px] text-[#0f6e56] focus:outline-none focus:ring-2 focus:ring-[#1d9e75]"
        >
          {PLAYBACK_SPEEDS.map((speed) => (
            <option key={speed.ms} value={speed.ms}>
              {speed.label}
            </option>
          ))}
        </select>
        <PlaybackIconButton onClick={onExit} ariaLabel="Exit replay">
          <X className="h-3.5 w-3.5" />
        </PlaybackIconButton>
      </div>
    </div>
  )
}

function PlaybackIconButton({
  onClick,
  ariaLabel,
  disabled = false,
  primary = false,
  children,
}: {
  onClick: () => void
  ariaLabel: string
  disabled?: boolean
  primary?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9e75] focus-visible:ring-offset-1',
        primary
          ? 'border-[#1d9e75] bg-[#1d9e75] text-white hover:bg-[#198767] disabled:cursor-not-allowed disabled:opacity-50'
          : 'border-[#9fe1cb] bg-white text-[#0f6e56] hover:border-[#1d9e75] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#9fe1cb]',
      )}
    >
      {children}
    </button>
  )
}

function TimelineEventRow({
  event,
  traceStartMs,
  trace,
}: {
  event: TimelineEvent
  traceStartMs: number
  trace: DashboardTrace
}) {
  if (event.kind === 'start') {
    return (
      <div className="flex items-start gap-3.5">
        <div className="flex w-8 shrink-0 flex-col items-center">
          <span
            className={cn(
              'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border',
              TONE.start.bg,
              TONE.start.border,
              TONE.start.color
            )}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
          </span>
        </div>
        <div className="flex-1 rounded-lg border bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-foreground">Trace started</span>
            <span className="font-mono text-[11px] text-muted-foreground">+0ms</span>
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">Run begins · waiting for first tool call</div>
          <ModelCallRow
            model={trace.model}
            inputTokens={trace.input_tokens}
            outputTokens={trace.output_tokens}
            costUsd={trace.cost_usd}
            className="mt-2"
          />
        </div>
      </div>
    )
  }

  if (event.kind === 'end') {
    return (
      <div className="flex items-start gap-3.5">
        <div className="flex w-8 shrink-0 flex-col items-center">
          <span
            className={cn(
              'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border',
              event.isError
                ? cn(TONE.error.bg, TONE.error.border, TONE.error.color)
                : cn(TONE.start.bg, TONE.start.border, TONE.start.color)
            )}
          >
            <Square className="h-3.5 w-3.5" />
          </span>
        </div>
        <div
          className={cn(
            'flex-1 rounded-lg border bg-white px-4 py-3',
            event.isError && 'border-[#f09595] bg-[#fffafa]'
          )}
        >
          <div className="flex items-center justify-between">
            <span
              className={cn(
                'text-[13px] font-medium',
                event.isError ? 'text-[#a32d2d]' : 'text-foreground'
              )}
            >
              Trace {event.isError ? 'errored' : 'completed'}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {formatOffset(event.timestamp - traceStartMs)}
            </span>
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {event.isError
              ? summarizeError(event.error) ?? 'Trace exited with an error status'
              : 'All tool calls captured cleanly'}
          </div>
        </div>
      </div>
    )
  }

  if (event.kind === 'event') {
    return <TraceEventCard traceEvent={event.traceEvent} traceStartMs={traceStartMs} />
  }

  return (
    <ToolCallCard
      toolCall={event.toolCall}
      traceStartMs={traceStartMs}
      isError={event.isError}
    />
  )
}

function TraceEventCard({
  traceEvent,
  traceStartMs,
}: {
  traceEvent: DashboardTraceEvent
  traceStartMs: number
}) {
  const [expanded, setExpanded] = useState(false)
  const offset = new Date(traceEvent.created_at).getTime() - traceStartMs
  const presentation = getEventPresentation(traceEvent.type)

  return (
    <div className="flex items-start gap-3.5">
      <div className="flex w-8 shrink-0 flex-col items-center">
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border',
            presentation.tone.bg,
            presentation.tone.border,
            presentation.tone.color
          )}
        >
          <presentation.icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex-1 cursor-pointer rounded-lg border bg-white px-4 py-3 text-left transition-colors hover:border-[#c9c6bd]"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-foreground">{presentation.label}</span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">+{formatOffset(offset)}</span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </div>
        </div>
        <MessagePreview type={traceEvent.type} content={traceEvent.content} />
        {expanded && (
          <div className="mt-3 border-t pt-3">
            <ExpandBlock label="Raw payload" value={traceEvent.content} />
          </div>
        )}
      </button>
    </div>
  )
}

function ToolCallCard({
  toolCall,
  traceStartMs,
  isError,
}: {
  toolCall: DashboardToolCall
  traceStartMs: number
  isError: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const offset = new Date(toolCall.created_at).getTime() - traceStartMs
  const invocation = useMemo(
    () => buildToolInvocation(toolCall.name, toolCall.params),
    [toolCall.name, toolCall.params],
  )
  const toggleExpanded = useCallback(() => {
    setExpanded((value) => !value)
  }, [])
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        toggleExpanded()
      }
    },
    [toggleExpanded],
  )
  const handleCopy = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      if (!invocation) return
      try {
        await navigator.clipboard.writeText(invocation)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      } catch {
        // clipboard unavailable in this environment; ignore
      }
    },
    [invocation],
  )

  return (
    <div className="flex items-start gap-3.5">
      <div className="flex w-8 shrink-0 flex-col items-center">
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border',
            isError
              ? cn(TONE.error.bg, TONE.error.border, TONE.error.color)
              : cn(TONE.tool.bg, TONE.tool.border, TONE.tool.color)
          )}
        >
          {isError ? <AlertCircle className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
        </span>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
        className={cn(
          'flex-1 cursor-pointer rounded-lg border bg-white px-4 py-3 text-left transition-colors hover:border-[#c9c6bd] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9e75] focus-visible:ring-offset-2',
          isError && 'border-[#f09595] bg-[#fffafa]'
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'text-[13px] font-medium',
              isError ? 'text-[#a32d2d]' : 'text-foreground'
            )}
          >
            Tool call —{' '}
            <code
              className={cn(
                'rounded px-1 py-0.5 font-mono text-[12px]',
                isError ? 'bg-[#fcebeb] text-[#a32d2d]' : 'bg-[#e6f1fb] text-[#185fa5]'
              )}
            >
              {toolCall.name ?? 'unnamed'}
            </code>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">+{formatOffset(offset)}</span>
            {invocation && (
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy tool invocation"
                className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-[#c9c6bd] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9e75]"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </button>
            )}
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </div>
        </div>
        <div className="mt-1.5 text-[12px] text-muted-foreground">
          <ArgSummary value={toolCall.params} />
        </div>
        {isError && (
          <div className="mt-1.5 text-[12px] text-[#a32d2d]">
            {summarizeError(toolCall.error) ?? 'Tool exited with an error status'}
          </div>
        )}
        {expanded && (
          <div className="mt-3 space-y-3 border-t pt-3">
            <ExpandBlock label="Input args" value={toolCall.params} />
            <ExpandBlock label="Output" value={toolCall.output} />
            {toolCall.error !== null && <ExpandBlock label="Error" value={toolCall.error} />}
          </div>
        )}
      </div>
    </div>
  )
}

function MessagePreview({
  type,
  content,
}: {
  type: DashboardTraceEvent['type']
  content: unknown
}) {
  const extracted = extractMessageText(type, content)

  if (extracted !== null) {
    const isLong = extracted.length > 240
    return (
      <p
        className={cn(
          'mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/85',
          isLong && 'line-clamp-4'
        )}
      >
        {extracted}
      </p>
    )
  }

  return (
    <div className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
      {summarizeContent(content)}
    </div>
  )
}

const MESSAGE_KEYS_BY_TYPE: Partial<Record<DashboardTraceEvent['type'], string[]>> = {
  user_input: ['user_input', 'input', 'text', 'message', 'content', 'prompt'],
  system_message: ['system_message', 'system', 'text', 'message', 'content', 'prompt'],
  assistant_message: ['assistant_message', 'assistant', 'text', 'message', 'content'],
  reasoning: ['reasoning', 'thought', 'text', 'message', 'content'],
  final_response: ['final_response', 'response', 'text', 'message', 'content', 'output'],
}

function extractMessageText(type: DashboardTraceEvent['type'], value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value !== 'object') return String(value)

  const keys = MESSAGE_KEYS_BY_TYPE[type]
  if (!keys || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (key in record) {
      const inner = record[key]
      if (typeof inner === 'string' && inner.trim()) return inner
      if (inner !== null && inner !== undefined && typeof inner !== 'object') return String(inner)
    }
  }

  const entries = Object.entries(record)
  if (entries.length === 1 && typeof entries[0][1] === 'string' && entries[0][1].trim()) {
    return entries[0][1] as string
  }
  return null
}

function ArgSummary({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined) {
    return <span className="font-mono text-[11px] text-[var(--ns-faint)]">no args</span>
  }
  if (typeof value === 'string') {
    const trimmed = value.length > 80 ? `${value.slice(0, 80)}…` : value
    return <span className="font-mono text-[11px] text-muted-foreground">{trimmed}</span>
  }
  if (typeof value !== 'object') {
    return <span className="font-mono text-[11px] text-muted-foreground">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground">
        [{value.length} item{value.length === 1 ? '' : 's'}]
      </span>
    )
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    return <span className="font-mono text-[11px] text-[var(--ns-faint)]">no args</span>
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {entries.slice(0, 3).map(([key, raw]) => {
        const display =
          typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : String(raw)
        const truncated = display.length > 40 ? `${display.slice(0, 40)}…` : display
        return (
          <span
            key={key}
            className="inline-block rounded border bg-[var(--ns-panel)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {key}: {truncated}
          </span>
        )
      })}
    </span>
  )
}

function ExpandBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-40 overflow-auto rounded-md border bg-[var(--ns-panel)] px-3 py-2 font-mono text-[12px] leading-relaxed text-muted-foreground">
        {formatJson(value)}
      </pre>
    </div>
  )
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function summarizeContent(value: unknown): string {
  const text = formatJson(value).replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 180)}…` : text
}

function summarizeError(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return null
  if ('message' in value && typeof value.message === 'string') return value.message
  return summarizeContent(value)
}

function buildToolInvocation(name: string | null, params: unknown): string | null {
  if (!name) return null
  if (params === null || params === undefined) {
    return `${name}()`
  }
  if (typeof params !== 'object' || Array.isArray(params)) {
    return `${name}(${JSON.stringify(params)})`
  }
  const record = params as Record<string, unknown>
  const hasArgs = 'args' in record
  const hasKwargs = 'kwargs' in record
  if (!hasArgs && !hasKwargs) {
    return `${name}(${JSON.stringify(record)})`
  }
  const args = Array.isArray(record.args) ? record.args : []
  const kwargs =
    record.kwargs !== null && typeof record.kwargs === 'object' && !Array.isArray(record.kwargs)
      ? (record.kwargs as Record<string, unknown>)
      : {}
  const argsLiteral = args.map((value) => JSON.stringify(value)).join(', ')
  const kwargsLiteral = Object.entries(kwargs)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ')
  const combined = [argsLiteral, kwargsLiteral].filter(Boolean).join(', ')
  return `${name}(${combined})`
}

function isToolPayloadEvent(traceEvent: DashboardTraceEvent): boolean {
  if (TOOL_EVENT_TYPES.has(traceEvent.type)) return true
  if (
    traceEvent.type !== 'custom'
    || typeof traceEvent.content !== 'object'
    || traceEvent.content === null
    || Array.isArray(traceEvent.content)
  ) {
    return false
  }
  return traceEvent.content.name === 'tool_arguments' || traceEvent.content.name === 'tool_result'
}

function getEventPresentation(type: DashboardTraceEvent['type']) {
  switch (type) {
    case 'system_message':
      return { label: 'System prompt', icon: Shield, tone: TONE.system }
    case 'user_input':
      return { label: 'User message', icon: MessageSquare, tone: TONE.message }
    case 'assistant_message':
      return { label: 'Assistant message', icon: MessageSquare, tone: TONE.message }
    case 'reasoning':
      return { label: 'Model reasoning', icon: Brain, tone: TONE.reasoning }
    case 'final_response':
      return { label: 'Final response', icon: CheckCircle2, tone: TONE.message }
    case 'custom':
      return { label: 'Event', icon: Activity, tone: TONE.start }
    case 'tool_arguments':
    case 'tool_result':
      return { label: 'Tool event', icon: Wrench, tone: TONE.tool }
  }
}

function formatOffset(ms: number): string {
  if (ms < 0) ms = 0
  if (ms < 1000) return `${ms}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 1000).toFixed(1)}s`
}

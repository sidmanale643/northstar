'use client'

import {
  useCallback,
  useEffect,
  useId,
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
  ArrowUp,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  History,
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
import type {
  DashboardToolCall,
  DashboardTrace,
  DashboardTraceEvent,
} from '@/lib/supabase/types'

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

type SortDir = 'asc' | 'desc'

const TONE = {
  start: { bg: 'bg-[var(--ns-green-pale)]', border: 'border-[#9fe1cb]', text: 'text-[#0f6e56]' },
  tool: { bg: 'bg-[#e6f1fb]', border: 'border-[#85b7eb]', text: 'text-[#185fa5]' },
  toolError: { bg: 'bg-[#fcebeb]', border: 'border-[#f09595]', text: 'text-[#a32d2d]' },
  error: { bg: 'bg-[#fcebeb]', border: 'border-[#f09595]', text: 'text-[#a32d2d]' },
  system: { bg: 'bg-[#eeedfe]', border: 'border-[#afa9ec]', text: 'text-[#534ab7]' },
  message: { bg: 'bg-[var(--ns-green-pale)]', border: 'border-[#9fe1cb]', text: 'text-[#0f6e56]' },
  reasoning: { bg: 'bg-[#faeeda]', border: 'border-[#fac775]', text: 'text-[#854f0b]' },
} as const

const TOOL_EVENT_TYPES = new Set<DashboardTraceEvent['type']>(['tool_arguments', 'tool_result'])

const PLAYBACK_SPEEDS = [
  { label: '0.5×', ms: 2000 },
  { label: '1×', ms: 1000 },
  { label: '2×', ms: 500 },
  { label: '4×', ms: 250 },
] as const

const DEFAULT_PLAYBACK_SPEED_MS = 1000

const STAGGER_CAP = 8

const ANCHORED_KINDS: ReadonlySet<TimelineEvent['kind']> = new Set(['start', 'end'])

export function TraceDetailTimeline({
  trace,
  toolCalls,
  events: traceEvents,
}: TraceDetailTimelineProps) {
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [replayMode, setReplayMode] = useState(false)
  const [replayIndex, setReplayIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speedMs, setSpeedMs] = useState<number>(DEFAULT_PLAYBACK_SPEED_MS)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const listRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const sliderId = useId()

  const traceStartMs = useMemo(() => new Date(trace.created_at).getTime(), [trace.created_at])
  const traceEndMs = useMemo(
    () => (trace.ended_at ? new Date(trace.ended_at).getTime() : null),
    [trace.ended_at]
  )
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

    const anchored: TimelineEvent[] = []
    const middle: TimelineEvent[] = []
    for (const ev of collected) {
      ;(ANCHORED_KINDS.has(ev.kind) ? anchored : middle).push(ev)
    }
    middle.sort((a, b) => (sortDir === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp))
    const start = anchored.find((ev) => ev.kind === 'start')
    const end = anchored.find((ev) => ev.kind === 'end')
    return [start, ...middle, end].filter(Boolean) as TimelineEvent[]
  }, [toolCalls, traceEvents, traceStartMs, traceEndMs, traceIsError, trace.error, sortDir])

  const eventKey = useCallback(
    (event: TimelineEvent, index: number): string => `${event.kind}-${index}`,
    []
  )

  useEffect(() => {
    if (!isPlaying || !replayMode) return
    if (events.length === 0) {
      setIsPlaying(false)
      return
    }
    if (replayIndex >= events.length - 1) {
      setIsPlaying(false)
      return
    }
    const timer = window.setTimeout(() => {
      setReplayIndex((current) => Math.min(current + 1, events.length - 1))
    }, speedMs)
    return () => window.clearTimeout(timer)
  }, [isPlaying, replayMode, replayIndex, events.length, speedMs])

  useEffect(() => {
    if (!replayMode) return
    const node = listRef.current?.querySelector(
      `[data-replay-index="${replayIndex}"]`
    ) as HTMLElement | null
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [replayIndex, replayMode])

  const enterReplay = useCallback(() => {
    setReplayMode(true)
    setReplayIndex(0)
    setIsPlaying(false)
  }, [])

  const exitReplay = useCallback(() => {
    setReplayMode(false)
    setIsPlaying(false)
    setReplayIndex(0)
  }, [])

  const togglePlay = useCallback(() => {
    if (events.length === 0) return
    setReplayIndex((current) => {
      if (current >= events.length - 1) return 0
      return current
    })
    setIsPlaying((value) => !value)
  }, [events.length])

  const stepReplay = useCallback(
    (delta: number) => {
      setIsPlaying(false)
      setReplayIndex((current) => {
        if (events.length === 0) return 0
        return Math.max(0, Math.min(events.length - 1, current + delta))
      })
    },
    [events.length]
  )

  const resetReplay = useCallback(() => {
    setIsPlaying(false)
    setReplayIndex(0)
  }, [])

  const jumpTo = useCallback(
    (kind: 'start' | 'end' | 'lastError') => {
      if (events.length === 0) return
      const target = (() => {
        if (kind === 'start') return 0
        if (kind === 'end') return events.length - 1
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i]
          if (ev.kind === 'end' && ev.isError) return i
          if (ev.kind === 'tool' && ev.isError) return i
        }
        return null
      })()
      if (target === null) return
      setIsPlaying(false)
      setReplayIndex(target)
      setReplayMode(true)
    },
    [events]
  )

  const toggleExpanded = useCallback((key: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  useEffect(() => {
    if (!replayMode) return
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      }
      if (event.key === ' ' || event.key === 'k' || event.key === 'K') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'ArrowRight' || event.key === 'j' || event.key === 'J' || event.key === 'l' || event.key === 'L') {
        event.preventDefault()
        stepReplay(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepReplay(-1)
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        resetReplay()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        exitReplay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [replayMode, togglePlay, stepReplay, resetReplay, exitReplay])

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-white px-4 py-10 text-center text-xs text-muted-foreground">
        No events captured for this trace yet.
      </div>
    )
  }

  const totalMs = traceEndMs !== null ? traceEndMs - traceStartMs : null
  const toolCount = toolCalls.length
  const eventCount = traceEvents.filter((e) => !TOOL_EVENT_TYPES.has(e.type)).length
  const erroredTools = toolCalls.filter((t) => t.error !== null).length

  return (
    <div className="space-y-2">
      <Toolbar
        sortDir={sortDir}
        onToggleSort={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
        replayMode={replayMode}
        onEnterReplay={enterReplay}
        onExitReplay={exitReplay}
        onJumpTo={jumpTo}
        hasError={traceIsError || erroredTools > 0}
        eventCount={eventCount}
        toolCount={toolCount}
        totalMs={totalMs}
        disabled={false}
      />
      {replayMode && (
        <ReplayControls
          index={replayIndex}
          total={events.length}
          isPlaying={isPlaying}
          speedMs={speedMs}
          onTogglePlay={togglePlay}
          onStep={stepReplay}
          onReset={resetReplay}
          onSpeedChange={setSpeedMs}
          onExit={exitReplay}
          sliderId={sliderId}
        />
      )}

      <div ref={listRef} className="relative pt-1">
        <div
          ref={railRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
          style={{ left: '15px' }}
        />
        {events.map((event, index) => {
          const isCurrent = replayMode && index === replayIndex
          const key = eventKey(event, index)
          const expanded = expandedIds.has(key)
          return (
            <div
              key={key}
              data-replay-index={index}
              className={cn(
                'ns-enter relative',
                index < events.length - 1 && 'pb-3'
              )}
              style={{
                animationDelay: `${Math.min(index, STAGGER_CAP) * 0.04}s`,
              }}
            >
              <TimelineEventRow
                event={event}
                traceStartMs={traceStartMs}
                trace={trace}
                expanded={expanded}
                isCurrent={isCurrent}
                onToggle={() => toggleExpanded(key)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Toolbar({
  sortDir,
  onToggleSort,
  replayMode,
  onEnterReplay,
  onExitReplay,
  onJumpTo,
  hasError,
  eventCount,
  toolCount,
  totalMs,
  disabled,
}: {
  sortDir: SortDir
  onToggleSort: () => void
  replayMode: boolean
  onEnterReplay: () => void
  onExitReplay: () => void
  onJumpTo: (kind: 'start' | 'end' | 'lastError') => void
  hasError: boolean
  eventCount: number
  toolCount: number
  totalMs: number | null
  disabled: boolean
}) {
  const [jumpOpen, setJumpOpen] = useState(false)
  const jumpRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!jumpOpen) return
    function onDocClick(event: MouseEvent) {
      if (!jumpRef.current) return
      if (!jumpRef.current.contains(event.target as Node)) setJumpOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [jumpOpen])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <History className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="font-mono text-[12px] tabular-nums text-foreground/80">
          {eventCount} event{eventCount === 1 ? '' : 's'} · {toolCount} tool{toolCount === 1 ? '' : 's'}
        </span>
        {totalMs !== null && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
              {formatDuration(totalMs)}
            </span>
          </>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <div ref={jumpRef} className="relative">
          <button
            type="button"
            onClick={() => setJumpOpen((v) => !v)}
            disabled={disabled}
            className="ns-button !h-7"
            aria-label="Jump to event"
            aria-expanded={jumpOpen}
          >
            <ArrowUp className="h-3 w-3" />
            Jump to
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', jumpOpen && 'rotate-180')}
            />
          </button>
          {jumpOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-border/60 bg-white shadow-lg">
              <JumpItem
                icon={<Play className="h-3 w-3" />}
                label="Trace start"
                onClick={() => {
                  onJumpTo('start')
                  setJumpOpen(false)
                }}
              />
              <JumpItem
                icon={<Square className="h-3 w-3" />}
                label="Trace end"
                onClick={() => {
                  onJumpTo('end')
                  setJumpOpen(false)
                }}
              />
              {hasError && (
                <JumpItem
                  icon={<AlertCircle className="h-3 w-3 text-[#a32d2d]" />}
                  label="Last error"
                  tone="error"
                  onClick={() => {
                    onJumpTo('lastError')
                    setJumpOpen(false)
                  }}
                />
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleSort}
          className="ns-button !h-7"
          aria-label="Toggle event sort order"
        >
          <ArrowDownUp className="h-3 w-3" />
          {sortDir === 'asc' ? 'Oldest → Newest' : 'Newest → Oldest'}
        </button>

        {replayMode ? (
          <span className="ns-pill !border-[#9fe1cb] !bg-[#e1f5ee] !text-[#0f6e56]">
            <span className="ns-live-dot inline-block h-1.5 w-1.5 rounded-full bg-[#1d9e75]" />
            Replay
          </span>
        ) : (
          <button
            type="button"
            onClick={onEnterReplay}
            className="ns-button !h-7"
            aria-label="Enter replay mode"
          >
            <Play className="h-3 w-3 fill-current" />
            Replay
          </button>
        )}
      </div>
    </div>
  )
}

function JumpItem({
  icon,
  label,
  tone = 'default',
  onClick,
}: {
  icon: ReactNode
  label: string
  tone?: 'default' | 'error'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors',
        tone === 'error'
          ? 'text-[#a32d2d] hover:bg-[#fff5f5]'
          : 'text-foreground hover:bg-secondary'
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  )
}

function ReplayControls({
  index,
  total,
  isPlaying,
  speedMs,
  onTogglePlay,
  onStep,
  onReset,
  onSpeedChange,
  onExit,
  sliderId,
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
  sliderId: string
}) {
  const atStart = index <= 0
  const atEnd = index >= total - 1
  const progressPct = total > 1 ? (index / (total - 1)) * 100 : 0

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#9fe1cb]/70 bg-[#f0faf6] px-2.5 py-1.5">
      <div className="flex items-center gap-1">
        <ReplayIconButton onClick={onReset} ariaLabel="Reset to start" disabled={atStart}>
          <RotateCcw className="h-3.5 w-3.5" />
        </ReplayIconButton>
        <ReplayIconButton onClick={() => onStep(-1)} ariaLabel="Step back" disabled={atStart}>
          <SkipBack className="h-3.5 w-3.5" />
        </ReplayIconButton>
        <ReplayIconButton onClick={onTogglePlay} ariaLabel={isPlaying ? 'Pause replay' : 'Play replay'} primary>
          {isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
        </ReplayIconButton>
        <ReplayIconButton onClick={() => onStep(1)} ariaLabel="Step forward" disabled={atEnd}>
          <SkipForward className="h-3.5 w-3.5" />
        </ReplayIconButton>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="font-mono text-[11px] tabular-nums text-[#0f6e56]">
          {index + 1}/{total}
        </span>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-[#c8ebde]">
          <div
            className="h-full bg-[#1d9e75] transition-[width] duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={index}
          onChange={(event) => {
            const next = Number(event.target.value)
            onStep(next - index)
          }}
          aria-label="Replay progress"
          className="sr-only"
        />
        <label
          htmlFor={sliderId}
          className="hidden"
          aria-hidden="true"
        />
        <select
          aria-label="Replay speed"
          value={speedMs}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
          className="h-6 rounded border border-[#9fe1cb] bg-white px-1.5 font-mono text-[11px] text-[#0f6e56] focus:outline-none focus:ring-2 focus:ring-[#1d9e75]"
        >
          {PLAYBACK_SPEEDS.map((speed) => (
            <option key={speed.ms} value={speed.ms}>
              {speed.label}
            </option>
          ))}
        </select>
      </div>

      <ReplayIconButton onClick={onExit} ariaLabel="Exit replay">
        <X className="h-3.5 w-3.5" />
      </ReplayIconButton>
    </div>
  )
}

function ReplayIconButton({
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
        'inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9e75] focus-visible:ring-offset-1',
        primary
          ? 'border-[#1d9e75] bg-[#1d9e75] text-white hover:bg-[#198767] disabled:cursor-not-allowed disabled:opacity-50'
          : 'border-[#9fe1cb] bg-white text-[#0f6e56] hover:border-[#1d9e75] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#9fe1cb]'
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
  expanded,
  isCurrent,
  onToggle,
}: {
  event: TimelineEvent
  traceStartMs: number
  trace: DashboardTrace
  expanded: boolean
  isCurrent: boolean
  onToggle: () => void
}) {
  if (event.kind === 'start') {
    return (
      <StartCard expanded={expanded} isCurrent={isCurrent} onToggle={onToggle} />
    )
  }
  if (event.kind === 'end') {
    return (
      <EndCard
        event={event}
        traceStartMs={traceStartMs}
        trace={trace}
        expanded={expanded}
        isCurrent={isCurrent}
        onToggle={onToggle}
      />
    )
  }
  if (event.kind === 'event') {
    return (
      <EventCard
        traceEvent={event.traceEvent}
        traceStartMs={traceStartMs}
        expanded={expanded}
        isCurrent={isCurrent}
        onToggle={onToggle}
      />
    )
  }
  return (
    <ToolCard
      toolCall={event.toolCall}
      traceStartMs={traceStartMs}
      isError={event.isError}
      expanded={expanded}
      isCurrent={isCurrent}
      onToggle={onToggle}
    />
  )
}

function RailIcon({
  tone,
  isCurrent,
  children,
}: {
  tone: typeof TONE[keyof typeof TONE]
  isCurrent: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-150',
        tone.bg,
        tone.border,
        tone.text,
        isCurrent && 'ring-2 ring-[#1d9e75] ring-offset-2 ring-offset-background'
      )}
    >
      {children}
    </div>
  )
}

function StartCard({
  expanded,
  isCurrent,
  onToggle,
}: {
  expanded: boolean
  isCurrent: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-start gap-3">
      <RailIcon tone={TONE.start} isCurrent={isCurrent}>
        <Play className="h-3.5 w-3.5 fill-current" />
      </RailIcon>
      <div
        className={cn(
          'flex-1 rounded-lg border border-border/60 bg-white px-4 py-3 transition-colors',
          isCurrent && 'border-[#9fe1cb]'
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-foreground">Trace started</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">+0ms</span>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">Run begins · waiting for first tool call</p>
      </div>
    </div>
  )
}

function EndCard({
  event,
  traceStartMs,
  trace,
  expanded,
  isCurrent,
  onToggle,
}: {
  event: Extract<TimelineEvent, { kind: 'end' }>
  traceStartMs: number
  trace: DashboardTrace
  expanded: boolean
  isCurrent: boolean
  onToggle: () => void
}) {
  const offset = event.timestamp - traceStartMs
  const tone = event.isError ? TONE.error : TONE.start
  return (
    <div className="flex items-start gap-3">
      <RailIcon
        tone={tone}
        isCurrent={isCurrent}
      >
        {event.isError ? (
          <AlertCircle className="h-3.5 w-3.5" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
      </RailIcon>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          'group flex-1 cursor-pointer rounded-lg border bg-white px-4 py-3 text-left transition-all hover:border-[#c9c6bd] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          event.isError
            ? 'border-[#f09595] bg-[#fffafa]'
            : 'border-border/60',
          isCurrent && !event.isError && 'border-[#9fe1cb]'
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'text-[13px] font-medium',
              event.isError ? 'text-[#a32d2d]' : 'text-foreground'
            )}
          >
            Trace {event.isError ? 'errored' : 'completed'}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              +{formatOffset(offset)}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </div>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {event.isError
            ? summarizeError(event.error) ?? 'Trace exited with an error status'
            : 'All tool calls captured cleanly'}
        </p>
        <ModelCallRow
          model={trace.model}
          inputTokens={trace.input_tokens}
          outputTokens={trace.output_tokens}
          costUsd={trace.cost_usd}
          className="mt-2"
        />
        {expanded && event.error && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <ExpandBlock label="Error" value={event.error} />
          </div>
        )}
      </button>
    </div>
  )
}

function EventCard({
  traceEvent,
  traceStartMs,
  expanded,
  isCurrent,
  onToggle,
}: {
  traceEvent: DashboardTraceEvent
  traceStartMs: number
  expanded: boolean
  isCurrent: boolean
  onToggle: () => void
}) {
  const offset = new Date(traceEvent.created_at).getTime() - traceStartMs
  const presentation = getEventPresentation(traceEvent.type)
  const extracted = extractMessageText(traceEvent.type, traceEvent.content)
  const preview = extracted ?? summarizeContent(traceEvent.content)
  const isLong = preview.length > 200

  return (
    <div className="flex items-start gap-3">
      <RailIcon tone={presentation.tone} isCurrent={isCurrent}>
        <presentation.icon className="h-3.5 w-3.5" />
      </RailIcon>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          'group flex-1 cursor-pointer rounded-lg border border-border/60 bg-white px-4 py-3 text-left transition-all hover:border-[#c9c6bd] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          isCurrent && 'border-[#9fe1cb]'
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-foreground">{presentation.label}</span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              +{formatOffset(offset)}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </div>
        </div>
        {extracted !== null ? (
          <p
            className={cn(
              'mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/85',
              isLong && !expanded && 'line-clamp-4'
            )}
          >
            {extracted}
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            {preview}
          </p>
        )}
        {expanded && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <ExpandBlock label="Raw payload" value={traceEvent.content} />
          </div>
        )}
      </button>
    </div>
  )
}

function ToolCard({
  toolCall,
  traceStartMs,
  isError,
  expanded,
  isCurrent,
  onToggle,
}: {
  toolCall: DashboardToolCall
  traceStartMs: number
  isError: boolean
  expanded: boolean
  isCurrent: boolean
  onToggle: () => void
}) {
  const [copied, setCopied] = useState(false)
  const offset = new Date(toolCall.created_at).getTime() - traceStartMs
  const invocation = useMemo(
    () => buildToolInvocation(toolCall.name, toolCall.params),
    [toolCall.name, toolCall.params]
  )
  const tone = isError ? TONE.toolError : TONE.tool

  const handleCopy = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      if (!invocation) return
      try {
        await navigator.clipboard.writeText(invocation)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      } catch {
        // clipboard unavailable in this environment
      }
    },
    [invocation]
  )

  return (
    <div className="flex items-start gap-3">
      <RailIcon tone={tone} isCurrent={isCurrent}>
        {isError ? <AlertCircle className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
      </RailIcon>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
        aria-expanded={expanded}
        className={cn(
          'group flex-1 cursor-pointer rounded-lg border bg-white px-4 py-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          isError
            ? 'border-[#f09595] bg-[#fffafa] hover:border-[#ec8787]'
            : 'border-border/60 hover:border-[#c9c6bd]',
          isCurrent && !isError && 'border-[#85b7eb]'
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-[13px] font-medium',
              isError ? 'text-[#a32d2d]' : 'text-foreground'
            )}
          >
            <span className="shrink-0">Tool call</span>
            <code
              className={cn(
                'truncate rounded px-1 py-0.5 font-mono text-[12px]',
                isError ? 'bg-[#fcebeb] text-[#a32d2d]' : 'bg-[#e6f1fb] text-[#185fa5]'
              )}
            >
              {toolCall.name ?? 'unnamed'}
            </code>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              +{formatOffset(offset)}
            </span>
            {invocation && (
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy tool invocation"
                className="inline-flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-[#c9c6bd] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </div>
        </div>
        <div className="mt-1.5 text-[12px] text-muted-foreground">
          <ArgSummary value={toolCall.params} />
        </div>
        {isError && (
          <p className="mt-1.5 text-[12px] text-[#a32d2d]">
            {summarizeError(toolCall.error) ?? 'Tool exited with an error status'}
          </p>
        )}
        {expanded && (
          <div
            className="mt-3 space-y-3 border-t border-border/60 pt-3"
            onClick={(event) => event.stopPropagation()}
          >
            <ExpandBlock label="Input args" value={toolCall.params} />
            <ExpandBlock label="Output" value={toolCall.output} />
            {toolCall.error !== null && <ExpandBlock label="Error" value={toolCall.error} />}
          </div>
        )}
      </div>
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

function extractMessageText(
  type: DashboardTraceEvent['type'],
  value: unknown
): string | null {
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
    return <span className="font-mono text-[11px] text-muted-foreground/60">no args</span>
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
    return <span className="font-mono text-[11px] text-muted-foreground/60">no args</span>
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {entries.slice(0, 3).map(([key, raw]) => {
        const display = typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : String(raw)
        const truncated = display.length > 40 ? `${display.slice(0, 40)}…` : display
        return (
          <span
            key={key}
            className="inline-block rounded border border-border/60 bg-[var(--ns-panel)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
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
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-60 overflow-auto rounded-md border border-border/60 bg-[var(--ns-panel)] px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground/85">
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
    traceEvent.type !== 'custom' ||
    typeof traceEvent.content !== 'object' ||
    traceEvent.content === null ||
    Array.isArray(traceEvent.content)
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

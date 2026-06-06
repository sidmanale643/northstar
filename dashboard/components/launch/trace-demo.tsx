'use client'

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  Code2,
  Cpu,
  GitBranch,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  TerminalSquare,
  Wrench,
} from 'lucide-react'

import { CopyButton } from './copy-button'
import {
  getLaunchSelection,
  launchTraceFixture,
  type LaunchTimelineStepKind,
} from './launch-trace-fixture'
import { buildTraceDag, formatDagDuration, type TraceDagNode } from '@/lib/trace-dag'
import styles from './launch.module.css'

type DemoTab = 'timeline' | 'graph' | 'payload'

const TABS = [
  { id: 'timeline', label: 'Timeline', icon: Clock3 },
  { id: 'graph', label: 'Graph', icon: GitBranch },
  { id: 'payload', label: 'Payload', icon: Code2 },
] satisfies Array<{ id: DemoTab; label: string; icon: typeof Clock3 }>

const PLAYBACK_SPEEDS = [
  { label: '0.5x', delayMs: 1800 },
  { label: '1x', delayMs: 900 },
  { label: '2x', delayMs: 450 },
] as const

const NODE_WIDTH = 190
const NODE_HEIGHT = 74
const GRAPH_PADDING = 44

export function TraceDemo() {
  const [activeTab, setActiveTab] = useState<DemoTab>('timeline')
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [delayMs, setDelayMs] = useState(900)
  const [selectedId, setSelectedId] = useState(launchTraceFixture.trace.id)
  const selected = getLaunchSelection(selectedId)

  useEffect(() => {
    if (!isPlaying) return

    const timer = window.setTimeout(() => {
      setPlaybackIndex((current) => {
        if (current >= launchTraceFixture.timeline.length - 1) {
          setIsPlaying(false)
          return current
        }
        const next = current + 1
        setSelectedId(launchTraceFixture.timeline[next].selectableId)
        return next
      })
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [delayMs, isPlaying, playbackIndex])

  function selectTimelineStep(index: number) {
    setIsPlaying(false)
    setPlaybackIndex(index)
    setSelectedId(launchTraceFixture.timeline[index].selectableId)
  }

  function resetPlayback() {
    setIsPlaying(false)
    setPlaybackIndex(0)
    setSelectedId(launchTraceFixture.timeline[0].selectableId)
  }

  function stepPlayback(delta: number) {
    const next = Math.max(
      0,
      Math.min(launchTraceFixture.timeline.length - 1, playbackIndex + delta),
    )
    setIsPlaying(false)
    setPlaybackIndex(next)
    setSelectedId(launchTraceFixture.timeline[next].selectableId)
  }

  function togglePlayback() {
    if (playbackIndex === launchTraceFixture.timeline.length - 1) {
      setPlaybackIndex(0)
      setSelectedId(launchTraceFixture.timeline[0].selectableId)
    }
    setIsPlaying((current) => !current)
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    else return

    event.preventDefault()
    setActiveTab(TABS[nextIndex].id)
    const tabList = event.currentTarget.closest('[role="tablist"]')
    if (!(tabList instanceof HTMLElement)) return
    tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

  return (
    <section className={styles.demoShell} aria-label="Interactive failed agent trace">
      <div className={styles.demoTopbar}>
        <div className={styles.demoIdentity}>
          <span className={styles.liveMark} aria-hidden="true" />
          <span>trace_8e7fd9b0</span>
          <span className={styles.errorPill}>error</span>
        </div>
        <dl className={styles.demoMetrics}>
          <div>
            <dt>duration</dt>
            <dd>8.42s</dd>
          </div>
          <div>
            <dt>tokens</dt>
            <dd>1,574</dd>
          </div>
          <div>
            <dt>cost</dt>
            <dd>$0.0068</dd>
          </div>
        </dl>
      </div>

      <div className={styles.demoTabs} role="tablist" aria-label="Trace views">
        {TABS.map((tab, index) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              id={`launch-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-controls={`launch-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? styles.demoTabActive : styles.demoTab}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <Icon aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
        <div className={styles.demoSelection}>
          <span>{selected.kind}</span>
          <strong>{selected.title}</strong>
        </div>
      </div>

      {activeTab === 'timeline' ? (
        <div
          id="launch-panel-timeline"
          role="tabpanel"
          aria-labelledby="launch-tab-timeline"
          className={styles.demoPanel}
        >
          <div className={styles.playbackBar}>
            <div className={styles.playbackButtons}>
              <ControlButton label="Reset replay" onClick={resetPlayback}>
                <RotateCcw aria-hidden="true" />
              </ControlButton>
              <ControlButton
                label="Previous event"
                onClick={() => stepPlayback(-1)}
                disabled={playbackIndex === 0}
              >
                <SkipBack aria-hidden="true" />
              </ControlButton>
              <button
                type="button"
                className={styles.playButton}
                onClick={togglePlayback}
                aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
              >
                {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {isPlaying ? 'Pause' : 'Replay'}
              </button>
              <ControlButton
                label="Next event"
                onClick={() => stepPlayback(1)}
                disabled={playbackIndex === launchTraceFixture.timeline.length - 1}
              >
                <SkipForward aria-hidden="true" />
              </ControlButton>
            </div>
            <label className={styles.speedControl}>
              <span>speed</span>
              <select
                value={delayMs}
                onChange={(event) => setDelayMs(Number(event.target.value))}
                aria-label="Replay speed"
              >
                {PLAYBACK_SPEEDS.map((speed) => (
                  <option key={speed.delayMs} value={speed.delayMs}>
                    {speed.label}
                  </option>
                ))}
              </select>
            </label>
            <span className={styles.stepCount}>
              {String(playbackIndex + 1).padStart(2, '0')} /{' '}
              {String(launchTraceFixture.timeline.length).padStart(2, '0')}
            </span>
          </div>

          <div className={styles.timeline}>
            {launchTraceFixture.timeline.map((step, index) => {
              const state =
                index === playbackIndex ? 'current' : index < playbackIndex ? 'past' : 'future'
              return (
                <button
                  type="button"
                  key={step.id}
                  className={styles.timelineStep}
                  data-state={state}
                  data-kind={step.kind}
                  onClick={() => selectTimelineStep(index)}
                  aria-current={index === playbackIndex ? 'step' : undefined}
                >
                  <span className={styles.timelineRail}>
                    <span className={styles.timelineIcon}>
                      <StepIcon kind={step.kind} />
                    </span>
                  </span>
                  <span className={styles.timelineCopy}>
                    <span className={styles.timelineTitleRow}>
                      <strong>{step.title}</strong>
                      <code>+{formatDagDuration(step.offsetMs)}</code>
                    </span>
                    <span>{step.summary}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {activeTab === 'graph' ? (
        <div
          id="launch-panel-graph"
          role="tabpanel"
          aria-labelledby="launch-tab-graph"
          className={styles.demoPanel}
        >
          <LaunchGraph selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      ) : null}

      {activeTab === 'payload' ? (
        <div
          id="launch-panel-payload"
          role="tabpanel"
          aria-labelledby="launch-tab-payload"
          className={styles.demoPanel}
        >
          <div className={styles.payloadHeader}>
            <div>
              <span>{selected.kind}</span>
              <strong>{selected.title}</strong>
            </div>
            <CopyButton value={JSON.stringify(selected.payload, null, 2)} label="Copy JSON" />
          </div>
          <pre className={styles.payload}>
            <code>{JSON.stringify(selected.payload, null, 2)}</code>
          </pre>
        </div>
      ) : null}
    </section>
  )
}

function LaunchGraph({
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect: (id: string) => void
}) {
  const dag = useMemo(
    () =>
      buildTraceDag({
        trace: launchTraceFixture.trace,
        spans: launchTraceFixture.spans,
        toolCalls: launchTraceFixture.toolCalls,
        events: launchTraceFixture.events,
      }),
    [],
  )
  const bounds = graphBounds(dag.nodes)
  const nodeById = new Map(dag.nodes.map((node) => [node.id, node]))

  return (
    <div className={styles.graphScroller}>
      <svg
        className={styles.graph}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        role="img"
        aria-label="Trace graph showing nested model and tool spans"
      >
        <g className={styles.graphEdges}>
          {dag.edges.map((edge) => {
            const source = nodeById.get(edge.source)
            const target = nodeById.get(edge.target)
            if (!source || !target) return null
            const startX = source.x + NODE_WIDTH / 2
            const startY = source.y + NODE_HEIGHT
            const endX = target.x + NODE_WIDTH / 2
            const endY = target.y
            const midpoint = (startY + endY) / 2
            return (
              <path
                key={edge.id}
                d={`M ${startX} ${startY} C ${startX} ${midpoint}, ${endX} ${midpoint}, ${endX} ${endY}`}
                data-kind={edge.kind}
              />
            )
          })}
        </g>
        {dag.nodes.map((node) => {
          const nodeSelectionId = node.selectableId ?? launchTraceFixture.trace.id
          const isSelected = nodeSelectionId === selectedId
          return (
            <g
              key={node.id}
              className={styles.graphNode}
              data-kind={node.kind}
              data-status={node.status}
              data-selected={isSelected ? 'true' : 'false'}
              transform={`translate(${node.x} ${node.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${node.title}, ${node.status}, ${node.metric}`}
              onClick={() => onSelect(nodeSelectionId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(nodeSelectionId)
                }
              }}
            >
              <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="12" />
              <circle cx="22" cy="24" r="9" />
              <text x="39" y="28" className={styles.graphNodeTitle}>
                {shorten(node.title, 22)}
              </text>
              <text x="16" y="51" className={styles.graphNodeSubtitle}>
                {shorten(node.subtitle, 29)}
              </text>
              <text x={NODE_WIDTH - 14} y="65" textAnchor="end" className={styles.graphNodeMetric}>
                {node.metric}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function graphBounds(nodes: TraceDagNode[]) {
  const minX = Math.min(...nodes.map((node) => node.x)) - GRAPH_PADDING
  const minY = Math.min(...nodes.map((node) => node.y)) - GRAPH_PADDING
  const maxX = Math.max(...nodes.map((node) => node.x)) + NODE_WIDTH + GRAPH_PADDING
  const maxY = Math.max(...nodes.map((node) => node.y)) + NODE_HEIGHT + GRAPH_PADDING
  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function shorten(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3)}...`
}

function StepIcon({ kind }: { kind: LaunchTimelineStepKind }) {
  switch (kind) {
    case 'input':
      return <TerminalSquare aria-hidden="true" />
    case 'model':
      return <Cpu aria-hidden="true" />
    case 'tool':
      return <Wrench aria-hidden="true" />
    case 'result':
      return <Check aria-hidden="true" />
    case 'error':
      return <AlertTriangle aria-hidden="true" />
    case 'output':
      return <Bot aria-hidden="true" />
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

function ControlButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={styles.controlButton}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </button>
  )
}

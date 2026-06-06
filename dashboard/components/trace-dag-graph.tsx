'use client'

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react'
import {
  AlertCircle,
  Check,
  Code2,
  Copy,
  Crosshair,
  Eye,
  GitBranch,
  Minimize2,
  Network,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import { buildTraceDag, formatDagDuration, summarizeDagValue, type TraceDagNode } from '@/lib/trace-dag'
import { cn } from '@/lib/utils'
import type { DashboardSpan, DashboardToolCall, DashboardTrace, DashboardTraceEvent } from '@/lib/supabase/types'

interface TraceDagGraphProps {
  trace: DashboardTrace
  spans: DashboardSpan[]
  toolCalls: DashboardToolCall[]
  events: DashboardTraceEvent[]
  selectedId: string
  onSelect: (id: string) => void
}

type Density = 'comfortable' | 'compact'

interface TraceDagNodeData extends Record<string, unknown> {
  dagNode: TraceDagNode
  density: Density
  isActive: boolean
}

type FlowNode = Node<TraceDagNodeData, 'traceDag'>

export function TraceDagGraph(props: TraceDagGraphProps) {
  return (
    <ReactFlowProvider>
      <TraceDagGraphInner {...props} />
    </ReactFlowProvider>
  )
}

function TraceDagGraphInner({
  trace,
  spans,
  toolCalls,
  events,
  selectedId,
  onSelect,
}: TraceDagGraphProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('trace-start')
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [density, setDensity] = useState<Density>('comfortable')
  const dag = useMemo(
    () => buildTraceDag({ trace, spans, toolCalls, events }),
    [trace, spans, toolCalls, events],
  )
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  useEffect(() => {
    const matchingNode = dag.nodes.find((node) => node.selectableId === selectedId || node.id === selectedId)
    if (matchingNode) setSelectedNodeId(matchingNode.id)
  }, [dag.nodes, selectedId])

  const nodes = useMemo<FlowNode[]>(
    () =>
      dag.nodes.map((dagNode) => ({
        id: dagNode.id,
        type: 'traceDag',
        position: { x: dagNode.x, y: dagNode.y },
        data: {
          dagNode,
          density,
          isActive: dagNode.id === selectedNodeId,
        },
        selected: dagNode.id === selectedNodeId,
        draggable: false,
      })),
    [dag.nodes, density, selectedNodeId],
  )

  const edges = useMemo<Edge[]>(
    () =>
      dag.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#3a4250',
        },
        style: {
          stroke: '#3a4250',
          strokeWidth: 1.25,
          strokeDasharray: edge.kind === 'fallback' ? '6 5' : undefined,
        },
      })),
    [dag.edges],
  )

  const selectedNode = dag.nodes.find((node) => node.id === selectedNodeId) ?? dag.nodes[0]

  const handleNodeClick = useCallback<NodeMouseHandler<FlowNode>>(
    (_event, node) => {
      setSelectedNodeId(node.id)
      const selectableId = node.data.dagNode.selectableId
      if (selectableId) onSelect(selectableId)
    },
    [onSelect],
  )

  const resetSelection = useCallback(() => {
    setSelectedNodeId('trace-start')
    onSelect(trace.id)
  }, [onSelect, trace.id])

  const runFitView = useCallback(() => {
    void fitView({ padding: 0.24, duration: 240 })
  }, [fitView])

  return (
    <div className="trace-dag-shell flex h-full min-h-0 text-foreground relative">
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.24 }}
          minZoom={0.25}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          className="trace-dag-flow"
        >
          <Background variant={BackgroundVariant.Dots} color="#1f2937" gap={24} size={1} />
          {showMiniMap && (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={(node) => minimapColor(node)}
              maskColor="rgb(13 17 23 / 0.7)"
              className="!bg-[#0d1117] !border !border-[#1f2937] !shadow-sm !rounded-lg overflow-hidden m-3"
            />
          )}
          <Panel position="top-left" className="m-3">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#1f2937] bg-[#0d1117]/95 p-1.5 shadow-sm backdrop-blur">
              <ToolbarButton label="Fit view" onClick={runFitView}>
                <Crosshair className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton label="Zoom in" onClick={() => void zoomIn({ duration: 160 })}>
                <Network className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton label="Zoom out" onClick={() => void zoomOut({ duration: 160 })}>
                <Minimize2 className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton label="Reset" onClick={resetSelection}>
                <X className="h-3.5 w-3.5" />
              </ToolbarButton>
              <button
                type="button"
                onClick={() => setShowMiniMap((value) => !value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors',
                  showMiniMap
                    ? 'border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]'
                    : 'border-transparent bg-transparent text-[#6b7280] hover:bg-[#11161d] hover:text-[#e5e7eb]',
                )}
              >
                <Eye className="h-3.5 w-3.5" />
                Mini map
              </button>
              <div className="w-px h-4 bg-[#1f2937] mx-1" />
              <button
                type="button"
                onClick={() => setDensity((value) => (value === 'comfortable' ? 'compact' : 'comfortable'))}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-[11px] font-medium text-[#6b7280] transition-colors hover:bg-[#11161d] hover:text-[#e5e7eb]"
              >
                {density === 'comfortable' ? 'Compact view' : 'Comfortable view'}
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>
      {selectedNode && <DagDetailPanel node={selectedNode} onClose={resetSelection} />}
    </div>
  )
}

const TraceDagNodeCard = memo(function TraceDagNodeCard({ data }: NodeProps<FlowNode>) {
  const tone = toneForNode(data.dagNode)
  const Icon = iconForNode(data.dagNode)
  const isCompact = data.density === 'compact'
  return (
    <div
      className={cn(
        'group relative rounded-md border bg-[#0d1117] font-mono shadow-sm transition-all duration-200',
        tone.surface,
        data.isActive ? tone.activeRing : tone.idleRing,
        isCompact ? 'w-[230px] px-3 py-2.5' : 'w-[260px] px-3.5 py-3',
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !rounded-full !border-0 !bg-[#3a4250] group-hover:!bg-[#22c55e] transition-colors"
      />
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'inline-block h-2 w-2 shrink-0 rounded-full ring-1 ring-inset',
            tone.dot,
          )}
        />
        <div className={cn('flex-1 truncate font-semibold', tone.title, isCompact ? 'text-[12.5px]' : 'text-[13px]')}>
          {data.dagNode.title}
        </div>
        <Icon className={cn('h-3.5 w-3.5 shrink-0 opacity-70', tone.icon)} />
      </div>
      <div className={cn('mt-1 truncate', tone.body, isCompact ? 'text-[11px]' : 'text-[11.5px]')}>
        {data.dagNode.subtitle}
      </div>
      <div className="mt-1.5 flex items-center justify-end">
        <span
          className={cn(
            'inline-flex items-center rounded-sm px-1.5 py-[1px] font-mono text-[10px] font-medium tabular-nums',
            tone.metricBadge,
          )}
        >
          {data.dagNode.metric}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !rounded-full !border-0 !bg-[#3a4250] group-hover:!bg-[#22c55e] transition-colors"
      />
    </div>
  )
})

const nodeTypes = {
  traceDag: TraceDagNodeCard,
}

function DagDetailPanel({ node, onClose }: { node: TraceDagNode; onClose: () => void }) {
  const payload = node.toolCall?.output ?? node.events[0]?.content ?? node.span?.attributes ?? node.error
  const payloadText = payload === null || payload === undefined ? '-' : JSON.stringify(payload, null, 2)

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-[#1f2937] bg-[#0d1117] text-[#e5e7eb] shadow-xl z-10">
      <div className="flex items-start justify-between gap-3 border-b border-[#1f2937] px-4 py-4">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6b7280]">
            DAG node
          </div>
          <h2 className="truncate font-mono text-lg font-semibold text-[#e5e7eb]">{node.title}</h2>
          <p className="mt-1 font-mono text-xs text-[#6b7280]">{node.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#6b7280] transition-colors hover:bg-[#11161d] hover:text-[#e5e7eb]"
          aria-label="Close node details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Kind" value={node.kind} />
          <Metric label="Status" value={node.status} />
          <Metric label="Offset" value={`+${formatDagDuration(node.offsetMs)}`} />
          <Metric label="Duration" value={formatDagDuration(node.durationMs)} />
        </div>
        {node.span && (
          <InfoBlock
            title="Span"
            rows={[
              ['id', node.span.id],
              ['parent', node.span.parent_span_id ?? '-'],
              ['iteration', node.span.iteration === null ? '-' : String(node.span.iteration)],
            ]}
          />
        )}
        {node.toolCall && (
          <InfoBlock
            title="Tool call"
            rows={[
              ['name', node.toolCall.name],
              ['params', summarizeDagValue(node.toolCall.params, 96)],
              ['output', summarizeDagValue(node.toolCall.output, 96)],
            ]}
          />
        )}
        {node.events.length > 0 && (
          <InfoBlock
            title="Events"
            rows={node.events.slice(0, 6).map((event) => [event.type, summarizeDagValue(event.content, 96)])}
          />
        )}
        {node.error && (
          <div className="rounded-lg border border-[#7f1d1d]/60 bg-[#1a0d0d] p-3 text-xs text-[#fca5a5]">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertCircle className="h-3.5 w-3.5" />
              Error
            </div>
            {summarizeDagValue(node.error, 180)}
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-[#1f2937] bg-[#0a0e14]">
          <div className="flex items-center justify-between border-b border-[#1f2937] bg-[#11161d] px-3 py-2">
            <span className="font-mono text-[11px] font-semibold text-[#6b7280]">Payload</span>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(payloadText)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[#6b7280] transition-colors hover:bg-[#0d1117] hover:text-[#e5e7eb]"
              aria-label="Copy payload"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="max-h-72 overflow-auto bg-[#0a0e14] p-3 font-mono text-[11px] leading-5 text-[#e5e7eb]">{payloadText}</pre>
        </div>
      </div>
    </aside>
  )
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 font-mono text-[11px] font-medium text-[#6b7280] transition-colors hover:bg-[#11161d] hover:text-[#e5e7eb]"
      title={label}
    >
      {children}
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#1f2937] bg-[#0a0e14] p-3">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b7280]">{label}</div>
      <div className="mt-1 truncate font-mono text-xs font-semibold text-[#e5e7eb]">{value}</div>
    </div>
  )
}

function InfoBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-[#1f2937] bg-[#0a0e14] p-3">
      <div className="mb-2 font-mono text-[11px] font-semibold text-[#6b7280]">{title}</div>
      <div className="grid gap-1.5">
        {rows.map(([label, value]) => (
          <div key={`${label}-${value}`} className="grid grid-cols-[82px_1fr] gap-2 font-mono text-xs">
            <span className="text-[#6b7280]">{label}</span>
            <span className="min-w-0 truncate text-[#e5e7eb]">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function iconForNode(node: TraceDagNode) {
  if (node.kind === 'tool') return Wrench
  if (node.kind === 'model' || node.kind === 'agent') return Sparkles
  if (node.kind === 'workflow') return GitBranch
  if (node.kind === 'custom' || node.kind === 'event') return Eye
  if (node.kind === 'end') return node.error ? AlertCircle : Check
  if (node.kind === 'start') return Code2
  return Network
}

function toneForNode(node: TraceDagNode) {
  if (node.error || node.status === 'error') {
    return {
      surface: 'bg-[#160b0b]',
      title: 'text-[#fca5a5]',
      icon: 'text-[#ef4444]',
      body: 'text-[#fca5a5]/80',
      dot: 'bg-[#ef4444] ring-[#7f1d1d]',
      metricBadge: 'bg-[#3a0a0a] text-[#fca5a5]',
      idleRing: 'border-[#7f1d1d]/70 hover:border-[#ef4444]',
      activeRing: 'border-[#ef4444] ring-2 ring-[#ef4444]/40 shadow-[0_0_0_2px_rgba(239,68,68,0.18)]',
    }
  }
  if (node.kind === 'tool') {
    return {
      surface: 'bg-[#0d1117]',
      title: 'text-[#fca5a5]',
      icon: 'text-[#ef4444]',
      body: 'text-[#9ca3af]',
      dot: 'bg-[#ef4444] ring-[#7f1d1d]',
      metricBadge: 'bg-[#160b0b] text-[#fca5a5]',
      idleRing: 'border-[#7f1d1d]/70 hover:border-[#ef4444]',
      activeRing: 'border-[#ef4444] ring-2 ring-[#ef4444]/40 shadow-[0_0_0_2px_rgba(239,68,68,0.18)]',
    }
  }
  if (node.kind === 'model' || node.kind === 'agent' || node.kind === 'start') {
    return {
      surface: 'bg-[#0d1117]',
      title: 'text-[#fca5a5]',
      icon: 'text-[#ef4444]',
      body: 'text-[#9ca3af]',
      dot: 'bg-[#ef4444] ring-[#7f1d1d]',
      metricBadge: 'bg-[#160b0b] text-[#fca5a5]',
      idleRing: 'border-[#7f1d1d]/70 hover:border-[#ef4444]',
      activeRing: 'border-[#ef4444] ring-2 ring-[#ef4444]/40 shadow-[0_0_0_2px_rgba(239,68,68,0.18)]',
    }
  }
  if (node.kind === 'workflow' || node.kind === 'end') {
    return {
      surface: 'bg-[#0d1117]',
      title: 'text-[#fca5a5]',
      icon: 'text-[#ef4444]',
      body: 'text-[#9ca3af]',
      dot: 'bg-[#ef4444] ring-[#7f1d1d]',
      metricBadge: 'bg-[#160b0b] text-[#fca5a5]',
      idleRing: 'border-[#7f1d1d]/70 hover:border-[#ef4444]',
      activeRing: 'border-[#ef4444] ring-2 ring-[#ef4444]/40 shadow-[0_0_0_2px_rgba(239,68,68,0.18)]',
    }
  }
  return {
    surface: 'bg-[#0d1117]',
    title: 'text-[#fca5a5]',
    icon: 'text-[#ef4444]',
    body: 'text-[#9ca3af]',
    dot: 'bg-[#ef4444] ring-[#7f1d1d]',
    metricBadge: 'bg-[#160b0b] text-[#fca5a5]',
    idleRing: 'border-[#7f1d1d]/70 hover:border-[#ef4444]',
    activeRing: 'border-[#ef4444] ring-2 ring-[#ef4444]/40 shadow-[0_0_0_2px_rgba(239,68,68,0.18)]',
  }
}

function minimapColor(node: Node): string {
  const data = node.data
  if (!isTraceDagNodeData(data)) return '#6b7280'
  if (data.dagNode.error || data.dagNode.status === 'error') return '#ef4444'
  if (data.dagNode.kind === 'tool') return '#ef4444'
  if (data.dagNode.kind === 'model' || data.dagNode.kind === 'agent' || data.dagNode.kind === 'start') return '#ef4444'
  if (data.dagNode.kind === 'workflow' || data.dagNode.kind === 'end') return '#ef4444'
  return '#ef4444'
}

function isTraceDagNodeData(value: unknown): value is TraceDagNodeData {
  return (
    typeof value === 'object'
    && value !== null
    && 'dagNode' in value
    && 'density' in value
    && 'isActive' in value
  )
}

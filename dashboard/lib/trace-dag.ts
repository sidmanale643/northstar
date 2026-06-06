import type {
  DashboardSpan,
  DashboardToolCall,
  DashboardTrace,
  DashboardTraceEvent,
  Json,
} from '@/lib/supabase/types'

export type TraceDagNodeKind =
  | 'start'
  | 'end'
  | 'agent'
  | 'workflow'
  | 'model'
  | 'tool'
  | 'custom'
  | 'event'

export type TraceDagEdgeKind = 'span' | 'fallback' | 'synthetic'

export interface TraceDagNode {
  id: string
  kind: TraceDagNodeKind
  title: string
  subtitle: string
  metric: string
  status: string
  startedAt: string
  endedAt: string | null
  offsetMs: number
  durationMs: number | null
  x: number
  y: number
  span: DashboardSpan | null
  toolCall: DashboardToolCall | null
  events: DashboardTraceEvent[]
  error: Json | null
  selectableId: string | null
}

export interface TraceDagEdge {
  id: string
  source: string
  target: string
  kind: TraceDagEdgeKind
}

export interface TraceDag {
  nodes: TraceDagNode[]
  edges: TraceDagEdge[]
  hasSpanData: boolean
  hasSpanHierarchy: boolean
}

const TOOL_EVENT_TYPES = new Set(['tool_arguments', 'tool_result'])
const X_GAP = 280
const Y_GAP = 160
const START_X = 0
const START_Y = 40

export function buildTraceDag({
  trace,
  spans,
  toolCalls,
  events,
}: {
  trace: DashboardTrace
  spans: DashboardSpan[]
  toolCalls: DashboardToolCall[]
  events: DashboardTraceEvent[]
}): TraceDag {
  const traceStartMs = new Date(trace.created_at).getTime()
  const spanNodes = spans.map((span) => buildSpanNode({ span, traceStartMs, toolCalls, events }))
  const hasSpanData = spanNodes.length > 0
  const contentNodes = hasSpanData
    ? spanNodes
    : buildLegacyNodes({ traceStartMs, toolCalls, events })

  const positionedContentNodes = hasSpanData
    ? layoutSpanNodes(contentNodes)
    : layoutSequentialNodes(contentNodes)

  const startNode = buildStartNode({ trace })
  const endNode = buildEndNode({
    trace,
    traceStartMs,
    contentNodes: positionedContentNodes,
  })
  const nodes = [startNode, ...positionedContentNodes, endNode]
  const edges = hasSpanData
    ? buildSpanEdges({ nodes, spanNodes: positionedContentNodes })
    : buildSequentialEdges(nodes, 'fallback')
  const hasSpanHierarchy = edges.some((edge) => edge.kind === 'span')

  return { nodes, edges, hasSpanData, hasSpanHierarchy }
}

export function formatDagDuration(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 1000).toFixed(1)}s`
}

export function summarizeDagValue(value: unknown, maxLength = 72): string {
  if (typeof value === 'string') return truncate(value.replace(/\s+/g, ' ').trim(), maxLength)
  if (value === null || value === undefined) return '-'
  const json = JSON.stringify(value)
  if (!json) return '-'
  return truncate(json.replace(/\s+/g, ' '), maxLength)
}

function buildSpanNode({
  span,
  traceStartMs,
  toolCalls,
  events,
}: {
  span: DashboardSpan
  traceStartMs: number
  toolCalls: DashboardToolCall[]
  events: DashboardTraceEvent[]
}): TraceDagNode {
  const toolCall = span.kind === 'tool'
    ? toolCalls.find((candidate) => candidate.id === span.id) ?? null
    : null
  const spanEvents = events.filter((event) => event.span_id === span.id)
  const startedMs = new Date(span.started_at).getTime()
  const endedMs = span.ended_at ? new Date(span.ended_at).getTime() : null

  return {
    id: span.id,
    kind: span.kind,
    title: labelForSpan(span, toolCall),
    subtitle: subtitleForSpan(span, toolCall, spanEvents),
    metric: formatDagDuration(endedMs === null ? null : endedMs - startedMs),
    status: span.status,
    startedAt: span.started_at,
    endedAt: span.ended_at,
    offsetMs: Math.max(0, startedMs - traceStartMs),
    durationMs: endedMs === null ? null : Math.max(0, endedMs - startedMs),
    x: 0,
    y: 0,
    span,
    toolCall,
    events: spanEvents,
    error: span.error ?? toolCall?.error ?? null,
    selectableId: span.id,
  }
}

function buildLegacyNodes({
  traceStartMs,
  toolCalls,
  events,
}: {
  traceStartMs: number
  toolCalls: DashboardToolCall[]
  events: DashboardTraceEvent[]
}): TraceDagNode[] {
  const visibleEvents = events.filter((event) => !TOOL_EVENT_TYPES.has(event.type))
  const eventNodes = visibleEvents.map((event) => {
    const createdMs = new Date(event.created_at).getTime()
    return {
      id: event.id,
      kind: 'event' as const,
      title: labelForEvent(event),
      subtitle: summarizeDagValue(event.content),
      metric: `+${formatDagDuration(Math.max(0, createdMs - traceStartMs))}`,
      status: event.type,
      startedAt: event.created_at,
      endedAt: null,
      offsetMs: Math.max(0, createdMs - traceStartMs),
      durationMs: null,
      x: 0,
      y: 0,
      span: null,
      toolCall: null,
      events: [event],
      error: null,
      selectableId: event.id,
    }
  })
  const toolNodes = toolCalls.map((toolCall) => {
    const createdMs = new Date(toolCall.created_at).getTime()
    return {
      id: toolCall.id,
      kind: 'tool' as const,
      title: toolCall.name || 'Tool call',
      subtitle: summarizeDagValue(toolCall.params),
      metric: `+${formatDagDuration(Math.max(0, createdMs - traceStartMs))}`,
      status: toolCall.error ? 'error' : 'ok',
      startedAt: toolCall.created_at,
      endedAt: null,
      offsetMs: Math.max(0, createdMs - traceStartMs),
      durationMs: null,
      x: 0,
      y: 0,
      span: null,
      toolCall,
      events: [],
      error: toolCall.error,
      selectableId: toolCall.id,
    }
  })

  return [...eventNodes, ...toolNodes].sort((a, b) => a.offsetMs - b.offsetMs)
}

function buildStartNode({ trace }: { trace: DashboardTrace }): TraceDagNode {
  return {
    id: 'trace-start',
    kind: 'start',
    title: 'Trace start',
    subtitle: trace.name || 'Agent run begins',
    metric: '+0ms',
    status: trace.status,
    startedAt: trace.created_at,
    endedAt: null,
    offsetMs: 0,
    durationMs: null,
    x: START_X,
    y: START_Y,
    span: null,
    toolCall: null,
    events: [],
    error: null,
    selectableId: trace.id,
  }
}

function buildEndNode({
  trace,
  traceStartMs,
  contentNodes,
}: {
  trace: DashboardTrace
  traceStartMs: number
  contentNodes: TraceDagNode[]
}): TraceDagNode {
  const traceEndMs = trace.ended_at ? new Date(trace.ended_at).getTime() : null
  const lastY = contentNodes.length === 0 ? START_Y : Math.max(...contentNodes.map((node) => node.y))
  const lastX = contentNodes.length === 0
    ? START_X
    : contentNodes.reduce((latest, node) => (node.offsetMs >= latest.offsetMs ? node : latest), contentNodes[0]).x

  return {
    id: 'trace-end',
    kind: 'end',
    title: isErrorStatus(trace.status) ? 'Error' : 'Done',
    subtitle: isErrorStatus(trace.status) ? summarizeDagValue(trace.error, 56) : 'Trace completed',
    metric: traceEndMs === null ? 'running' : `+${formatDagDuration(Math.max(0, traceEndMs - traceStartMs))}`,
    status: trace.status,
    startedAt: trace.ended_at ?? trace.created_at,
    endedAt: trace.ended_at,
    offsetMs: traceEndMs === null ? 0 : Math.max(0, traceEndMs - traceStartMs),
    durationMs: null,
    x: lastX,
    y: lastY + Y_GAP,
    span: null,
    toolCall: null,
    events: [],
    error: trace.error,
    selectableId: trace.id,
  }
}

function layoutSequentialNodes(nodes: TraceDagNode[]): TraceDagNode[] {
  return nodes.map((node, index) => ({
    ...node,
    x: START_X + (index % 2 === 0 ? -X_GAP / 4 : X_GAP / 4),
    y: START_Y + Y_GAP * (index + 1),
  }))
}

function layoutSpanNodes(nodes: TraceDagNode[]): TraceDagNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const childrenByParent = new Map<string, TraceDagNode[]>()
  for (const node of nodes) {
    const parentId = node.span?.parent_span_id
    if (!parentId || !byId.has(parentId)) continue
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(node)
    childrenByParent.set(parentId, siblings)
  }
  for (const siblings of Array.from(childrenByParent.values())) {
    siblings.sort((a, b) => a.offsetMs - b.offsetMs)
  }

  const roots = nodes
    .filter((node) => !node.span?.parent_span_id || !byId.has(node.span.parent_span_id))
    .sort((a, b) => a.offsetMs - b.offsetMs)
  const rowById = new Map<string, number>()
  const visit = (node: TraceDagNode, depth: number): void => {
    const existing = rowById.get(node.id)
    if (existing !== undefined && existing >= depth) return
    rowById.set(node.id, depth)
    for (const child of childrenByParent.get(node.id) ?? []) visit(child, depth + 1)
  }
  roots.forEach((root) => visit(root, 1))
  for (const node of nodes) {
    if (!rowById.has(node.id)) rowById.set(node.id, 1)
  }

  const colsByRow = new Map<number, TraceDagNode[]>()
  for (const node of [...nodes].sort((a, b) => a.offsetMs - b.offsetMs)) {
    const depth = rowById.get(node.id) ?? 1
    const depthNodes = colsByRow.get(depth) ?? []
    depthNodes.push(node)
    colsByRow.set(depth, depthNodes)
  }

  return nodes.map((node) => {
    const depth = rowById.get(node.id) ?? 1
    const depthNodes = colsByRow.get(depth) ?? [node]
    const col = depthNodes.findIndex((candidate) => candidate.id === node.id)
    return {
      ...node,
      x: START_X + col * X_GAP - ((depthNodes.length - 1) * X_GAP) / 2,
      y: START_Y + Y_GAP * depth,
    }
  })
}

function buildSpanEdges({
  nodes,
  spanNodes,
}: {
  nodes: TraceDagNode[]
  spanNodes: TraceDagNode[]
}): TraceDagEdge[] {
  if (spanNodes.length === 0) return buildSequentialEdges(nodes, 'fallback')

  const nodeIds = new Set(nodes.map((node) => node.id))
  const spanEdges: TraceDagEdge[] = []
  const roots: TraceDagNode[] = []
  for (const node of spanNodes) {
    const parentId = node.span?.parent_span_id
    if (parentId && nodeIds.has(parentId)) {
      spanEdges.push({
        id: `edge-${parentId}-${node.id}`,
        source: parentId,
        target: node.id,
        kind: 'span',
      })
    } else {
      roots.push(node)
    }
  }

  const startEdges = roots
    .sort((a, b) => a.offsetMs - b.offsetMs)
    .map((root) => ({
      id: `edge-trace-start-${root.id}`,
      source: 'trace-start',
      target: root.id,
      kind: 'synthetic' as const,
    }))
  const leaves = spanNodes.filter((node) => !spanEdges.some((edge) => edge.source === node.id))
  const endSourceNodes = leaves.length > 0 ? leaves : roots
  const endEdges = endSourceNodes.map((node) => ({
    id: `edge-${node.id}-trace-end`,
    source: node.id,
    target: 'trace-end',
    kind: 'synthetic' as const,
  }))

  return [...startEdges, ...spanEdges, ...endEdges]
}

function buildSequentialEdges(nodes: TraceDagNode[], kind: TraceDagEdgeKind): TraceDagEdge[] {
  return nodes.slice(0, -1).map((node, index) => {
    const target = nodes[index + 1]
    return {
      id: `edge-${node.id}-${target.id}`,
      source: node.id,
      target: target.id,
      kind,
    }
  })
}

function labelForSpan(span: DashboardSpan, toolCall: DashboardToolCall | null): string {
  if (span.kind === 'tool') return toolCall?.name || span.name || 'Tool call'
  if (span.kind === 'model') return span.name || 'Model'
  if (span.kind === 'workflow') return span.name || 'Workflow'
  if (span.kind === 'agent') return span.name || 'Agent'
  return span.name || 'Custom'
}

function subtitleForSpan(
  span: DashboardSpan,
  toolCall: DashboardToolCall | null,
  events: DashboardTraceEvent[]
): string {
  if (toolCall) {
    if (toolCall.error) return summarizeDagValue(toolCall.error)
    if (toolCall.output) return summarizeDagValue(toolCall.output)
    return summarizeDagValue(toolCall.params)
  }
  const event = events.find((candidate) => candidate.type === 'reasoning')
    ?? events.find((candidate) => candidate.type === 'assistant_message')
    ?? events[0]
  if (event) return summarizeDagValue(event.content)
  return span.kind
}

function labelForEvent(event: DashboardTraceEvent): string {
  switch (event.type) {
    case 'user_input':
      return 'User input'
    case 'system_message':
      return 'System message'
    case 'assistant_message':
      return 'Assistant message'
    case 'reasoning':
      return 'Think'
    case 'final_response':
      return 'Final response'
    case 'custom':
      return 'Observe'
    case 'tool_arguments':
    case 'tool_result':
      return 'Tool event'
  }
}

function isErrorStatus(status: string): boolean {
  return status === 'error' || status === 'failed'
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}

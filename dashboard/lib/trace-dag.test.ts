import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTraceDag } from '@/lib/trace-dag'
import type {
  DashboardSpan,
  DashboardToolCall,
  DashboardTrace,
  DashboardTraceEvent,
} from '@/lib/supabase/types'
import { launchTraceFixture } from '@/components/launch/launch-trace-fixture'

const trace = {
  id: 'trace-1',
  session_id: 'session-1',
  run_id: 'trace-1',
  created_at: '2026-06-05T10:00:00.000Z',
  ended_at: '2026-06-05T10:00:06.000Z',
  name: 'Agent run',
  status: 'ok',
  error: null,
  cost_usd: '0.0100',
  input_tokens: 10,
  output_tokens: 20,
  model: 'gpt-test',
} satisfies DashboardTrace

test('builds parent and child span edges with synthetic start and end nodes', () => {
  const spans = [
    span({ id: 'root', kind: 'agent', name: 'Think', startedAt: '2026-06-05T10:00:00.100Z' }),
    span({ id: 'tool', parentSpanId: 'root', kind: 'tool', name: 'web_search', startedAt: '2026-06-05T10:00:01.000Z' }),
  ]

  const dag = buildTraceDag({ trace, spans, toolCalls: [], events: [] })

  assert.equal(dag.hasSpanData, true)
  assert.deepEqual(
    dag.edges.map((edge) => [edge.source, edge.target, edge.kind]),
    [
      ['trace-start', 'root', 'synthetic'],
      ['root', 'tool', 'span'],
      ['tool', 'trace-end', 'synthetic'],
    ],
  )
})

test('keeps top-level spans as span data when they have no parent links', () => {
  const spans = [
    span({ id: 'a', kind: 'model', name: 'Think', startedAt: '2026-06-05T10:00:00.100Z' }),
    span({ id: 'b', kind: 'tool', name: 'bash', startedAt: '2026-06-05T10:00:01.000Z' }),
  ]

  const dag = buildTraceDag({ trace, spans, toolCalls: [], events: [] })

  assert.equal(dag.hasSpanData, true)
  assert.equal(dag.hasSpanHierarchy, false)
  assert.deepEqual(
    dag.edges.map((edge) => [edge.source, edge.target, edge.kind]),
    [
      ['trace-start', 'a', 'synthetic'],
      ['trace-start', 'b', 'synthetic'],
      ['a', 'trace-end', 'synthetic'],
      ['b', 'trace-end', 'synthetic'],
    ],
  )
})

test('attaches tool calls and events to matching span nodes', () => {
  const spans = [
    span({ id: 'root', kind: 'agent', name: 'Think', startedAt: '2026-06-05T10:00:00.100Z' }),
    span({ id: 'tool', parentSpanId: 'root', kind: 'tool', name: 'web_search', startedAt: '2026-06-05T10:00:01.000Z' }),
  ]
  const toolCalls = [
    toolCall({ id: 'tool', name: 'web_search', params: { q: 'async patterns' }, output: { count: 10 } }),
  ]
  const events = [
    event({ id: 'event-1', spanId: 'root', type: 'reasoning', content: 'Plan and decompose' }),
    event({ id: 'event-2', spanId: 'tool', type: 'tool_result', content: { count: 10 } }),
  ]

  const dag = buildTraceDag({ trace, spans, toolCalls, events })
  const rootNode = dag.nodes.find((node) => node.id === 'root')
  const toolNode = dag.nodes.find((node) => node.id === 'tool')

  assert.equal(rootNode?.events.length, 1)
  assert.equal(toolNode?.toolCall?.name, 'web_search')
  assert.equal(toolNode?.events.length, 1)
})

test('marks failed spans and failed traces with error metadata', () => {
  const failedTrace = {
    ...trace,
    status: 'error',
    error: { message: 'boom' },
  } satisfies DashboardTrace
  const spans = [
    span({
      id: 'broken',
      kind: 'tool',
      name: 'pytest',
      status: 'error',
      error: { message: 'tests failed' },
      startedAt: '2026-06-05T10:00:01.000Z',
    }),
  ]

  const dag = buildTraceDag({ trace: failedTrace, spans, toolCalls: [], events: [] })
  const spanNode = dag.nodes.find((node) => node.id === 'broken')
  const endNode = dag.nodes.find((node) => node.id === 'trace-end')

  assert.equal(spanNode?.status, 'error')
  assert.deepEqual(spanNode?.error, { message: 'tests failed' })
  assert.equal(endNode?.title, 'Error')
  assert.deepEqual(endNode?.error, { message: 'boom' })
})

test('renders legacy traces without spans using visible events and tool calls', () => {
  const toolCalls = [
    toolCall({ id: 'tool', name: 'bash', params: { command: 'pytest' }, output: { passed: 12 } }),
  ]
  const events = [
    event({ id: 'hidden', spanId: null, type: 'tool_arguments', content: { command: 'pytest' } }),
    event({ id: 'visible', spanId: null, type: 'reasoning', content: 'Verify output' }),
  ]

  const dag = buildTraceDag({ trace, spans: [], toolCalls, events })

  assert.equal(dag.hasSpanData, false)
  assert.equal(dag.hasSpanHierarchy, false)
  assert.deepEqual(
    dag.nodes.map((node) => node.id),
    ['trace-start', 'tool', 'visible', 'trace-end'],
  )
  assert.ok(dag.edges.every((edge) => edge.kind === 'fallback'))
})

test('builds the launch fixture hierarchy and exposes its failed refund span', () => {
  const dag = buildTraceDag(launchTraceFixture)
  const refundNode = dag.nodes.find((node) => node.title === 'issue_refund')

  assert.equal(dag.hasSpanData, true)
  assert.equal(dag.hasSpanHierarchy, true)
  assert.equal(refundNode?.status, 'error')
  assert.deepEqual(refundNode?.error, launchTraceFixture.toolCalls[1].error)
  assert.ok(
    dag.edges.some(
      (edge) =>
        edge.source === launchTraceFixture.spans[3].id &&
        edge.target === launchTraceFixture.spans[4].id &&
        edge.kind === 'span',
    ),
  )
})

function span({
  id,
  parentSpanId = null,
  kind,
  name,
  status = 'ok',
  error = null,
  startedAt,
}: {
  id: string
  parentSpanId?: string | null
  kind: DashboardSpan['kind']
  name: string
  status?: DashboardSpan['status']
  error?: DashboardSpan['error']
  startedAt: string
}): DashboardSpan {
  return {
    id,
    trace_id: 'trace-1',
    parent_span_id: parentSpanId,
    kind,
    name,
    started_at: startedAt,
    ended_at: '2026-06-05T10:00:02.000Z',
    status,
    error,
    iteration: null,
    attributes: {},
  }
}

function toolCall({
  id,
  name,
  params,
  output,
}: {
  id: string
  name: string
  params: DashboardToolCall['params']
  output: DashboardToolCall['output']
}): DashboardToolCall {
  return {
    id,
    trace_id: 'trace-1',
    name,
    params,
    output,
    error: null,
    created_at: '2026-06-05T10:00:01.100Z',
  }
}

function event({
  id,
  spanId,
  type,
  content,
}: {
  id: string
  spanId: string | null
  type: DashboardTraceEvent['type']
  content: DashboardTraceEvent['content']
}): DashboardTraceEvent {
  return {
    id,
    trace_id: 'trace-1',
    span_id: spanId,
    type,
    content,
    attributes: {},
    created_at: '2026-06-05T10:00:01.200Z',
  }
}

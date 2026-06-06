import type {
  DashboardSpan,
  DashboardToolCall,
  DashboardTrace,
  DashboardTraceEvent,
} from '@/lib/supabase/types'

export type LaunchTimelineStepKind =
  | 'input'
  | 'model'
  | 'tool'
  | 'result'
  | 'error'
  | 'output'

export interface LaunchTimelineStep {
  id: string
  kind: LaunchTimelineStepKind
  title: string
  summary: string
  offsetMs: number
  selectableId: string
}

export interface LaunchTraceFixture {
  trace: DashboardTrace
  spans: DashboardSpan[]
  toolCalls: DashboardToolCall[]
  events: DashboardTraceEvent[]
  timeline: LaunchTimelineStep[]
}

const TRACE_ID = '8e7fd9b0-45c3-4ddf-8751-8dd348c42939'
const SESSION_ID = '2a210e0d-55dc-4819-99cd-6bbf03ceaf03'
const AGENT_SPAN_ID = 'e117a6f1-af72-4a7c-95f3-352cbb97a454'
const PLAN_SPAN_ID = '734454af-22f2-4f7d-9501-d63f619b9e62'
const LOOKUP_SPAN_ID = 'c79be665-50e4-4466-871f-7f3bf8455168'
const POLICY_SPAN_ID = 'f56f640c-753b-4f7a-bd5a-a701dfbbf25d'
const REFUND_SPAN_ID = 'bdbdbcb0-b4f1-4804-bd2d-249174d5f393'
const FALLBACK_SPAN_ID = '9934a2f4-8219-4676-a0ae-c1f933bce086'

export const launchTrace = {
  id: TRACE_ID,
  session_id: SESSION_ID,
  run_id: TRACE_ID,
  created_at: '2026-06-06T09:14:22.000Z',
  ended_at: '2026-06-06T09:14:30.420Z',
  name: 'support-refund-agent',
  status: 'error',
  error: {
    type: 'ToolTimeoutError',
    message: 'issue_refund timed out after 2500ms',
    failed_span_id: REFUND_SPAN_ID,
  },
  cost_usd: '0.0068',
  input_tokens: 1248,
  output_tokens: 326,
  model: 'gpt-4.1-mini',
} satisfies DashboardTrace

export const launchSpans = [
  {
    id: AGENT_SPAN_ID,
    trace_id: TRACE_ID,
    parent_span_id: null,
    kind: 'agent',
    name: 'support-refund-agent',
    started_at: '2026-06-06T09:14:22.040Z',
    ended_at: '2026-06-06T09:14:30.390Z',
    status: 'error',
    error: {
      type: 'ToolTimeoutError',
      message: 'Refund execution failed before confirmation.',
    },
    iteration: null,
    attributes: {
      environment: 'production',
      customer_tier: 'premium',
      channel: 'web',
    },
  },
  {
    id: PLAN_SPAN_ID,
    trace_id: TRACE_ID,
    parent_span_id: AGENT_SPAN_ID,
    kind: 'model',
    name: 'plan-request',
    started_at: '2026-06-06T09:14:22.220Z',
    ended_at: '2026-06-06T09:14:23.410Z',
    status: 'ok',
    error: null,
    iteration: 1,
    attributes: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      latency_ms: 1190,
      input_tokens: 412,
      output_tokens: 88,
    },
  },
  {
    id: LOOKUP_SPAN_ID,
    trace_id: TRACE_ID,
    parent_span_id: PLAN_SPAN_ID,
    kind: 'tool',
    name: 'lookup_order',
    started_at: '2026-06-06T09:14:23.580Z',
    ended_at: '2026-06-06T09:14:24.190Z',
    status: 'ok',
    error: null,
    iteration: 1,
    attributes: {
      latency_ms: 610,
    },
  },
  {
    id: POLICY_SPAN_ID,
    trace_id: TRACE_ID,
    parent_span_id: AGENT_SPAN_ID,
    kind: 'model',
    name: 'decide-refund-policy',
    started_at: '2026-06-06T09:14:24.350Z',
    ended_at: '2026-06-06T09:14:26.060Z',
    status: 'ok',
    error: null,
    iteration: 2,
    attributes: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      latency_ms: 1710,
      input_tokens: 516,
      output_tokens: 124,
    },
  },
  {
    id: REFUND_SPAN_ID,
    trace_id: TRACE_ID,
    parent_span_id: POLICY_SPAN_ID,
    kind: 'tool',
    name: 'issue_refund',
    started_at: '2026-06-06T09:14:26.260Z',
    ended_at: '2026-06-06T09:14:28.910Z',
    status: 'error',
    error: {
      type: 'ToolTimeoutError',
      message: 'Payment provider did not respond within 2500ms.',
      retryable: true,
    },
    iteration: 1,
    attributes: {
      latency_ms: 2650,
      retry_count: 1,
    },
  },
  {
    id: FALLBACK_SPAN_ID,
    trace_id: TRACE_ID,
    parent_span_id: AGENT_SPAN_ID,
    kind: 'model',
    name: 'write-safe-fallback',
    started_at: '2026-06-06T09:14:29.110Z',
    ended_at: '2026-06-06T09:14:30.190Z',
    status: 'ok',
    error: null,
    iteration: 3,
    attributes: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      latency_ms: 1080,
      input_tokens: 320,
      output_tokens: 114,
    },
  },
] satisfies DashboardSpan[]

export const launchToolCalls = [
  {
    id: LOOKUP_SPAN_ID,
    trace_id: TRACE_ID,
    name: 'lookup_order',
    params: {
      order_id: 'ord_7842',
      customer_id: 'cus_1931',
    },
    output: {
      status: 'delivered',
      delivered_days_ago: 37,
      total_usd: 84.5,
      customer_tier: 'premium',
    },
    error: null,
    created_at: '2026-06-06T09:14:23.580Z',
  },
  {
    id: REFUND_SPAN_ID,
    trace_id: TRACE_ID,
    name: 'issue_refund',
    params: {
      order_id: 'ord_7842',
      amount_usd: 42.25,
      reason: 'premium_grace_period',
    },
    output: null,
    error: {
      type: 'ToolTimeoutError',
      message: 'Payment provider did not respond within 2500ms.',
      retryable: true,
    },
    created_at: '2026-06-06T09:14:26.260Z',
  },
] satisfies DashboardToolCall[]

export const launchEvents = [
  {
    id: '2897245c-9fd0-4b51-9525-df1827c6f07a',
    trace_id: TRACE_ID,
    span_id: AGENT_SPAN_ID,
    type: 'user_input',
    content: 'My order arrived late. Can you refund half of it?',
    attributes: { channel: 'web' },
    created_at: '2026-06-06T09:14:22.000Z',
  },
  {
    id: 'a1796256-0188-4f1a-b811-8bc06937af82',
    trace_id: TRACE_ID,
    span_id: PLAN_SPAN_ID,
    type: 'reasoning',
    content: 'I need the order date, delivery status, amount, and customer tier before applying refund policy.',
    attributes: {},
    created_at: '2026-06-06T09:14:23.310Z',
  },
  {
    id: '2ed49be2-923f-453c-b726-a4bcdb41c09e',
    trace_id: TRACE_ID,
    span_id: LOOKUP_SPAN_ID,
    type: 'tool_arguments',
    content: {
      args: [],
      kwargs: { order_id: 'ord_7842', customer_id: 'cus_1931' },
    },
    attributes: { tool_call_id: 'call_lookup_01' },
    created_at: '2026-06-06T09:14:23.580Z',
  },
  {
    id: 'c6adb154-f131-45e4-97df-6b5b65872de3',
    trace_id: TRACE_ID,
    span_id: LOOKUP_SPAN_ID,
    type: 'tool_result',
    content: {
      status: 'delivered',
      delivered_days_ago: 37,
      total_usd: 84.5,
      customer_tier: 'premium',
    },
    attributes: { tool_call_id: 'call_lookup_01' },
    created_at: '2026-06-06T09:14:24.190Z',
  },
  {
    id: 'b44de6d4-c849-4ca5-b73a-77508dc7a358',
    trace_id: TRACE_ID,
    span_id: POLICY_SPAN_ID,
    type: 'reasoning',
    content: 'The standard window has closed, but premium policy allows a 50% service recovery refund within 45 days.',
    attributes: {},
    created_at: '2026-06-06T09:14:25.920Z',
  },
  {
    id: 'b6373037-ebf4-409b-9fb7-23d7359a7364',
    trace_id: TRACE_ID,
    span_id: REFUND_SPAN_ID,
    type: 'tool_arguments',
    content: {
      args: [],
      kwargs: {
        order_id: 'ord_7842',
        amount_usd: 42.25,
        reason: 'premium_grace_period',
      },
    },
    attributes: { tool_call_id: 'call_refund_01' },
    created_at: '2026-06-06T09:14:26.260Z',
  },
  {
    id: '8f517803-58fb-4763-acd3-b02068cadba7',
    trace_id: TRACE_ID,
    span_id: REFUND_SPAN_ID,
    type: 'custom',
    content: {
      event: 'tool_error',
      type: 'ToolTimeoutError',
      message: 'Payment provider did not respond within 2500ms.',
      retryable: true,
    },
    attributes: { severity: 'error' },
    created_at: '2026-06-06T09:14:28.910Z',
  },
  {
    id: 'fb29f350-526e-499d-b7af-74f6bda045c8',
    trace_id: TRACE_ID,
    span_id: FALLBACK_SPAN_ID,
    type: 'assistant_message',
    content: 'I could not confirm the refund, so I have not told the customer it succeeded.',
    attributes: {},
    created_at: '2026-06-06T09:14:30.120Z',
  },
  {
    id: '4fe9ee8f-262d-46fb-942d-b81838dcdac9',
    trace_id: TRACE_ID,
    span_id: AGENT_SPAN_ID,
    type: 'final_response',
    content: 'I found the refund option, but the payment service did not confirm it. Please retry in a few minutes or contact support with order ord_7842.',
    attributes: { degraded: true },
    created_at: '2026-06-06T09:14:30.190Z',
  },
] satisfies DashboardTraceEvent[]

export const launchTimeline = [
  {
    id: 'step-input',
    kind: 'input',
    title: 'User input',
    summary: 'Customer asks for a partial refund.',
    offsetMs: 0,
    selectableId: launchEvents[0].id,
  },
  {
    id: 'step-plan',
    kind: 'model',
    title: 'Plan request',
    summary: 'The model decides which order facts it needs.',
    offsetMs: 220,
    selectableId: PLAN_SPAN_ID,
  },
  {
    id: 'step-lookup',
    kind: 'tool',
    title: 'lookup_order',
    summary: 'Fetch order status, amount, and customer tier.',
    offsetMs: 1580,
    selectableId: LOOKUP_SPAN_ID,
  },
  {
    id: 'step-result',
    kind: 'result',
    title: 'Order found',
    summary: 'Delivered 37 days ago to a premium customer.',
    offsetMs: 2190,
    selectableId: launchEvents[3].id,
  },
  {
    id: 'step-policy',
    kind: 'model',
    title: 'Decide refund policy',
    summary: 'Premium grace policy permits a 50% refund.',
    offsetMs: 2350,
    selectableId: POLICY_SPAN_ID,
  },
  {
    id: 'step-refund',
    kind: 'tool',
    title: 'issue_refund',
    summary: 'Request a $42.25 refund from the payment provider.',
    offsetMs: 4260,
    selectableId: REFUND_SPAN_ID,
  },
  {
    id: 'step-error',
    kind: 'error',
    title: 'Tool timeout',
    summary: 'The provider fails to respond after one retry.',
    offsetMs: 6910,
    selectableId: launchEvents[6].id,
  },
  {
    id: 'step-fallback',
    kind: 'model',
    title: 'Write safe fallback',
    summary: 'The model avoids claiming the refund succeeded.',
    offsetMs: 7110,
    selectableId: FALLBACK_SPAN_ID,
  },
  {
    id: 'step-output',
    kind: 'output',
    title: 'Final response',
    summary: 'The user gets a truthful degraded response.',
    offsetMs: 8190,
    selectableId: launchEvents[8].id,
  },
] satisfies LaunchTimelineStep[]

export const launchTraceFixture = {
  trace: launchTrace,
  spans: launchSpans,
  toolCalls: launchToolCalls,
  events: launchEvents,
  timeline: launchTimeline,
} satisfies LaunchTraceFixture

export type LaunchSelectionKind = 'trace' | 'span' | 'event'

export interface LaunchSelection {
  kind: LaunchSelectionKind
  title: string
  payload: unknown
}

export function getLaunchSelection(id: string): LaunchSelection {
  if (id === launchTrace.id) {
    return {
      kind: 'trace',
      title: launchTrace.name,
      payload: launchTrace,
    }
  }

  const event = launchEvents.find((candidate) => candidate.id === id)
  if (event) {
    return {
      kind: 'event',
      title: event.type.replaceAll('_', ' '),
      payload: event,
    }
  }

  const span = launchSpans.find((candidate) => candidate.id === id)
  if (span) {
    const toolCall = launchToolCalls.find((candidate) => candidate.id === span.id)
    const events = launchEvents.filter((candidate) => candidate.span_id === span.id)
    return {
      kind: 'span',
      title: span.name,
      payload: {
        span,
        ...(toolCall ? { tool_call: toolCall } : {}),
        events,
      },
    }
  }

  return {
    kind: 'trace',
    title: launchTrace.name,
    payload: launchTrace,
  }
}

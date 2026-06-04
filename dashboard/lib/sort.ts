export type SortDir = 'asc' | 'desc'

export type SessionsSortKey =
  | 'created_at'
  | 'duration'
  | 'trace_count'
  | 'tool_call_count'
  | 'total_cost_usd'

export type TracesSortKey =
  | 'created_at'
  | 'duration'
  | 'cost_usd'
  | 'tool_calls'
  | 'status'

export interface SortSpec<K extends string> {
  key: K
  dir: SortDir
}

export interface DashboardSessionLike {
  created_at: string
  ended_at: string | null
  trace_count: number
  tool_call_count: number
  total_cost_usd: string | number | null | undefined
}

export interface DashboardTraceLike {
  created_at: string
  ended_at: string | null
  cost_usd: string | number | null | undefined
  tool_calls: { length: number }
  status: string
}

const SESSIONS_KEYS: readonly SessionsSortKey[] = [
  'created_at',
  'duration',
  'trace_count',
  'tool_call_count',
  'total_cost_usd',
]

const TRACES_KEYS: readonly TracesSortKey[] = [
  'created_at',
  'duration',
  'cost_usd',
  'tool_calls',
  'status',
]

const SESSIONS_DEFAULT: SortSpec<SessionsSortKey> = { key: 'created_at', dir: 'desc' }
const TRACES_DEFAULT: SortSpec<TracesSortKey> = { key: 'created_at', dir: 'desc' }

function isSortDir(value: string | null | undefined): value is SortDir {
  return value === 'asc' || value === 'desc'
}

export function parseSessionsSort(
  searchParams: URLSearchParams | ReadonlyURLSearchParams
): SortSpec<SessionsSortKey> {
  return parseSort(searchParams, SESSIONS_KEYS, SESSIONS_DEFAULT)
}

export function parseTracesSort(
  searchParams: URLSearchParams | ReadonlyURLSearchParams
): SortSpec<TracesSortKey> {
  return parseSort(searchParams, TRACES_KEYS, TRACES_DEFAULT)
}

function parseSort<K extends string>(
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
  allowedKeys: readonly K[],
  fallback: SortSpec<K>
): SortSpec<K> {
  const key = searchParams.get('sort')
  const dir = searchParams.get('dir')
  if (key && (allowedKeys as readonly string[]).includes(key) && isSortDir(dir)) {
    return { key: key as K, dir }
  }
  return fallback
}

export function buildSortHref(
  pathname: string,
  currentSearchParams: URLSearchParams | ReadonlyURLSearchParams,
  next: SortSpec<string>,
  defaults: SortSpec<string>
): string {
  const params = new URLSearchParams(currentSearchParams.toString())
  const isDefault = next.key === defaults.key && next.dir === defaults.dir
  if (isDefault) {
    params.delete('sort')
    params.delete('dir')
  } else {
    params.set('sort', next.key)
    params.set('dir', next.dir)
  }
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sessionDurationMs(session: DashboardSessionLike): number | null {
  if (!session.ended_at) return null
  const ms = new Date(session.ended_at).getTime() - new Date(session.created_at).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

function traceDurationMs(trace: DashboardTraceLike): number | null {
  if (!trace.ended_at) return null
  const ms = new Date(trace.ended_at).getTime() - new Date(trace.created_at).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

function compareValues(a: number, b: number, dir: SortDir): number {
  return dir === 'asc' ? a - b : b - a
}

function nullsLast(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return compareValues(a, b, dir)
}

function compareByCreatedAtDesc(a: { created_at: string }, b: { created_at: string }): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

export function sortSessions<T extends DashboardSessionLike>(
  rows: T[],
  spec: SortSpec<SessionsSortKey>
): T[] {
  const { key, dir } = spec
  const primary = (a: T, b: T): number => {
    switch (key) {
      case 'created_at':
        return compareValues(new Date(a.created_at).getTime(), new Date(b.created_at).getTime(), dir)
      case 'duration':
        return nullsLast(sessionDurationMs(a), sessionDurationMs(b), dir)
      case 'trace_count':
        return compareValues(a.trace_count, b.trace_count, dir)
      case 'tool_call_count':
        return compareValues(a.tool_call_count, b.tool_call_count, dir)
      case 'total_cost_usd':
        return compareValues(toNumber(a.total_cost_usd), toNumber(b.total_cost_usd), dir)
    }
  }

  return [...rows].sort((a, b) => {
    const result = primary(a, b)
    if (result !== 0) return result
    return compareByCreatedAtDesc(a, b)
  })
}

export function statusRank(status: string): number {
  const normalized = status.toLowerCase()
  if (normalized === 'error' || normalized === 'failed') return 0
  if (normalized === 'running') return 1
  return 2
}

export function sortTraces<T extends DashboardTraceLike>(
  rows: T[],
  spec: SortSpec<TracesSortKey>
): T[] {
  const { key, dir } = spec
  const primary = (a: T, b: T): number => {
    switch (key) {
      case 'created_at':
        return compareValues(new Date(a.created_at).getTime(), new Date(b.created_at).getTime(), dir)
      case 'duration':
        return nullsLast(traceDurationMs(a), traceDurationMs(b), dir)
      case 'cost_usd':
        return compareValues(toNumber(a.cost_usd), toNumber(b.cost_usd), dir)
      case 'tool_calls':
        return compareValues(a.tool_calls.length, b.tool_calls.length, dir)
      case 'status': {
        const rankA = statusRank(a.status)
        const rankB = statusRank(b.status)
        return dir === 'asc' ? rankA - rankB : rankB - rankA
      }
    }
  }

  return [...rows].sort((a, b) => {
    const result = primary(a, b)
    if (result !== 0) return result
    return compareByCreatedAtDesc(a, b)
  })
}

type ReadonlyURLSearchParams = {
  get(key: string): string | null
  toString(): string
}

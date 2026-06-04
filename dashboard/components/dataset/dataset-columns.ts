import type { FreeFormRow } from '@/lib/eval-datasets'

export interface DatasetColumn {
  key: string
  width: string
}

const WIDTH_HINTS: Record<string, string> = {
  id: 'w-[160px]',
  created_at: 'w-[160px]',
  input: 'w-[260px]',
  expected: 'w-[260px]',
  metadata: 'w-[260px]',
  messages: 'w-[260px]',
  prompt: 'w-[260px]',
  response: 'w-[260px]',
  output: 'w-[260px]',
}

const DEFAULT_WIDTH = 'w-[200px]'

export function deriveColumns(rows: FreeFormRow[]): DatasetColumn[] {
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key !== '__index__') seen.add(key)
    }
  }
  const sorted = Array.from(seen).sort((a, b) => a.localeCompare(b))
  const idIdx = sorted.indexOf('id')
  if (idIdx >= 0) {
    const [id] = sorted.splice(idIdx, 1)
    sorted.unshift(id)
  }
  return sorted.map((key) => ({ key, width: WIDTH_HINTS[key] ?? DEFAULT_WIDTH }))
}

export function cellDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function cellMatches(row: FreeFormRow, key: string, query: string): boolean {
  if (!query) return true
  const value = row[key]
  if (value === null || value === undefined) return false
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase().includes(query)
  }
  try {
    return JSON.stringify(value).toLowerCase().includes(query)
  } catch {
    return false
  }
}

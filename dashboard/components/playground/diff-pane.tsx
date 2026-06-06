'use client'

import { useMemo, useState } from 'react'
import { diffLines, type Change } from 'diff'
import type { Json } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'

export interface DiffPaneVersion {
  content: string
  model: string | null
  temperature: number | null
  max_tokens: number | null
  variables: Json
}

export interface DiffPaneProps {
  baseVersion: DiffPaneVersion | null
  targetVersion: DiffPaneVersion
  baseLabel?: string
  targetLabel?: string
}

type Mode = 'text' | 'config'

export function DiffPane({
  baseVersion,
  targetVersion,
  baseLabel = 'base',
  targetLabel = 'target',
}: DiffPaneProps) {
  const [mode, setMode] = useState<Mode>('text')

  if (!baseVersion) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
        <p>No prod version to compare against. Promote a version to prod first.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 bg-white px-4 py-2">
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-secondary/30 p-0.5">
          <button
            type="button"
            onClick={() => setMode('text')}
            className={cn(
              'rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors',
              mode === 'text'
                ? 'bg-white text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Text
          </button>
          <button
            type="button"
            onClick={() => setMode('config')}
            className={cn(
              'rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors',
              mode === 'config'
                ? 'bg-white text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Config
          </button>
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
          <span className="font-mono">{baseLabel}</span>
          <span>→</span>
          <span className="font-mono">{targetLabel}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        {mode === 'text' ? (
          <TextDiffView
            oldContent={baseVersion.content}
            newContent={targetVersion.content}
            oldLabel={baseLabel}
            newLabel={targetLabel}
          />
        ) : (
          <ConfigDiffView base={baseVersion} target={targetVersion} />
        )}
      </div>
    </div>
  )
}

interface TextDiffViewProps {
  oldContent: string
  newContent: string
  oldLabel: string
  newLabel: string
}

function TextDiffView({ oldContent, newContent, oldLabel, newLabel }: TextDiffViewProps) {
  const rows = useMemo(() => buildSideBySideRows(oldContent, newContent), [oldContent, newContent])

  return (
    <div className="font-mono text-[12px] leading-[1.55]">
      <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-border/60 bg-secondary/40 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        <div className="border-r border-border/60 px-3 py-1.5">{oldLabel}</div>
        <div className="px-3 py-1.5">{newLabel}</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
          No content to diff.
        </div>
      ) : (
        rows.map((row, index) => (
          <DiffRow key={index} row={row} />
        ))
      )}
    </div>
  )
}

type RowKind = 'unchanged' | 'added' | 'removed' | 'changed'

interface SideLine {
  num: number | null
  content: string
}

interface DiffRowData {
  kind: RowKind
  left: SideLine | null
  right: SideLine | null
}

function DiffRow({ row }: { row: DiffRowData }) {
  const { left, right, kind } = row

  return (
    <div
      className={cn(
        'grid grid-cols-2',
        kind === 'changed' && 'bg-amber-50/60',
        kind === 'added' && 'bg-emerald-50/50',
        kind === 'removed' && 'bg-rose-50/50',
        kind === 'unchanged' && 'bg-white'
      )}
    >
      <div className={cn('border-r border-border/40 px-3 py-0.5', !left && 'bg-rose-50/70')}>
        {left ? (
          <div className="flex gap-3">
            <span className="w-8 shrink-0 select-none text-right text-[10px] text-muted-foreground/60">
              {left.num}
            </span>
            <span className={cn('whitespace-pre-wrap break-words', kind === 'changed' && 'text-amber-900')}>
              {left.content || ' '}
            </span>
          </div>
        ) : (
          <div className="flex gap-3">
            <span className="w-8 shrink-0 select-none text-right text-[10px] text-muted-foreground/60">
              ·
            </span>
            <span className="whitespace-pre-wrap break-words text-rose-700/70"> </span>
          </div>
        )}
      </div>
      <div className={cn('px-3 py-0.5', !right && 'bg-emerald-50/70')}>
        {right ? (
          <div className="flex gap-3">
            <span className="w-8 shrink-0 select-none text-right text-[10px] text-muted-foreground/60">
              {right.num}
            </span>
            <span className={cn('whitespace-pre-wrap break-words', kind === 'changed' && 'text-amber-900')}>
              {right.content || ' '}
            </span>
          </div>
        ) : (
          <div className="flex gap-3">
            <span className="w-8 shrink-0 select-none text-right text-[10px] text-muted-foreground/60">
              ·
            </span>
            <span className="whitespace-pre-wrap break-words text-emerald-700/70"> </span>
          </div>
        )}
      </div>
    </div>
  )
}

function buildSideBySideRows(oldContent: string, newContent: string): DiffRowData[] {
  const changes = diffLines(oldContent, newContent, { newlineIsToken: false })
  const rows: DiffRowData[] = []

  let oldLineNum = 1
  let newLineNum = 1

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]

    if (!change.added && !change.removed) {
      const lines = splitLines(change.value)
      for (const line of lines) {
        rows.push({
          kind: 'unchanged',
          left: { num: oldLineNum, content: line },
          right: { num: newLineNum, content: line },
        })
        oldLineNum += 1
        newLineNum += 1
      }
      continue
    }

    const removedLines = change.removed ? splitLines(change.value) : []
    const addedChange = change.added ? null : changes[i + 1]
    const addedLines = !change.added && addedChange?.added ? splitLines(addedChange.value) : []

    const pairCount = Math.min(removedLines.length, addedLines.length)
    for (let p = 0; p < pairCount; p++) {
      rows.push({
        kind: 'changed',
        left: { num: oldLineNum, content: removedLines[p] },
        right: { num: newLineNum, content: addedLines[p] },
      })
      oldLineNum += 1
      newLineNum += 1
    }
    for (let p = pairCount; p < removedLines.length; p++) {
      rows.push({
        kind: 'removed',
        left: { num: oldLineNum, content: removedLines[p] },
        right: null,
      })
      oldLineNum += 1
    }
    for (let p = pairCount; p < addedLines.length; p++) {
      rows.push({
        kind: 'added',
        left: null,
        right: { num: newLineNum, content: addedLines[p] },
      })
      newLineNum += 1
    }

    if (addedChange) i += 1
  }

  return rows
}

function splitLines(value: string): string[] {
  if (value === '') return []
  const stripped = value.endsWith('\n') ? value.slice(0, -1) : value
  if (stripped === '') return ['']
  return stripped.split('\n')
}

interface ConfigDiffViewProps {
  base: DiffPaneVersion
  target: DiffPaneVersion
}

function ConfigDiffView({ base, target }: ConfigDiffViewProps) {
  const entries = useMemo(
    () =>
      jsonDiff({ model: base.model, temperature: base.temperature, max_tokens: base.max_tokens, variables: base.variables }, {
        model: target.model,
        temperature: target.temperature,
        max_tokens: target.max_tokens,
        variables: target.variables,
      }),
    [base, target]
  )

  if (entries.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
        Config is identical.
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/40">
      {entries.map((entry, index) => (
        <ConfigDiffEntry key={`${entry.path.join('.')}-${index}`} entry={entry} />
      ))}
    </div>
  )
}

type JsonDiffOp = 'add' | 'remove' | 'change' | 'same'

interface JsonDiffEntry {
  op: JsonDiffOp
  path: string[]
  before: Json | undefined
  after: Json | undefined
}

function ConfigDiffEntry({ entry }: { entry: JsonDiffEntry }) {
  const pathLabel = entry.path.length > 0 ? entry.path.join('.') : 'root'
  const opMeta: Record<JsonDiffOp, { label: string; className: string }> = {
    add: { label: '+ Added', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    remove: { label: '- Removed', className: 'bg-rose-50 text-rose-700 border-rose-200' },
    change: { label: '~ Changed', className: 'bg-amber-50 text-amber-800 border-amber-200' },
    same: { label: '= Same', className: 'bg-secondary text-muted-foreground border-border' },
  }
  const meta = opMeta[entry.op]

  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 px-3 py-2 text-[12px]">
      <div className="flex flex-col gap-1.5">
        <span
          className={cn(
            'inline-flex w-fit items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
            meta.className
          )}
        >
          {meta.label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{pathLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div className="rounded-md border border-border/60 bg-rose-50/30 px-2 py-1.5">
          <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            before
          </div>
          <pre className="whitespace-pre-wrap break-words text-rose-900">
            {formatJson(entry.before)}
          </pre>
        </div>
        <div className="rounded-md border border-border/60 bg-emerald-50/30 px-2 py-1.5">
          <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            after
          </div>
          <pre className="whitespace-pre-wrap break-words text-emerald-900">
            {formatJson(entry.after)}
          </pre>
        </div>
      </div>
    </div>
  )
}

function formatJson(value: Json | undefined): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function jsonDiff(a: Json, b: Json): JsonDiffEntry[] {
  const out: JsonDiffEntry[] = []
  walk(a, b, [], out)
  return out
}

function walk(a: Json, b: Json, path: string[], out: JsonDiffEntry[]): void {
  if (deepEqual(a, b)) {
    out.push({ op: 'same', path, before: a, after: b })
    return
  }

  const aIsContainer = isContainer(a)
  const bIsContainer = isContainer(b)

  if (aIsContainer && bIsContainer && !Array.isArray(a) && !Array.isArray(b)) {
    const aRec = a as Record<string, Json | undefined>
    const bRec = b as Record<string, Json | undefined>
    const keys = new Set<string>([...Object.keys(aRec), ...Object.keys(bRec)])
    const ordered = [...keys].sort()
    for (const key of ordered) {
      const hasA = Object.prototype.hasOwnProperty.call(aRec, key)
      const hasB = Object.prototype.hasOwnProperty.call(bRec, key)
      if (hasA && hasB) {
        const av = aRec[key] ?? null
        const bv = bRec[key] ?? null
        walk(av, bv, [...path, key], out)
      } else if (hasA) {
        out.push({ op: 'remove', path: [...path, key], before: aRec[key] ?? null, after: undefined })
      } else {
        out.push({ op: 'add', path: [...path, key], before: undefined, after: bRec[key] ?? null })
      }
    }
    return
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length)
    for (let i = 0; i < max; i++) {
      if (i >= a.length) {
        out.push({ op: 'add', path: [...path, String(i)], before: undefined, after: b[i] })
      } else if (i >= b.length) {
        out.push({ op: 'remove', path: [...path, String(i)], before: a[i], after: undefined })
      } else {
        walk(a[i], b[i], [...path, String(i)], out)
      }
    }
    return
  }

  if (a === undefined) {
    out.push({ op: 'add', path, before: undefined, after: b })
    return
  }
  if (b === undefined) {
    out.push({ op: 'remove', path, before: a, after: undefined })
    return
  }
  out.push({ op: 'change', path, before: a, after: b })
}

function isContainer(value: Json): boolean {
  return typeof value === 'object' && value !== null
}

function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i] as Json, b[i] as Json)) return false
      }
      return true
    }
    const aRec = a as Record<string, Json | undefined>
    const bRec = b as Record<string, Json | undefined>
    const aKeys = Object.keys(aRec)
    const bKeys = Object.keys(bRec)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bRec, key)) return false
      if (!deepEqual(aRec[key] ?? null, bRec[key] ?? null)) return false
    }
    return true
  }
  return false
}

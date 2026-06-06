'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, Code, Database, FileJson, Info, Loader2, X } from 'lucide-react'
import Link from 'next/link'
import { DatasetRowDrawer } from '@/components/dataset/dataset-row-drawer'
import { DatasetTable } from '@/components/dataset/dataset-table'
import { DatasetToolbar } from '@/components/dataset/dataset-toolbar'
import { deriveColumns } from '@/components/dataset/dataset-columns'
import { useActiveProject } from '@/components/project-provider'
import type { FreeFormRow } from '@/lib/eval-datasets'
import type { EvalDatasetSummary, EvalRunSummary } from '@/lib/supabase/types'

interface DatasetDetailResponse {
  dataset: EvalDatasetSummary
  rows: FreeFormRow[]
  runs: EvalRunSummary[]
}

interface DatasetUpdateResponse {
  dataset: EvalDatasetSummary
  rows: FreeFormRow[]
}

export default function DatasetDetailPage({ params }: { params: { datasetId: string } }) {
  const project = useActiveProject()
  const [dataset, setDataset] = useState<EvalDatasetSummary | null>(null)
  const [rows, setRows] = useState<FreeFormRow[]>([])
  const [savedRows, setSavedRows] = useState<FreeFormRow[]>([])
  const [runs, setRuns] = useState<EvalRunSummary[]>([])
  const [pageError, setPageError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [rawContent, setRawContent] = useState<string | null>(null)
  const [isLoadingRaw, setIsLoadingRaw] = useState(false)
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const infoButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let isCurrent = true

    async function loadDataset() {
      setIsLoading(true)
      setPageError(null)

      try {
        const response = await fetch(`/api/projects/${project.id}/eval-datasets/${params.datasetId}`, {
          cache: 'no-store',
        })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(readApiError(body))

        const parsed = parseDatasetDetailResponse(body)
        if (!parsed) throw new Error('The server returned an invalid dataset response.')

        if (isCurrent) {
          setDataset(parsed.dataset)
          setRows(parsed.rows)
          setSavedRows(parsed.rows)
          setRuns(parsed.runs)
          setSelectedRowIndex(null)
        }
      } catch (error) {
        if (isCurrent) {
          setDataset(null)
          setRows([])
          setSavedRows([])
          setRuns([])
          setPageError(error instanceof Error ? error.message : 'Unable to load dataset.')
        }
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    void loadDataset()

    return () => {
      isCurrent = false
    }
  }, [params.datasetId, project.id])

  useEffect(() => {
    if (!showRaw) {
      setRawContent(null)
      return
    }

    let isCurrent = true

    async function loadRaw() {
      setIsLoadingRaw(true)
      setPageError(null)

      try {
        const response = await fetch(`/api/projects/${project.id}/eval-datasets/${params.datasetId}?raw=true`, {
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Failed to load raw dataset.')
        const text = await response.text()
        if (isCurrent) setRawContent(text)
      } catch (error) {
        if (isCurrent) {
          setRawContent(null)
          setPageError(error instanceof Error ? error.message : 'Unable to load raw dataset.')
        }
      } finally {
        if (isCurrent) setIsLoadingRaw(false)
      }
    }

    void loadRaw()

    return () => {
      isCurrent = false
    }
  }, [showRaw, params.datasetId, project.id])

  const columns = useMemo(() => deriveColumns(rows), [rows])
  const rowErrors = useMemo(() => validateRows(rows), [rows])
  const dirtyRows = useMemo(() => {
    const dirty = new Set<number>()
    const length = Math.max(rows.length, savedRows.length)
    for (let index = 0; index < length; index += 1) {
      if (!rowsEqual(rows[index], savedRows[index])) dirty.add(index)
    }
    return dirty
  }, [rows, savedRows])

  const selectedRow = selectedRowIndex === null ? null : rows[selectedRowIndex] ?? null
  const errorCount = rowErrors.size

  const handleRevert = useCallback(() => {
    setRows(savedRows)
    setSelectedRowIndex(null)
    setPageError(null)
  }, [savedRows])

  const handleSave = useCallback(async () => {
    if (rowErrors.size > 0) {
      setPageError('Fix row errors before saving.')
      return
    }

    setIsSaving(true)
    setPageError(null)

    try {
      const response = await fetch(`/api/projects/${project.id}/eval-datasets/${params.datasetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readApiError(body))

      const parsed = parseDatasetUpdateResponse(body)
      if (!parsed) throw new Error('The server returned an invalid dataset update.')

      setDataset(parsed.dataset)
      setRows(parsed.rows)
      setSavedRows(parsed.rows)
      setRawContent(null)
      setShowRaw(false)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to save dataset.')
    } finally {
      setIsSaving(false)
    }
  }, [params.datasetId, project.id, rowErrors.size, rows])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirtyRows.size > 0 && rowErrors.size === 0 && !isSaving) void handleSave()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (dirtyRows.size > 0 && !isSaving) handleRevert()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dirtyRows.size, handleRevert, handleSave, isSaving, rowErrors.size])

  const updateCell = (rowIndex: number, key: string, value: string) => {
    setRows((current) =>
      current.map((row, index) => (index === rowIndex ? { ...row, [key]: parseScalar(value) } : row))
    )
  }

  const updateRow = (rowIndex: number, nextRow: FreeFormRow) => {
    setRows((current) => current.map((row, index) => (index === rowIndex ? nextRow : row)))
  }

  const addRow = () => {
    const nextRow: FreeFormRow = { id: newRowId() }
    setRows((current) => [...current, nextRow])
    setSelectedRowIndex(rows.length)
  }

  const deleteRow = (rowIndex: number) => {
    setRows((current) => current.filter((_, index) => index !== rowIndex))
    setSelectedRowIndex((current) => {
      if (current === null) return null
      if (current === rowIndex) return null
      if (current > rowIndex) return current - 1
      return current
    })
  }

  return (
    <div className="ns-enter relative flex min-h-[740px] flex-col overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${project.id}/datasets`}
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Datasets
          </Link>
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileJson className="h-5 w-5 text-[#1D9E75]" />
            {dataset?.name ?? 'Dataset'}
          </div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {dataset?.fileName ?? params.datasetId}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-4">
          <MetaItem label="Format" value={dataset?.fileFormat ?? '-'} />
          <MetaItem label="Rows" value={dataset?.caseCount === null || dataset?.caseCount === undefined ? String(rows.length) : String(dataset.caseCount)} />
          <MetaItem label="Size" value={dataset ? formatBytes(dataset.byteSize) : '-'} />
          <MetaItem label="Runs" value={String(runs.length)} />
          </div>
          <button
            ref={infoButtonRef}
            onClick={() => setShowInfo((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dataset info"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      </div>

      {pageError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2.5 text-sm text-red-700">
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            {pageError}
          </span>
        </div>
      )}

      <DatasetToolbar
        projectId={project.id}
        datasetId={params.datasetId}
        rowCount={rows.length}
        dirtyCount={dirtyRows.size}
        errorCount={errorCount}
        searchQuery={searchQuery}
        showRaw={showRaw}
        isSaving={isSaving}
        canSave={dirtyRows.size > 0 && errorCount === 0 && !isLoading}
        onSearchChange={setSearchQuery}
        onToggleRaw={() => setShowRaw((current) => !current)}
        onAddRow={addRow}
        onRevert={handleRevert}
        onSave={() => void handleSave()}
      />

      {showRaw && (
        <div className="border-b border-border bg-white">
          {isLoadingRaw ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading raw content...
            </div>
          ) : rawContent !== null ? (
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-foreground">
              {rawContent}
            </pre>
          ) : null}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden">
        <main className="min-h-0 overflow-auto">
          {isLoading ? (
            <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading dataset...
            </div>
          ) : (
            <DatasetTable
              rows={rows}
              columns={columns}
              searchQuery={searchQuery}
              dirtyRows={dirtyRows}
              rowErrors={rowErrors}
              onAddRow={addRow}
              onOpenRow={setSelectedRowIndex}
              onDeleteRow={deleteRow}
              onCellChange={updateCell}
            />
          )}
        </main>
      </div>

      {showInfo && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowInfo(false)}
          />
          <div className="absolute right-4 top-[72px] z-50 w-72 rounded-lg border bg-white p-4 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Database className="h-4 w-4 text-[#1D9E75]" />
                Dataset Info
              </div>
              <button
                onClick={() => setShowInfo(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="space-y-3">
                <MetaItem label="Created" value={dataset ? formatDate(dataset.createdAt) : '-'} />
                <MetaItem label="Columns" value={String(columns.length)} />
                <MetaItem label="Changed" value={String(dirtyRows.size)} />
              </div>

              <div className="border-t pt-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Code className="h-4 w-4 text-[#1D9E75]" />
                  Runs
                </div>
                {runs.length > 0 ? (
                  <div className="space-y-2">
                    {runs.slice(0, 6).map((run) => (
                      <Link
                        key={run.id}
                        href={`/projects/${project.id}/evals/${params.datasetId}`}
                        className="block rounded-md border border-border bg-secondary/50 px-3 py-2 transition-colors hover:bg-secondary"
                        onClick={() => setShowInfo(false)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs text-foreground">{run.status}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{formatDate(run.createdAt)}</span>
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {run.passedCases}/{run.evaluatedCases} passed
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center text-xs text-muted-foreground">No eval runs yet</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <DatasetRowDrawer
        row={selectedRow}
        rowIndex={selectedRowIndex}
        columns={columns}
        error={selectedRowIndex === null ? null : rowErrors.get(selectedRowIndex) ?? null}
        onClose={() => setSelectedRowIndex(null)}
        onChange={updateRow}
      />
    </div>
  )
}

function validateRows(rows: FreeFormRow[]) {
  const errors = new Map<number, string>()
  const seen = new Map<string, number>()

  rows.forEach((row, index) => {
    const id = row.id.trim()
    if (!id) {
      errors.set(index, 'id is required.')
      return
    }
    const existing = seen.get(id)
    if (existing !== undefined) {
      errors.set(index, `duplicate id "${id}" also appears on row ${existing + 1}.`)
      return
    }
    seen.set(id, index)
  })

  return errors
}

function rowsEqual(left: FreeFormRow | undefined, right: FreeFormRow | undefined) {
  if (!left || !right) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return value
}

function newRowId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `row-${Date.now()}`
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="ns-label">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-foreground" title={value}>
        {value}
      </div>
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function parseDatasetDetailResponse(value: unknown): DatasetDetailResponse | null {
  if (!isRecord(value) || !Array.isArray(value.rows) || !Array.isArray(value.runs)) return null
  const dataset = parseEvalDatasetSummary(value.dataset)
  if (!dataset || !value.rows.every(isFreeFormRow)) return null

  return {
    dataset,
    rows: value.rows,
    runs: value.runs.filter(isEvalRunSummary),
  }
}

function parseDatasetUpdateResponse(value: unknown): DatasetUpdateResponse | null {
  if (!isRecord(value) || !Array.isArray(value.rows)) return null
  const dataset = parseEvalDatasetSummary(value.dataset)
  if (!dataset || !value.rows.every(isFreeFormRow)) return null
  return { dataset, rows: value.rows }
}

function parseEvalDatasetSummary(value: unknown): EvalDatasetSummary | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.fileName !== 'string' ||
    typeof value.fileFormat !== 'string' ||
    typeof value.byteSize !== 'number' ||
    (value.caseCount !== null && typeof value.caseCount !== 'number') ||
    typeof value.createdAt !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    fileName: value.fileName,
    fileFormat: value.fileFormat,
    byteSize: value.byteSize,
    caseCount: value.caseCount,
    createdAt: value.createdAt,
  }
}

function isFreeFormRow(value: unknown): value is FreeFormRow {
  return isRecord(value) && typeof value.id === 'string'
}

function isEvalRunSummary(value: unknown): value is EvalRunSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.datasetId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.totalCases === 'number' &&
    typeof value.evaluatedCases === 'number' &&
    typeof value.passedCases === 'number' &&
    typeof value.createdAt === 'string'
  )
}

function readApiError(value: unknown) {
  if (isRecord(value) && typeof value.error === 'string') return value.error
  return 'Unexpected server response.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

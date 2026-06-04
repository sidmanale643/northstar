'use client'

import { AlertCircle, Eye, Loader2, Plus, RotateCcw, Save, Search } from 'lucide-react'
import Link from 'next/link'

interface DatasetToolbarProps {
  projectId: string
  datasetId: string
  rowCount: number
  dirtyCount: number
  errorCount: number
  searchQuery: string
  showRaw: boolean
  isSaving: boolean
  canSave: boolean
  onSearchChange: (value: string) => void
  onToggleRaw: () => void
  onAddRow: () => void
  onRevert: () => void
  onSave: () => void
}

export function DatasetToolbar({
  projectId,
  datasetId,
  rowCount,
  dirtyCount,
  errorCount,
  searchQuery,
  showRaw,
  isSaving,
  canSave,
  onSearchChange,
  onToggleRaw,
  onAddRow,
  onRevert,
  onSave,
}: DatasetToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="ns-input h-9 pl-9"
            placeholder="Search rows..."
          />
        </div>
        <span className="ns-pill">{rowCount} rows</span>
        {dirtyCount > 0 && <span className="ns-pill border-amber-200 text-amber-700">{dirtyCount} changed</span>}
        {errorCount > 0 && (
          <span className="ns-pill border-red-200 text-red-700">
            <AlertCircle className="h-3 w-3" />
            {errorCount} errors
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="ns-button h-9" onClick={onToggleRaw}>
          <Eye className="h-4 w-4" />
          {showRaw ? 'Hide raw' : 'Raw'}
        </button>
        <Link href={`/projects/${projectId}/evals/${datasetId}`} className="ns-button h-9">
          Run eval
        </Link>
        <button type="button" className="ns-button h-9" onClick={onAddRow}>
          <Plus className="h-4 w-4" />
          Row
        </button>
        <button type="button" className="ns-button h-9" onClick={onRevert} disabled={dirtyCount === 0 || isSaving}>
          <RotateCcw className="h-4 w-4" />
          Revert
        </button>
        <button type="button" className="ns-button ns-button-primary h-9" onClick={onSave} disabled={!canSave || isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? 'Saving' : 'Save'}
        </button>
      </div>
    </div>
  )
}

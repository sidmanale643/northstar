'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, Plus, Trash2 } from 'lucide-react'
import type { FreeFormRow } from '@/lib/eval-datasets'
import { DrawerShell } from './drawer-shell'
import { YamlEditor } from './yaml-editor'
import { cellDisplayValue, type DatasetColumn } from './dataset-columns'

interface DatasetRowDrawerProps {
  row: FreeFormRow | null
  rowIndex: number | null
  columns: DatasetColumn[]
  error: string | null
  onClose: () => void
  onChange: (rowIndex: number, nextRow: FreeFormRow) => void
}

export function DatasetRowDrawer({
  row,
  rowIndex,
  columns,
  error,
  onClose,
  onChange,
}: DatasetRowDrawerProps) {
  const [newColumnName, setNewColumnName] = useState('')
  const editableRow = useMemo(() => row ?? null, [row])

  if (!editableRow || rowIndex === null) {
    return <DrawerShell open={false} onClose={onClose}>{null}</DrawerShell>
  }

  const updateCell = (key: string, value: unknown) => {
    onChange(rowIndex, { ...editableRow, [key]: value })
  }

  const deleteColumn = (key: string) => {
    if (key === 'id') return
    const next: Record<string, unknown> = {}
    for (const [currentKey, value] of Object.entries(editableRow)) {
      if (currentKey !== key) next[currentKey] = value
    }
    onChange(rowIndex, next as FreeFormRow)
  }

  const addColumn = () => {
    const key = newColumnName.trim()
    if (!key || key in editableRow) return
    onChange(rowIndex, { ...editableRow, [key]: '' })
    setNewColumnName('')
  }

  return (
    <DrawerShell open onClose={onClose} ariaLabel={`Edit dataset row ${rowIndex + 1}`}>
      <div className="border-b border-border px-5 py-4 pr-12">
        <div className="ns-label">Row {rowIndex + 1}</div>
        <div className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
          {editableRow.id || 'Missing id'}
        </div>
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
            {error}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {columns.map((column) => (
          <div key={column.key} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="ns-label" htmlFor={`row-${rowIndex}-${column.key}`}>
                {column.key}
              </label>
              {column.key !== 'id' && (
                <button
                  type="button"
                  onClick={() => deleteColumn(column.key)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700"
                  title="Remove column from this row"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {isStructuredValue(editableRow[column.key]) ? (
              <YamlEditor
                value={editableRow[column.key]}
                minHeight={150}
                onChange={(value, parseError) => {
                  if (!parseError) updateCell(column.key, value)
                }}
              />
            ) : (
              <input
                id={`row-${rowIndex}-${column.key}`}
                value={cellDisplayValue(editableRow[column.key])}
                onChange={(event) => updateCell(column.key, event.target.value)}
                className="ns-input h-9"
              />
            )}
          </div>
        ))}

        <form
          className="rounded-lg border border-dashed border-border bg-secondary/30 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            addColumn()
          }}
        >
          <label className="ns-label" htmlFor={`row-${rowIndex}-new-column`}>
            Add column
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id={`row-${rowIndex}-new-column`}
              value={newColumnName}
              onChange={(event) => setNewColumnName(event.target.value)}
              className="ns-input h-9"
              placeholder="column_name"
            />
            <button type="submit" className="ns-button ns-button-primary h-9" disabled={!newColumnName.trim() || newColumnName.trim() in editableRow}>
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
        </form>
      </div>
    </DrawerShell>
  )
}

function isStructuredValue(value: unknown) {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

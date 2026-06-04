'use client'

import { AlertCircle, Database, Plus, Trash2 } from 'lucide-react'
import type { FreeFormRow } from '@/lib/eval-datasets'
import { cn } from '@/lib/utils'
import { cellDisplayValue, cellMatches, type DatasetColumn } from './dataset-columns'

interface DatasetTableProps {
  rows: FreeFormRow[]
  columns: DatasetColumn[]
  searchQuery: string
  dirtyRows: Set<number>
  rowErrors: Map<number, string>
  onAddRow: () => void
  onOpenRow: (rowIndex: number) => void
  onDeleteRow: (rowIndex: number) => void
  onCellChange: (rowIndex: number, key: string, value: string) => void
}

export function DatasetTable({
  rows,
  columns,
  searchQuery,
  dirtyRows,
  rowErrors,
  onAddRow,
  onOpenRow,
  onDeleteRow,
  onCellChange,
}: DatasetTableProps) {
  const query = searchQuery.trim().toLowerCase()
  const visibleRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !query || columns.some((column) => cellMatches(row, column.key, query)))

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
          <Database className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No rows yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add a row with an id, then add any columns you need.</p>
        </div>
        <button type="button" className="ns-button ns-button-primary" onClick={onAddRow}>
          <Plus className="h-4 w-4" />
          Add row
        </button>
      </div>
    )
  }

  if (visibleRows.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center px-6 text-sm text-muted-foreground">
        No rows match the current search.
      </div>
    )
  }

  return (
    <div className="overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
        <thead className="sticky top-0 z-10 bg-secondary">
          <tr>
            <th className="w-14 border-b border-r border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Row
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'border-b border-r border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground',
                  column.width
                )}
              >
                {column.key}
              </th>
            ))}
            <th className="w-20 border-b border-border px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ row, index }) => {
            const rowError = rowErrors.get(index)
            return (
              <tr
                key={`${row.id}-${index}`}
                className={cn(
                  'group bg-white transition-colors hover:bg-secondary/40',
                  dirtyRows.has(index) && 'bg-amber-50/60',
                  rowError && 'bg-red-50/70'
                )}
              >
                <td className="border-b border-r border-border px-3 py-2 align-top font-mono text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => onOpenRow(index)}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    title={rowError ?? 'Edit row'}
                  >
                    {rowError && <AlertCircle className="h-3.5 w-3.5 text-red-600" />}
                    {index + 1}
                  </button>
                </td>
                {columns.map((column) => {
                  const value = row[column.key]
                  const display = cellDisplayValue(value)
                  const editable = isInlineEditable(value)
                  return (
                    <td key={column.key} className="border-b border-r border-border p-0 align-top">
                      {editable ? (
                        <input
                          value={display}
                          onChange={(event) => onCellChange(index, column.key, event.target.value)}
                          className="h-9 w-full bg-transparent px-3 font-mono text-xs outline-none focus:bg-white focus:ring-2 focus:ring-emerald-100"
                          aria-label={`${column.key} for row ${index + 1}`}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenRow(index)}
                          className="block h-9 w-full truncate px-3 text-left font-mono text-xs text-muted-foreground hover:text-foreground"
                          title={display}
                        >
                          {display}
                        </button>
                      )}
                    </td>
                  )
                })}
                <td className="border-b border-border px-2 py-1.5 align-top">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" className="ns-button h-7 px-2" onClick={() => onOpenRow(index)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteRow(index)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700"
                      title="Delete row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function isInlineEditable(value: unknown) {
  return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

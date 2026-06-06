'use client'

import { Tag } from 'lucide-react'
import type { DashboardPromptLabelHistory } from '@/lib/supabase/types'

interface LabelHistoryTableProps {
  history: DashboardPromptLabelHistory[]
}

export function LabelHistoryTable({ history }: LabelHistoryTableProps) {
  if (history.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-secondary/30 px-4 py-6 text-center text-[12px] text-muted-foreground">
        No label deployments yet.
      </div>
    )
  }

  return (
    <div className="overflow-auto rounded-md border border-border/60 bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
        <thead className="bg-secondary">
          <tr>
            <th className="border-b border-r border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Deployed at
            </th>
            <th className="border-b border-r border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Label
            </th>
            <th className="border-b border-r border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Version
            </th>
            <th className="border-b border-r border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Change note
            </th>
            <th className="border-b border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Deployed by
            </th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => (
            <tr key={entry.id} className="group bg-white transition-colors hover:bg-secondary/40">
              <td className="border-b border-r border-border px-3 py-2 align-top font-mono text-[11px] text-muted-foreground">
                {formatDate(entry.deployed_at)}
              </td>
              <td className="border-b border-r border-border px-3 py-2 align-top">
                <span className="ns-pill">
                  <Tag className="h-3 w-3" />
                  {entry.label}
                </span>
              </td>
              <td className="border-b border-r border-border px-3 py-2 align-top font-mono text-[11px] text-foreground">
                {entry.version_id.slice(0, 8)}
              </td>
              <td className="border-b border-r border-border px-3 py-2 align-top text-[11.5px] text-foreground">
                {entry.change_note || <span className="text-muted-foreground">—</span>}
              </td>
              <td className="border-b border-border px-3 py-2 align-top font-mono text-[11px] text-muted-foreground">
                {entry.deployed_by || <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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

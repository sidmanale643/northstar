'use client'

import { AlertTriangle, Trash2, X } from 'lucide-react'
import type { Project } from '@/lib/projects'

export function DeleteProjectDialog({
  project,
  onCancel,
  onConfirm,
}: {
  project: Project | null
  onCancel: () => void
  onConfirm: (project: Project) => void
}) {
  if (!project) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#18352d]/25 px-4" role="presentation" onMouseDown={onCancel}>
      <section
        aria-labelledby="delete-project-title"
        aria-modal="true"
        className="ns-panel w-full max-w-md p-4 shadow-[0_20px_60px_rgb(24_53_45_/_0.18)]"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="delete-project-title" className="text-sm font-semibold">Delete project?</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Remove <span className="font-medium text-foreground">{project.name}</span> from this browser. This cannot be undone.
            </p>
          </div>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onCancel} aria-label="Close delete confirmation">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="ns-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="ns-button ns-button-danger" onClick={() => onConfirm(project)}>
            <Trash2 />
            Delete project
          </button>
        </div>
      </section>
    </div>
  )
}

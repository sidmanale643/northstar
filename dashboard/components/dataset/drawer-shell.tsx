'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DrawerShellProps {
  open: boolean
  onClose: () => void
  widthClassName?: string
  children: ReactNode
  ariaLabel?: string
}

export function DrawerShell({
  open,
  onClose,
  widthClassName = 'w-[560px]',
  children,
  ariaLabel,
}: DrawerShellProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="ns-backdrop-enter flex-1 cursor-default bg-black/30"
      />
      <aside
        className={cn(
          'ns-dialog-enter relative flex h-full max-w-[90vw] flex-col border-l border-border bg-background shadow-2xl',
          widthClassName
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </aside>
    </div>
  )
}

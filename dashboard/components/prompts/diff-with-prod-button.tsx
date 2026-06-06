'use client'

import { GitCompareArrows } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DiffWithProdButtonProps {
  projectId: string
  promptId: string
  baseVersionId: string
  targetVersionId: string
  hasProdVersion: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  size?: 'sm' | 'md'
  className?: string
}

export function DiffWithProdButton({
  hasProdVersion,
  isOpen,
  onOpenChange,
  size = 'sm',
  className,
}: DiffWithProdButtonProps) {
  const tooltip = hasProdVersion
    ? 'Diff this version with the current prod label'
    : 'No prod version set yet'

  const sizeClass = size === 'sm' ? '!h-7 !px-2.5 !text-[11px]' : '!h-8 !px-3 !text-xs'

  return (
    <button
      type="button"
      onClick={() => {
        if (!hasProdVersion) return
        onOpenChange(!isOpen)
      }}
      disabled={!hasProdVersion}
      title={tooltip}
      className={cn(
        'ns-button',
        sizeClass,
        isOpen && hasProdVersion && 'bg-secondary text-foreground',
        !hasProdVersion && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <GitCompareArrows className="h-3.5 w-3.5" />
      Diff with prod
    </button>
  )
}

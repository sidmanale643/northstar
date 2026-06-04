import { DollarSign } from 'lucide-react'
import { formatUsd, hasCost } from '@/lib/format'
import { cn } from '@/lib/utils'

interface CostBadgeProps {
  cost: number | string | null | undefined
  className?: string
  showIcon?: boolean
  hideWhenZero?: boolean
}

export function CostBadge({ cost, className, showIcon = true, hideWhenZero = true }: CostBadgeProps) {
  if (hideWhenZero && !hasCost(cost)) return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]',
        'border-[#9fe1cb] bg-[#e1f5ee] text-[#0f6e56]',
        className
      )}
      title="Cost (USD)"
    >
      {showIcon && <DollarSign className="h-2.5 w-2.5" />}
      {formatUsd(cost)}
    </span>
  )
}

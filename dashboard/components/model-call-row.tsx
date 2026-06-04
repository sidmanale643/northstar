import { Cpu, DollarSign } from 'lucide-react'
import { CostBadge } from '@/components/cost-badge'
import { formatTokens, hasCost } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ModelCallRowProps {
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  costUsd?: number | string | null
  className?: string
  showCostBadge?: boolean
}

export function ModelCallRow({
  model,
  inputTokens,
  outputTokens,
  costUsd,
  className,
  showCostBadge = true,
}: ModelCallRowProps) {
  const hasModel = typeof model === 'string' && model.length > 0
  const input = inputTokens ?? 0
  const output = outputTokens ?? 0
  const hasTokens = input > 0 || output > 0
  const hasCostValue = hasCost(costUsd)

  if (!hasModel && !hasTokens && !hasCostValue) return null

  const tokenLabel = hasTokens ? describeTokens(input, output) : null

  return (
    <div
      className={cn(
        'mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground',
        className
      )}
    >
      {hasModel && (
        <span className="inline-flex items-center gap-1 rounded border bg-[var(--ns-panel)] px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
          <Cpu className="h-2.5 w-2.5 text-muted-foreground" />
          {model}
        </span>
      )}
      {tokenLabel && (
        <span className="inline-flex items-center gap-1 rounded border bg-[var(--ns-panel)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {tokenLabel}
        </span>
      )}
      {showCostBadge && hasCostValue && <CostBadge cost={costUsd} />}
      {!showCostBadge && hasCostValue && costUsd != null && (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <DollarSign className="h-2.5 w-2.5" />
          {formatUsdNumber(costUsd)}
        </span>
      )}
    </div>
  )
}

function describeTokens(input: number, output: number): string {
  if (input > 0 && output > 0) {
    return `${formatTokens(input)} in · ${formatTokens(output)} out`
  }
  if (input > 0) return `${formatTokens(input)} tokens in`
  return `${formatTokens(output)} tokens out`
}

function formatUsdNumber(value: number | string): string {
  if (typeof value === 'string') return value
  if (Math.abs(value) < 0.01) return value.toFixed(4)
  return value.toFixed(2)
}

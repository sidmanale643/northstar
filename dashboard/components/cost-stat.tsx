import { DollarSign } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatTokens, formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface CostBreakdownEntry {
  label: string
  cost: number | string
}

interface CostStatProps {
  label: string
  cost: number | string | null | undefined
  detail?: string
  icon?: LucideIcon
  breakdown?: CostBreakdownEntry[]
  inputTokens?: number
  outputTokens?: number
  tone?: 'default' | 'ok'
  className?: string
}

export function CostStat({
  label,
  cost,
  detail,
  icon: Icon = DollarSign,
  breakdown,
  inputTokens,
  outputTokens,
  tone = 'default',
  className,
}: CostStatProps) {
  const valueText = formatUsd(cost)
  const hasBreakdown = !!breakdown && breakdown.length > 0
  const tokenDetail = describeTokens(inputTokens, outputTokens)
  const mergedDetail = [tokenDetail, detail].filter(Boolean).join(' · ')

  return (
    <div
      className={cn(
        'rounded-[10px] border bg-white px-4 py-3.5',
        tone === 'ok' && 'border-[#9fe1cb]',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="ns-label">{label}</div>
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            tone === 'ok' ? 'text-primary' : 'text-muted-foreground'
          )}
        />
      </div>
      <div
        className={cn(
          'mt-2 font-mono text-[26px] font-semibold leading-none tracking-[-0.03em]',
          tone === 'ok' ? 'text-primary' : 'text-foreground'
        )}
        title={hasBreakdown ? formatBreakdownTooltip(breakdown) : undefined}
      >
        {valueText}
      </div>
      {mergedDetail && (
        <div className="mt-1 text-[11px] text-muted-foreground">{mergedDetail}</div>
      )}
    </div>
  )
}

function describeTokens(input: number | undefined, output: number | undefined): string | null {
  const hasInput = typeof input === 'number' && input > 0
  const hasOutput = typeof output === 'number' && output > 0
  if (!hasInput && !hasOutput) return null
  if (hasInput && hasOutput) {
    return `${formatTokens(input!)} in · ${formatTokens(output!)} out`
  }
  if (hasInput) return `${formatTokens(input!)} in`
  return `${formatTokens(output!)} out`
}

function formatBreakdownTooltip(entries: CostBreakdownEntry[]): string {
  return entries
    .slice(0, 8)
    .map((entry) => `${entry.label}: ${formatUsd(entry.cost)}`)
    .join('\n')
}

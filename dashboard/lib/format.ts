export function formatUsd(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '$0.00'
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric === 0) return '$0.00'

  if (Math.abs(numeric) < 0.01) {
    return `$${numeric.toFixed(4)}`
  }
  if (Math.abs(numeric) < 1) {
    return `$${numeric.toFixed(3)}`
  }
  return `$${numeric.toFixed(2)}`
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0'
  if (!Number.isFinite(value)) return '0'

  const abs = Math.abs(value)
  if (abs < 1_000) return `${Math.round(value)}`
  if (abs < 1_000_000) return `${(value / 1_000).toFixed(abs < 10_000 ? 2 : 1)}k`
  if (abs < 1_000_000_000) return `${(value / 1_000_000).toFixed(abs < 10_000_000 ? 2 : 1)}M`
  return `${(value / 1_000_000_000).toFixed(2)}B`
}

export function hasCost(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0
}

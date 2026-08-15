/** Display formatting. Crypto prices span ~12 orders of magnitude, so the
 *  precision has to adapt or everything reads as $0.00. */

export function formatPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v === 0) return '$0'
  const abs = Math.abs(v)
  if (abs >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (abs >= 1) return `$${v.toFixed(4)}`
  if (abs >= 0.0001) return `$${v.toFixed(6)}`

  // Sub-tick prices. toPrecision would emit scientific notation ("5.000e-7"),
  // which reads as a bug on a price row, so expand to fixed decimals with four
  // significant figures past the leading zeros.
  const leadingZeros = Math.floor(-Math.log10(abs))
  return `$${v.toFixed(Math.min(20, leadingZeros + 4))}`
}

export function formatUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}

export function formatAmount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  if (abs >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return v.toPrecision(3)
}

export function formatPercent(v: number | null | undefined, withSign = true): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = withSign && v > 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(1)}%`
}

export function shortAddress(a: string): string {
  if (!a || a.length < 12) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/**
 * Parse a threshold the way a trader types it: "0.05", "$1.2", "74M", "1.5b".
 * Returns null for anything unparseable, so callers can reject rather than
 * silently treating garbage as 0.
 */
export function parseThreshold(input: string): number | null {
  const s = input.trim().replace(/[$,\s]/g, '')
  if (!s) return null

  const m = /^(-?\d*\.?\d+)([kmb])?$/i.exec(s)
  if (!m) return null

  const n = Number(m[1])
  if (!Number.isFinite(n)) return null

  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() ?? ''] ?? 1
  const value = n * mult
  return value > 0 ? value : null
}

export const isValidAddress = (a: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(a.trim())

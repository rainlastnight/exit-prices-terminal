import type { TrackedRow, TrancheRow } from './store'
import type { Trigger } from './rules'
import type { LadderSummary, Suggestion, TokenHistoryStats, TemplateId } from './templates'
import type { Pnl, PricedTrade } from './costbasis'
import type { RungFill } from './reconcile'

export interface PricedRow extends TrackedRow {
  price: number | null
  fdv: number | null
  mc: number | null
  liquidity: number | null
  change24h: number | null
  balance: number
  valueUsd: number | null
  source: string | null
  tranches: TrancheRow[]
  avgCost: number | null
  triggered: Trigger | null
}

export interface PositionDetail {
  id: number
  base: number
  baseSource: 'manual' | 'estimated' | 'price'
  pnl: Pnl
  costPartial: boolean
  transferCount: number
  trades: PricedTrade[]
  tranches: TrancheRow[]
  ladder: LadderSummary | null
  fills: RungFill[]
  /** Share of the plan actually sold, from on-chain sells. */
  soldPct: number
  missed: RungFill[]
  planBalance: number
  drift: { planBase: number; currentBase: number; drift: number } | null
  stats: TokenHistoryStats
  suggestion: Suggestion
  previews: Array<{ id: TemplateId; name: string; blurb: string; summary: LadderSummary }>
  poolAddress: string | null
}

export type { TrancheRow }

export interface DiscoveredToken {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  iconUrl: string | null
  balanceRaw: string
  balance: number
  hintPriceUsd: number | null
  hintValueUsd: number | null
  holders: number
  isNative: boolean
}

export interface Wallet {
  id: number
  address: string
  label: string | null
  added_at: number
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * Cost basis and PNL from on-chain transfer history.
 *
 * Approach: read the wallet's transfers of one token from Blockscout, price
 * each one against the closest historical candle, then run weighted-average
 * cost accounting over the sequence.
 *
 * This is an *estimate* and says so in the UI. Two known limits:
 *  - A transfer is not necessarily a trade. An airdrop or a bridge-in looks
 *    like a buy at the market price of that moment, which inflates cost basis.
 *  - Pricing uses the closest candle, so a transfer older than the pool's
 *    candle history cannot be priced at all.
 * Both are why a manual override exists; when set it wins outright.
 */

import { getCandles, type Candle, type Timeframe } from './geckoterminal'

export interface Transfer {
  ts: number // unix seconds
  /** Positive for tokens received, negative for tokens sent. */
  amount: number
  txHash: string
}

export interface PricedTrade {
  ts: number
  amount: number
  price: number | null
  kind: 'buy' | 'sell'
  txHash: string
}

export interface CostBasisResult {
  /** Weighted-average cost per token, or null when nothing could be priced. */
  avgCost: number | null
  /** Tokens still held according to the transfer history. */
  heldTokens: number
  /** What the remaining position cost. */
  costOfHeld: number | null
  realizedPnl: number
  trades: PricedTrade[]
  /** True when at least one transfer could not be priced. */
  partial: boolean
}

/** Closest candle close to a timestamp, within a sane window. */
export function priceAt(candles: Candle[], ts: number): number | null {
  if (candles.length === 0) return null

  let best: Candle | null = null
  let bestGap = Infinity
  for (const c of candles) {
    const gap = Math.abs(c.time - ts)
    if (gap < bestGap) {
      bestGap = gap
      best = c
    }
  }

  // Beyond ~3 days the "closest" candle stops being a meaningful proxy.
  if (!best || bestGap > 3 * 86_400) return null
  return best.close
}

/**
 * Weighted-average-cost accounting over a chronological transfer list.
 *
 * Sells realise against the running average rather than against specific lots,
 * which is the convention portfolio trackers use and keeps the maths stable
 * when history is incomplete.
 */
export function computeCostBasis(transfers: Transfer[], candles: Candle[]): CostBasisResult {
  const ordered = [...transfers].sort((a, b) => a.ts - b.ts)

  let heldTokens = 0
  let costPool = 0
  let realizedPnl = 0
  let partial = false

  const trades: PricedTrade[] = []

  for (const t of ordered) {
    const price = priceAt(candles, t.ts)
    const kind: 'buy' | 'sell' = t.amount >= 0 ? 'buy' : 'sell'
    trades.push({ ts: t.ts, amount: t.amount, price, kind, txHash: t.txHash })

    if (price === null) {
      partial = true
      // Still track the quantity so the held balance stays right.
      heldTokens += t.amount
      if (heldTokens < 0) heldTokens = 0
      continue
    }

    if (t.amount >= 0) {
      heldTokens += t.amount
      costPool += t.amount * price
    } else {
      const sold = Math.min(-t.amount, heldTokens)
      const avg = heldTokens > 0 ? costPool / heldTokens : 0
      realizedPnl += sold * (price - avg)
      costPool -= sold * avg
      heldTokens -= sold
    }
  }

  const avgCost = heldTokens > 0 && costPool > 0 ? costPool / heldTokens : null

  return {
    avgCost,
    heldTokens,
    costOfHeld: avgCost !== null ? avgCost * heldTokens : null,
    realizedPnl,
    trades,
    partial,
  }
}

export interface Pnl {
  avgCost: number | null
  currentPrice: number | null
  balance: number
  costValue: number | null
  marketValue: number | null
  unrealized: number | null
  unrealizedPct: number | null
  realized: number
}

export function computePnl(
  balance: number,
  currentPrice: number | null,
  avgCost: number | null,
  realized = 0,
): Pnl {
  const costValue = avgCost !== null ? balance * avgCost : null
  const marketValue = currentPrice !== null ? balance * currentPrice : null
  const unrealized = costValue !== null && marketValue !== null ? marketValue - costValue : null
  const unrealizedPct =
    costValue !== null && costValue > 0 && unrealized !== null ? unrealized / costValue : null

  return {
    avgCost,
    currentPrice,
    balance,
    costValue,
    marketValue,
    unrealized,
    unrealizedPct,
    realized,
  }
}

/** Pick the candle resolution that best spans the transfer history. */
export function timeframeFor(transfers: Transfer[]): Timeframe {
  if (transfers.length === 0) return 'day'
  const oldest = Math.min(...transfers.map((t) => t.ts))
  const ageDays = (Date.now() / 1000 - oldest) / 86_400
  if (ageDays > 45) return 'day'
  if (ageDays > 2) return 'hour'
  return 'minute'
}

/** Fetch the candle series used to price a transfer history. */
export async function candlesForHistory(
  chainId: number,
  poolAddress: string,
  transfers: Transfer[],
): Promise<Candle[]> {
  return getCandles(chainId, poolAddress, timeframeFor(transfers), 1000)
}
